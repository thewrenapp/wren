//! RAPTOR: Recursive Abstractive Processing for Tree-Organized Retrieval.
//!
//! Implements the full RAPTOR algorithm from the paper (Sarthi et al., 2024):
//! 1. Leaf chunks are re-chunked to ~400 chars (~100 tokens) for fine granularity
//! 2. Embeddings are reduced via lightweight UMAP
//! 3. GMM soft clustering with BIC-optimal k finds thematic groups
//! 4. Two-step global + local clustering captures hierarchical themes
//! 5. Each cluster is recursively summarized (no hard truncation)
//! 6. Process repeats for higher levels until convergence
//!
//! Retrieval uses collapsed-tree with token budget (all levels flattened).

use ndarray::Array2;
use rand::Rng;
use rand::SeedableRng;
use super::embeddings::{self, EmbeddingConfig};
use super::store::{RaptorSummaryNode, VectorStore};
use super::retrieval::RagGenModelConfig;

// ══════════════════════════════════════════════════════════════
// Configuration
// ══════════════════════════════════════════════════════════════

/// Configuration for RAPTOR tree building.
pub struct RaptorConfig {
    /// Maximum tree depth (default: 3). Level 0 = leaves.
    pub max_levels: usize,
    /// Minimum nodes required to trigger another level (default: 4).
    pub min_nodes_for_level: usize,

    // Clustering
    /// GMM soft membership threshold (default: 0.1).
    pub soft_cluster_threshold: f32,
    /// Upper bound for BIC cluster search (default: 50, matching paper).
    pub max_clusters: usize,

    // UMAP
    /// UMAP target dimensions (default: 10).
    pub umap_target_dim: usize,
    /// UMAP optimization epochs (default: 200).
    pub umap_n_epochs: usize,

    // Retrieval
    /// Token budget for collapsed-tree retrieval (default: 2000).
    pub retrieval_token_budget: usize,

    // Summarization
    /// Max context tokens per summarization call (default: 4000).
    pub max_summary_context_tokens: usize,

    // Cluster size limit
    /// Max tokens in a single cluster before recursive re-clustering (default: 3500, matching paper).
    pub max_cluster_tokens: usize,

    /// Optional seed for deterministic builds (default: Some(42)).
    pub seed: Option<u64>,

    /// Retrieval mode (default: Collapsed).
    pub retrieval_mode: RaptorRetrievalMode,
    /// Top-k nodes to select at each tree level during traversal (default: 5).
    pub traversal_top_k: usize,
}

impl Default for RaptorConfig {
    fn default() -> Self {
        Self {
            max_levels: 3,
            min_nodes_for_level: 4,
            soft_cluster_threshold: 0.1,
            max_clusters: 50,
            umap_target_dim: 10,
            umap_n_epochs: 200,
            retrieval_token_budget: 2000,
            max_summary_context_tokens: 4000,
            max_cluster_tokens: 3500,
            seed: Some(42),
            retrieval_mode: RaptorRetrievalMode::TreeTraversal,
            traversal_top_k: 7,
        }
    }
}

/// Retrieval strategy for RAPTOR-enhanced search.
#[derive(Debug, Clone, PartialEq)]
pub enum RaptorRetrievalMode {
    /// Collapsed tree: flatten all levels, rank by similarity, greedily fill token budget.
    Collapsed,
    /// Tree traversal: start at top level, select top-k, expand children, repeat down.
    TreeTraversal,
}

impl Default for RaptorRetrievalMode {
    fn default() -> Self {
        Self::TreeTraversal
    }
}

/// A node during tree construction (not yet stored).
struct TreeNode {
    id: String,
    content: String,
    embedding: Vec<f32>,
    level: usize,
    document_id: String,
    source_chunk_ids: Vec<String>,
}

// ══════════════════════════════════════════════════════════════
// UMAP via scirs2-transform (proper implementation with cosine metric)
// ══════════════════════════════════════════════════════════════

/// Reduce high-dimensional embeddings using scirs2-transform's UMAP.
/// Uses cosine metric (matching the RAPTOR paper).
fn umap_reduce(
    data: &Array2<f32>,
    n_components: usize,
    n_neighbors: usize,
    n_epochs: usize,
    rng: &mut impl Rng,
) -> Array2<f32> {
    let n = data.nrows();
    if n <= n_components || n <= 2 {
        // Can't reduce — return data truncated/padded to n_components
        let cols = data.ncols().min(n_components);
        let mut out = Array2::zeros((n, n_components));
        for i in 0..n {
            for j in 0..cols {
                out[[i, j]] = data[[i, j]];
            }
        }
        return out;
    }

    let k = n_neighbors.min(n - 1).max(1);

    // Step 1: Build kNN graph (brute-force, L2 distance)
    let (knn_indices, knn_distances) = build_knn_graph(data, k);

    // Step 2: Compute fuzzy simplicial set weights
    let graph = compute_fuzzy_graph(n, k, &knn_indices, &knn_distances);

    // Step 3: Symmetrize: w_sym = w + w^T - w * w^T
    let sym_graph = symmetrize_graph(&graph);

    // Step 4: SGD optimization of low-dimensional embedding
    optimize_layout(n, n_components, n_epochs, &sym_graph, rng)
}

/// Cosine similarity between two vectors.
fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
    let dot: f32 = a.iter().zip(b.iter()).map(|(x, y)| x * y).sum();
    let norm_a: f32 = a.iter().map(|x| x * x).sum::<f32>().sqrt().max(1e-10);
    let norm_b: f32 = b.iter().map(|x| x * x).sum::<f32>().sqrt().max(1e-10);
    dot / (norm_a * norm_b)
}

/// Build kNN graph using cosine distance with rayon parallelism.
/// Cosine distance = 1 - cosine_similarity = 1 - (a·b)/(|a|·|b|).
/// Uses parallel row processing + partial sort (O(n) per row instead of O(n log n)).
fn build_knn_graph(data: &Array2<f32>, k: usize) -> (Vec<Vec<usize>>, Vec<Vec<f32>>) {
    use rayon::prelude::*;
    let n = data.nrows();
    let d = data.ncols();

    // Precompute L2 norms for cosine distance
    let norms: Vec<f32> = (0..n).map(|i| {
        let row = data.row(i);
        row.iter().map(|v| v * v).sum::<f32>().sqrt().max(1e-10)
    }).collect();

    // Parallel: each row independently finds its k nearest neighbors
    let results: Vec<(Vec<usize>, Vec<f32>)> = (0..n).into_par_iter()
        .map(|i| {
            let mut dists: Vec<(usize, f32)> = (0..n)
                .filter(|&j| j != i)
                .map(|j| {
                    let mut dot = 0.0f32;
                    for dim in 0..d { dot += data[[i, dim]] * data[[j, dim]]; }
                    let cosine_dist = (1.0 - dot / (norms[i] * norms[j])).max(0.0);
                    (j, cosine_dist)
                })
                .collect();

            // Partial sort: O(n) to find k smallest, then sort only those k
            if k < dists.len() {
                dists.select_nth_unstable_by(k, |a, b|
                    a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal)
                );
                dists.truncate(k);
                dists.sort_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal));
            }

            let indices = dists.iter().map(|(idx, _)| *idx).collect();
            let distances = dists.iter().map(|(_, d)| *d).collect();
            (indices, distances)
        })
        .collect();

    let (all_indices, all_distances) = results.into_iter().unzip();
    (all_indices, all_distances)
}

/// Compute fuzzy simplicial set weights using UMAP formula.
/// w(i,j) = exp(-(d(i,j) - rho_i) / sigma_i)
fn compute_fuzzy_graph(
    n: usize,
    k: usize,
    knn_indices: &[Vec<usize>],
    knn_distances: &[Vec<f32>],
) -> Vec<(usize, usize, f32)> {
    let target_entropy = (k as f32).log2();
    let mut edges = Vec::new();

    for i in 0..n {
        let dists = &knn_distances[i];
        if dists.is_empty() { continue; }

        // rho_i = distance to nearest neighbor
        let rho = dists[0].max(1e-8);

        // Binary search for sigma to achieve target entropy
        let sigma = find_sigma(dists, rho, target_entropy);

        for (idx_in_knn, &j) in knn_indices[i].iter().enumerate() {
            let d = dists[idx_in_knn];
            let w = if d <= rho {
                1.0
            } else {
                (-(d - rho) / sigma.max(1e-8)).exp()
            };
            if w > 1e-8 {
                edges.push((i, j, w));
            }
        }
    }

    edges
}

/// Binary search for sigma such that the effective number of neighbors (sum of weights)
/// matches the target k. Target is log(k) so we compare log(sum_weights) against it.
fn find_sigma(distances: &[f32], rho: f32, target: f32) -> f32 {
    let mut lo = 1e-8_f32;
    let mut hi = 1000.0_f32;

    for _ in 0..64 {
        let mid = (lo + hi) / 2.0;
        let sum_weights: f32 = distances.iter()
            .map(|&d| {
                let w = if d <= rho { 1.0 } else { (-(d - rho) / mid).exp() };
                if w > 1e-8 { w } else { 0.0 }
            })
            .sum();
        let log_sum_weights = sum_weights.max(1e-8).ln();

        if log_sum_weights > target {
            hi = mid;
        } else {
            lo = mid;
        }
    }

    (lo + hi) / 2.0
}

/// Symmetrize the fuzzy graph: w_sym(i,j) = w(i,j) + w(j,i) - w(i,j)*w(j,i)
fn symmetrize_graph(edges: &[(usize, usize, f32)]) -> Vec<(usize, usize, f32)> {
    use std::collections::HashMap;
    let mut edge_map: HashMap<(usize, usize), f32> = HashMap::new();

    for &(i, j, w) in edges {
        edge_map.insert((i, j), w);
    }

    let mut sym_edges = Vec::new();
    let mut seen = std::collections::HashSet::new();

    for &(i, j, _) in edges {
        let key = if i < j { (i, j) } else { (j, i) };
        if seen.contains(&key) { continue; }
        seen.insert(key);

        let w_ij = edge_map.get(&(i, j)).copied().unwrap_or(0.0);
        let w_ji = edge_map.get(&(j, i)).copied().unwrap_or(0.0);
        let w_sym = w_ij + w_ji - w_ij * w_ji;

        if w_sym > 1e-8 {
            sym_edges.push((key.0, key.1, w_sym));
        }
    }

    sym_edges
}

/// Spectral initialization: compute normalized graph Laplacian eigenvectors.
/// Returns the n_components smallest non-trivial eigenvectors as initial embedding.
/// Uses nalgebra's symmetric eigendecomposition.
fn spectral_init(
    n: usize,
    n_components: usize,
    edges: &[(usize, usize, f32)],
) -> Option<Array2<f32>> {
    if n > 500 {
        // Spectral init is O(n³) via dense eigendecomposition — skip for large n
        return None;
    }

    // Build adjacency matrix
    let mut adj = DMatrix::<f64>::zeros(n, n);
    for &(i, j, w) in edges {
        adj[(i, j)] += w as f64;
        adj[(j, i)] += w as f64;
    }

    // Degree matrix
    let mut degree = DMatrix::<f64>::zeros(n, n);
    for i in 0..n {
        let d: f64 = adj.row(i).sum();
        degree[(i, i)] = d.max(1e-10);
    }

    // Normalized Laplacian: L_sym = D^{-1/2} (D - A) D^{-1/2} = I - D^{-1/2} A D^{-1/2}
    let mut l_sym = DMatrix::<f64>::identity(n, n);
    for i in 0..n {
        let di = degree[(i, i)].sqrt();
        for j in 0..n {
            if i != j && adj[(i, j)] > 0.0 {
                let dj = degree[(j, j)].sqrt();
                l_sym[(i, j)] = -adj[(i, j)] / (di * dj);
            }
        }
    }

    // Symmetric eigendecomposition
    let eig = nalgebra::linalg::SymmetricEigen::new(l_sym);
    let eigenvalues = eig.eigenvalues;
    let eigenvectors = eig.eigenvectors;

    // Sort by eigenvalue (ascending) — skip the first (trivial, eigenvalue ≈ 0)
    let mut indices: Vec<usize> = (0..n).collect();
    indices.sort_by(|&a, &b| eigenvalues[a].partial_cmp(&eigenvalues[b]).unwrap_or(std::cmp::Ordering::Equal));

    // Take eigenvectors 1..n_components+1 (skip index 0 which is the trivial eigenvector)
    let mut embedding = Array2::zeros((n, n_components));
    for comp in 0..n_components {
        let eig_idx = indices.get(comp + 1)?; // skip trivial
        for i in 0..n {
            embedding[[i, comp]] = eigenvectors[(i, *eig_idx)] as f32;
        }
    }

    // Scale to reasonable range
    for comp in 0..n_components {
        let col_max = (0..n).map(|i| embedding[[i, comp]].abs()).fold(0.0f32, f32::max).max(1e-10);
        for i in 0..n {
            embedding[[i, comp]] *= 10.0 / col_max;
        }
    }

    Some(embedding)
}

/// SGD layout optimization for UMAP embedding.
fn optimize_layout(
    n: usize,
    n_components: usize,
    n_epochs: usize,
    edges: &[(usize, usize, f32)],
    rng: &mut impl Rng,
) -> Array2<f32> {

    if edges.is_empty() {
        return Array2::zeros((n, n_components));
    }

    // Spectral initialization via normalized graph Laplacian eigenvectors.
    // This gives a globally coherent starting layout (major quality improvement
    // over random init). Falls back to random if eigendecomposition fails.
    let mut embedding = spectral_init(n, n_components, edges).unwrap_or_else(|| {
        let mut rand_emb = Array2::zeros((n, n_components));
        for i in 0..n {
            for j in 0..n_components {
                rand_emb[[i, j]] = rng.gen_range(-10.0..10.0);
            }
        }
        rand_emb
    });

    let initial_lr = 1.0_f32;
    // UMAP curve parameters fitted to min_dist=0.1, spread=1.0
    // (pre-computed from Python: scipy.optimize.curve_fit on 1/(1+a*d^(2b)))
    let a = 1.929_f32;
    let b = 0.7915_f32;
    let negative_sample_rate = 5;

    for epoch in 0..n_epochs {
        let lr = initial_lr * (1.0 - epoch as f32 / n_epochs as f32).max(0.001);

        for &(i, j, w) in edges {
            // Attractive force
            let mut dist_sq = 0.0_f32;
            for d in 0..n_components {
                let diff = embedding[[i, d]] - embedding[[j, d]];
                dist_sq += diff * diff;
            }
            let grad_coeff = -2.0 * a * b * dist_sq.powf(b - 1.0)
                / (1.0 + a * dist_sq.powf(b));

            for d in 0..n_components {
                let diff = embedding[[i, d]] - embedding[[j, d]];
                let grad = grad_coeff * diff * w;
                let clipped = grad.max(-4.0).min(4.0);
                embedding[[i, d]] -= lr * clipped;
                embedding[[j, d]] += lr * clipped;
            }

            // Repulsive force (negative sampling)
            for _ in 0..negative_sample_rate {
                let k = rng.gen_range(0..n);
                if k == i { continue; }

                let mut dist_sq = 0.0_f32;
                for d in 0..n_components {
                    let diff = embedding[[i, d]] - embedding[[k, d]];
                    dist_sq += diff * diff;
                }
                let grad_coeff = 2.0 * b
                    / ((0.001 + dist_sq) * (1.0 + a * dist_sq.powf(b)));

                for d in 0..n_components {
                    let diff = embedding[[i, d]] - embedding[[k, d]];
                    let grad = grad_coeff * diff;
                    let clipped = grad.max(-4.0).min(4.0);
                    embedding[[i, d]] += lr * clipped;
                }
            }
        }
    }

    embedding
}

// ══════════════════════════════════════════════════════════════
// Full-covariance GMM with EM algorithm + BIC
// (matches sklearn.mixture.GaussianMixture default: covariance_type='full')
// ══════════════════════════════════════════════════════════════

use nalgebra::DMatrix;

/// Regularization added to covariance diagonals to prevent singularity.
const COV_REG: f64 = 1e-6;

/// Full-covariance Gaussian Mixture Model (EM algorithm).
/// Uses f64 internally for numerical stability (Cholesky, log-det).
struct GaussianMixture {
    k: usize,
    d: usize,
    means: Vec<DMatrix<f64>>,              // k × (1, d) row vectors
    #[allow(dead_code)]
    covariances: Vec<DMatrix<f64>>,        // k × (d, d) full covariance
    cholesky_lower: Vec<DMatrix<f64>>,     // k × (d, d) cached L from Cholesky(Σ)
    log_det: Vec<f64>,                     // k × log|Σ| (via Cholesky diagonal)
    weights: Vec<f64>,                     // k mixing weights
    log_likelihood: f64,
}

impl GaussianMixture {
    /// Fit full-covariance GMM using EM.
    fn fit(data: &Array2<f32>, k: usize, max_iter: usize, tol: f64, rng: &mut impl Rng) -> Self {
        let n = data.nrows();
        let d = data.ncols();

        // Convert data to f64 DMatrix for nalgebra ops
        let data_f64 = ndarray_to_dmatrix(data);

        // Initialize means via k-means++ seeding
        let means = kmeans_pp_init_f64(&data_f64, n, d, k, rng);

        // Initialize covariances to data covariance
        let data_cov = compute_data_covariance(&data_f64, n, d);
        let mut covariances: Vec<DMatrix<f64>> = (0..k).map(|_| data_cov.clone()).collect();

        let mut weights = vec![1.0 / k as f64; k];
        let mut log_likelihood = f64::NEG_INFINITY;
        let mut gmm_means = means;

        // Pre-compute Cholesky for initial covariances
        let mut chol_lower: Vec<DMatrix<f64>> = Vec::with_capacity(k);
        let mut log_dets: Vec<f64> = Vec::with_capacity(k);
        for cov in &covariances {
            let (l, ld) = cholesky_log_det(cov, d);
            chol_lower.push(l);
            log_dets.push(ld);
        }

        for _iter in 0..max_iter {
            // E-step
            let resp = e_step_full(&data_f64, n, d, k, &gmm_means, &chol_lower, &log_dets, &weights);

            // M-step
            for c in 0..k {
                let n_c: f64 = (0..n).map(|i| resp[(i, c)]).sum();
                if n_c < 1e-10 {
                    weights[c] = 1e-10;
                    continue;
                }
                weights[c] = n_c / n as f64;

                // Update mean
                let mut new_mean = DMatrix::zeros(1, d);
                for i in 0..n {
                    for j in 0..d {
                        new_mean[(0, j)] += resp[(i, c)] * data_f64[(i, j)];
                    }
                }
                new_mean /= n_c;
                gmm_means[c] = new_mean;

                // Update full covariance
                let mut new_cov = DMatrix::zeros(d, d);
                for i in 0..n {
                    let r = resp[(i, c)];
                    if r < 1e-15 { continue; }
                    for j1 in 0..d {
                        let diff1 = data_f64[(i, j1)] - gmm_means[c][(0, j1)];
                        for j2 in j1..d {
                            let diff2 = data_f64[(i, j2)] - gmm_means[c][(0, j2)];
                            let val = r * diff1 * diff2;
                            new_cov[(j1, j2)] += val;
                            if j1 != j2 {
                                new_cov[(j2, j1)] += val;
                            }
                        }
                    }
                }
                new_cov /= n_c;
                // Regularize
                for j in 0..d { new_cov[(j, j)] += COV_REG; }
                covariances[c] = new_cov;

                let (l, ld) = cholesky_log_det(&covariances[c], d);
                chol_lower[c] = l;
                log_dets[c] = ld;
            }

            // Compute log-likelihood
            let new_ll = compute_ll_full(&data_f64, n, d, k, &gmm_means, &chol_lower, &log_dets, &weights);
            if (new_ll - log_likelihood).abs() < tol {
                log_likelihood = new_ll;
                break;
            }
            log_likelihood = new_ll;
        }

        GaussianMixture {
            k, d,
            means: gmm_means,
            covariances,
            cholesky_lower: chol_lower,
            log_det: log_dets,
            weights,
            log_likelihood,
        }
    }

    /// BIC = ln(N) * n_params - 2 * ln(L)
    /// Full covariance params: k*d (means) + k*d*(d+1)/2 (covariance) + k-1 (weights)
    fn bic(&self, n: usize) -> f64 {
        let n_params = self.k * self.d + self.k * self.d * (self.d + 1) / 2 + self.k - 1;
        (n as f64).ln() * (n_params as f64) - 2.0 * self.log_likelihood
    }

    /// Soft cluster assignments using responsibilities.
    fn soft_assignments(&self, data: &Array2<f32>, threshold: f32) -> Vec<Vec<usize>> {
        let n = data.nrows();
        let data_f64 = ndarray_to_dmatrix(data);
        let resp = e_step_full(&data_f64, n, self.d, self.k, &self.means,
                               &self.cholesky_lower, &self.log_det, &self.weights);
        assign_soft_clusters(&resp, threshold)
    }
}

/// E-step: compute responsibilities using Cholesky-based log-probability.
/// Uses rayon for parallelism over data points.
fn e_step_full(
    data: &DMatrix<f64>, n: usize, d: usize, k: usize,
    means: &[DMatrix<f64>],
    chol_lower: &[DMatrix<f64>],
    log_dets: &[f64],
    weights: &[f64],
) -> DMatrix<f64> {
    use rayon::prelude::*;

    let log_2pi_d = (d as f64) * (2.0 * std::f64::consts::PI).ln();

    // Compute per-row responsibilities in parallel
    let row_results: Vec<Vec<f64>> = (0..n).into_par_iter().map(|i| {
        let mut max_log_p = f64::NEG_INFINITY;
        let mut log_ps = vec![0.0f64; k];

        for c in 0..k {
            let mut diff = vec![0.0f64; d];
            for j in 0..d { diff[j] = data[(i, j)] - means[c][(0, j)]; }

            let l = &chol_lower[c];
            let mut y = vec![0.0f64; d];
            for j in 0..d {
                let mut s = diff[j];
                for jj in 0..j { s -= l[(j, jj)] * y[jj]; }
                y[j] = s / l[(j, j)];
            }
            let maha_sq: f64 = y.iter().map(|v| v * v).sum();

            let log_p = -0.5 * (log_2pi_d + log_dets[c] + maha_sq) + weights[c].max(1e-300).ln();
            log_ps[c] = log_p;
            if log_p > max_log_p { max_log_p = log_p; }
        }

        // Log-sum-exp normalization
        let mut row = vec![0.0f64; k];
        let mut sum_exp = 0.0f64;
        for c in 0..k {
            let v = (log_ps[c] - max_log_p).exp();
            row[c] = v;
            sum_exp += v;
        }
        if sum_exp > 0.0 {
            for c in 0..k { row[c] /= sum_exp; }
        }
        row
    }).collect();

    // Assemble into DMatrix
    let mut resp = DMatrix::zeros(n, k);
    for (i, row) in row_results.into_iter().enumerate() {
        for (c, val) in row.into_iter().enumerate() {
            resp[(i, c)] = val;
        }
    }

    resp
}

/// Compute total log-likelihood with full covariance.
fn compute_ll_full(
    data: &DMatrix<f64>, n: usize, d: usize, k: usize,
    means: &[DMatrix<f64>],
    chol_lower: &[DMatrix<f64>],
    log_dets: &[f64],
    weights: &[f64],
) -> f64 {
    let log_2pi_d = (d as f64) * (2.0 * std::f64::consts::PI).ln();
    let mut total = 0.0f64;

    for i in 0..n {
        let mut max_lp = f64::NEG_INFINITY;
        let mut log_ps = vec![0.0f64; k];

        for c in 0..k {
            let mut diff = vec![0.0f64; d];
            for j in 0..d { diff[j] = data[(i, j)] - means[c][(0, j)]; }

            let l = &chol_lower[c];
            let mut y = vec![0.0f64; d];
            for j in 0..d {
                let mut s = diff[j];
                for jj in 0..j { s -= l[(j, jj)] * y[jj]; }
                y[j] = s / l[(j, j)];
            }
            let maha_sq: f64 = y.iter().map(|v| v * v).sum();

            log_ps[c] = -0.5 * (log_2pi_d + log_dets[c] + maha_sq) + weights[c].max(1e-300).ln();
            if log_ps[c] > max_lp { max_lp = log_ps[c]; }
        }

        total += max_lp + log_ps.iter().map(|&lp| (lp - max_lp).exp()).sum::<f64>().ln();
    }

    total
}

/// Cholesky decomposition + log-determinant.
/// Returns (L, log|Σ|) where Σ = L·Lᵀ and log|Σ| = 2·Σ ln(L_ii).
/// Falls back to diagonal + regularization if Cholesky fails.
fn cholesky_log_det(cov: &DMatrix<f64>, d: usize) -> (DMatrix<f64>, f64) {
    // Try Cholesky
    if let Some(chol) = nalgebra::linalg::Cholesky::new(cov.clone()) {
        let l = chol.l();
        let log_det = 2.0 * (0..d).map(|j| l[(j, j)].max(1e-300).ln()).sum::<f64>();
        return (l, log_det);
    }

    // Cholesky failed — regularize more aggressively and retry
    let mut reg_cov = cov.clone();
    for j in 0..d { reg_cov[(j, j)] += 1e-3; }
    if let Some(chol) = nalgebra::linalg::Cholesky::new(reg_cov) {
        let l = chol.l();
        let log_det = 2.0 * (0..d).map(|j| l[(j, j)].max(1e-300).ln()).sum::<f64>();
        return (l, log_det);
    }

    // Last resort: identity
    let l = DMatrix::identity(d, d);
    (l, 0.0)
}

/// Convert ndarray Array2<f32> to nalgebra DMatrix<f64>.
fn ndarray_to_dmatrix(data: &Array2<f32>) -> DMatrix<f64> {
    let n = data.nrows();
    let d = data.ncols();
    DMatrix::from_fn(n, d, |i, j| data[[i, j]] as f64)
}

/// K-means++ initialization on f64 DMatrix.
/// Selects centers with probability proportional to D(x)^2 (squared distance to nearest center).
fn kmeans_pp_init_f64(data: &DMatrix<f64>, n: usize, d: usize, k: usize, rng: &mut impl Rng) -> Vec<DMatrix<f64>> {
    let mut means: Vec<DMatrix<f64>> = Vec::with_capacity(k);

    let first = rng.gen_range(0..n);
    means.push(data.row(first).clone_owned().reshape_generic(nalgebra::Dyn(1), nalgebra::Dyn(d)));

    for _ in 1..k {
        // Compute D(x)^2 for each point (squared distance to nearest existing center)
        let weights: Vec<f64> = (0..n).map(|i| {
            means.iter().map(|m| {
                (0..d).map(|j| { let diff = data[(i, j)] - m[(0, j)]; diff * diff }).sum::<f64>()
            }).fold(f64::MAX, f64::min)
        }).collect();

        // Sample proportional to D(x)^2
        let total: f64 = weights.iter().sum();
        if total <= 0.0 {
            // All points are at existing centers — pick randomly
            let idx = rng.gen_range(0..n);
            means.push(data.row(idx).clone_owned().reshape_generic(nalgebra::Dyn(1), nalgebra::Dyn(d)));
            continue;
        }
        let threshold = rng.gen::<f64>() * total;
        let mut cumulative = 0.0;
        let mut chosen = 0;
        for (i, &w) in weights.iter().enumerate() {
            cumulative += w;
            if cumulative >= threshold {
                chosen = i;
                break;
            }
        }
        means.push(data.row(chosen).clone_owned().reshape_generic(nalgebra::Dyn(1), nalgebra::Dyn(d)));
    }

    means
}

/// Compute full data covariance matrix.
fn compute_data_covariance(data: &DMatrix<f64>, n: usize, d: usize) -> DMatrix<f64> {
    let mut mean = vec![0.0f64; d];
    for i in 0..n { for j in 0..d { mean[j] += data[(i, j)]; } }
    for v in &mut mean { *v /= n as f64; }

    let mut cov = DMatrix::zeros(d, d);
    for i in 0..n {
        for j1 in 0..d {
            let d1 = data[(i, j1)] - mean[j1];
            for j2 in j1..d {
                let d2 = data[(i, j2)] - mean[j2];
                let val = d1 * d2;
                cov[(j1, j2)] += val;
                if j1 != j2 { cov[(j2, j1)] += val; }
            }
        }
    }
    cov /= n as f64;
    // Regularize
    for j in 0..d { cov[(j, j)] += COV_REG; }
    cov
}

/// Assign nodes to clusters based on responsibility threshold.
/// Returns clusters as Vec<Vec<node_index>> where nodes can appear in multiple clusters.
fn assign_soft_clusters(resp: &DMatrix<f64>, threshold: f32) -> Vec<Vec<usize>> {
    let n = resp.nrows();
    let k = resp.ncols();
    let threshold = threshold as f64;
    let mut clusters: Vec<Vec<usize>> = vec![Vec::new(); k];

    for i in 0..n {
        let mut assigned = false;
        for c in 0..k {
            if resp[(i, c)] >= threshold {
                clusters[c].push(i);
                assigned = true;
            }
        }
        if !assigned {
            let best = (0..k)
                .max_by(|&a, &b| resp[(i, a)].partial_cmp(&resp[(i, b)]).unwrap_or(std::cmp::Ordering::Equal))
                .unwrap_or(0);
            clusters[best].push(i);
        }
    }

    clusters
}

/// Find optimal k using BIC (matches paper: sklearn GaussianMixture with full covariance).
/// Tests k from 1 to max_clusters, picks argmin BIC. Early-stops after 3 consecutive increases.
fn find_optimal_k(data: &Array2<f32>, max_k: usize, rng: &mut impl Rng) -> GaussianMixture {
    let n = data.nrows();
    let upper = max_k.min(n);

    let mut best_gmm: Option<GaussianMixture> = None;
    let mut best_bic = f64::INFINITY;
    let mut best_k = 2usize;
    let mut increasing_streak = 0u32;

    for k in 2..upper {
        if k >= n { break; }
        let gmm = GaussianMixture::fit(data, k, 100, 1e-6, rng);
        let bic = gmm.bic(n);

        if bic < best_bic {
            best_bic = bic;
            best_k = k;
            best_gmm = Some(gmm);
            increasing_streak = 0;
        } else {
            increasing_streak += 1;
            if increasing_streak >= 3 { break; }
        }
    }

    tracing::info!("GMM BIC: selected k={} for n={} d={} (searched 2..{})", best_k, n, data.ncols(), upper);
    best_gmm.unwrap_or_else(|| GaussianMixture::fit(data, 2, 100, 1e-6, rng))
}

// ══════════════════════════════════════════════════════════════
// Two-step global + local clustering
// ══════════════════════════════════════════════════════════════

/// Perform two-step hierarchical clustering:
/// 1. Global: UMAP(n_neighbors=global) → GMM → broad themes
/// 2. Local: For each global cluster >5 nodes, UMAP(n_neighbors=local) → GMM → sub-topics
/// Returns soft cluster assignments as Vec<Vec<node_index>>.
fn hierarchical_cluster(
    embeddings: &[&[f32]],
    config: &RaptorConfig,
    rng: &mut impl Rng,
) -> Vec<Vec<usize>> {
    let n = embeddings.len();
    let dim = embeddings[0].len();
    let target_dim = config.umap_target_dim.min(dim);

    if n < 4 {
        return vec![(0..n).collect()];
    }

    let data = vecs_to_array2(embeddings, n, dim);

    // Paper line 72: ALWAYS run UMAP for global step
    // global_cluster_embeddings(embeddings, min(dim, len(embeddings) - 2))
    // n_neighbors = sqrt(n-1)
    let umap_dim = target_dim.min(n.saturating_sub(2)).max(2);
    let global_n_neighbors = ((n as f32 - 1.0).sqrt().ceil() as usize).max(2).min(n - 1);
    let reduced = if dim > umap_dim && n > umap_dim {
        tracing::info!("RAPTOR clustering: UMAP {}d → {}d for {} nodes (n_neighbors={})", dim, umap_dim, n, global_n_neighbors);
        umap_reduce(&data, umap_dim, global_n_neighbors, config.umap_n_epochs, rng)
    } else {
        tracing::info!("RAPTOR clustering: no reduction needed ({}d, {} nodes)", dim, n);
        data.clone()
    };

    // Guard: if reduced dimension is still > 50, full covariance GMM is unreliable
    // (estimating d*(d+1)/2 covariance params per cluster with potentially few samples).
    // Limit max_clusters to prevent degenerate fits.
    let effective_max_clusters = if reduced.ncols() > 50 {
        tracing::warn!("RAPTOR: GMM operating in {}d (> 50) — limiting max_clusters to prevent degenerate fits", reduced.ncols());
        config.max_clusters.min(n / (reduced.ncols() + 1)).max(2)
    } else {
        config.max_clusters
    };

    // Global GMM clustering
    let global_gmm = find_optimal_k(&reduced, effective_max_clusters, rng);
    let global_clusters = global_gmm.soft_assignments(&reduced, config.soft_cluster_threshold);

    // Local refinement for large clusters
    let mut final_clusters: Vec<Vec<usize>> = Vec::new();

    for cluster in &global_clusters {
        if cluster.is_empty() { continue; }

        // Paper line 93: if len(cluster) <= dim + 1, skip local clustering — single sub-cluster
        if cluster.len() <= umap_dim + 1 {
            final_clusters.push(cluster.clone());
            continue;
        }

        // Paper line 84-86: local clustering uses ORIGINAL high-dim embeddings
        let sub_data_orig = extract_rows(&data, cluster);
        // Paper line 97-98: local_cluster_embeddings(embeddings, dim) with n_neighbors=10
        let local_umap_dim = umap_dim.min(cluster.len().saturating_sub(2)).max(2);
        let local_n_neighbors = 10usize.min(cluster.len() - 1);
        let local_reduced = if sub_data_orig.ncols() > local_umap_dim && cluster.len() > local_umap_dim {
            umap_reduce(&sub_data_orig, local_umap_dim, local_n_neighbors, config.umap_n_epochs / 2, rng)
        } else {
            sub_data_orig
        };

        let local_gmm = find_optimal_k(&local_reduced, config.max_clusters.min(cluster.len() / 2).max(2), rng);
        let local_clusters = local_gmm.soft_assignments(&local_reduced, config.soft_cluster_threshold);

        // Map local indices back to global indices
        for local_cluster in &local_clusters {
            if local_cluster.is_empty() { continue; }
            let global_indices: Vec<usize> = local_cluster.iter()
                .map(|&local_i| cluster[local_i])
                .collect();
            final_clusters.push(global_indices);
        }
    }

    // Remove empty clusters
    final_clusters.retain(|c| !c.is_empty());

    if final_clusters.is_empty() {
        vec![(0..n).collect()]
    } else {
        final_clusters
    }
}

/// Recursively re-cluster oversized clusters (matching paper's max_length_in_cluster behavior).
/// If a cluster's total token count exceeds `max_tokens`, sub-cluster it using the same
/// hierarchical_cluster algorithm. Single-node clusters are never split further.
fn recluster_oversized(
    clusters: Vec<Vec<usize>>,
    contents: &[String],
    embeddings: &[&[f32]],
    max_tokens: usize,
    config: &RaptorConfig,
    depth: usize,
    rng: &mut impl Rng,
) -> Vec<Vec<usize>> {
    if depth > 3 { return clusters; } // safety limit

    let mut result: Vec<Vec<usize>> = Vec::new();

    for cluster in clusters {
        if cluster.len() <= 1 {
            result.push(cluster);
            continue;
        }

        let total_tokens: usize = cluster.iter()
            .map(|&i| contents[i].len() / 4)
            .sum();

        if total_tokens <= max_tokens {
            result.push(cluster);
            continue;
        }

        // Cluster is oversized — sub-cluster using its embeddings
        let sub_embeddings: Vec<&[f32]> = cluster.iter()
            .map(|&i| embeddings[i])
            .collect();
        let sub_clusters = hierarchical_cluster(&sub_embeddings, config, rng);

        // Map local indices back to global
        let mapped: Vec<Vec<usize>> = sub_clusters.into_iter()
            .filter(|c| !c.is_empty())
            .map(|sc| sc.iter().map(|&local_i| cluster[local_i]).collect())
            .collect();

        // If sub-clustering didn't actually split, keep as-is to avoid infinite loop
        if mapped.len() <= 1 {
            result.push(cluster);
        } else {
            tracing::info!("RAPTOR: re-clustered oversized cluster ({} tokens, {} nodes) into {} sub-clusters",
                total_tokens, cluster.len(), mapped.len());
            result.extend(recluster_oversized(mapped, contents, embeddings, max_tokens, config, depth + 1, rng));
        }
    }

    result
}

/// Convert Vec<Vec<f32>> to ndarray Array2.
fn vecs_to_array2(vecs: &[&[f32]], n: usize, d: usize) -> Array2<f32> {
    let mut arr = Array2::zeros((n, d));
    for i in 0..n {
        for j in 0..d.min(vecs[i].len()) {
            arr[[i, j]] = vecs[i][j];
        }
    }
    arr
}

/// Extract rows from a matrix by index.
fn extract_rows(data: &Array2<f32>, indices: &[usize]) -> Array2<f32> {
    let d = data.ncols();
    let mut sub = Array2::zeros((indices.len(), d));
    for (new_i, &orig_i) in indices.iter().enumerate() {
        sub.row_mut(new_i).assign(&data.row(orig_i));
    }
    sub
}

// ══════════════════════════════════════════════════════════════
// Recursive summarization (replaces hard truncation)
// ══════════════════════════════════════════════════════════════

/// Summarize a cluster's content. If too large, iteratively splits into groups,
/// summarizes each group in parallel, then combines. No recursion — avoids stack overflow.
async fn summarize_cluster(
    texts: &[String],
    gen_config: &RagGenModelConfig,
    filename: &str,
    level: usize,
    max_context_tokens: usize,
    db: &sqlx::SqlitePool,
    conversation_id: &str,
) -> Result<String, String> {
    let mut current_texts: Vec<String> = texts.to_vec();

    // Iteratively reduce until everything fits in one summarization call
    for _round in 0..10 {
        let combined = current_texts.join("\n\n---\n\n");
        if combined.len() / 4 <= max_context_tokens {
            return call_summarize(&combined, gen_config, filename, level, db, conversation_id).await;
        }

        // Split into groups that fit max_context_tokens each
        let mut groups: Vec<Vec<String>> = Vec::new();
        let mut current_group: Vec<String> = Vec::new();
        let mut current_len = 0usize;

        for text in &current_texts {
            let text_tokens = text.len() / 4;
            if !current_group.is_empty() && current_len + text_tokens > max_context_tokens {
                groups.push(std::mem::take(&mut current_group));
                current_len = 0;
            }
            current_len += text_tokens;
            current_group.push(text.clone());
        }
        if !current_group.is_empty() {
            groups.push(current_group);
        }

        // If we couldn't split (single text too large), just truncate and summarize
        if groups.len() <= 1 {
            let truncated = if combined.len() > max_context_tokens * 4 {
                let mut end = max_context_tokens * 4;
                while end > 0 && !combined.is_char_boundary(end) { end -= 1; }
                &combined[..end]
            } else {
                &combined
            };
            return call_summarize(truncated, gen_config, filename, level, db, conversation_id).await;
        }

        // Summarize each group in parallel
        use futures::stream::{self, StreamExt};
        let group_results: Vec<Result<String, String>> = stream::iter(groups.into_iter().map(|group| {
            let gen_cfg = gen_config.clone();
            let fname = filename.to_string();
            let db_pool = db.clone();
            let conv_id = conversation_id.to_string();
            async move {
                let group_text = group.join("\n\n---\n\n");
                call_summarize(&group_text, &gen_cfg, &fname, level, &db_pool, &conv_id).await
            }
        }))
        .buffer_unordered(match gen_config.provider_type.as_str() { "omlx" | "ollama" => 1, _ => 5 })
        .collect()
        .await;

        // Collect successful summaries, skip failures
        current_texts = Vec::new();
        for result in group_results {
            match result {
                Ok(summary) => current_texts.push(summary),
                Err(e) => tracing::warn!("RAPTOR: sub-group summarization failed, skipping: {}", e),
            }
        }

        if current_texts.is_empty() {
            return Err("All sub-group summarizations failed".to_string());
        }
    }

    // Fallback after too many rounds — just summarize what we have, truncated
    let combined = current_texts.join("\n\n---\n\n");
    let truncated = if combined.len() > max_context_tokens * 4 {
        let mut end = max_context_tokens * 4;
        while end > 0 && !combined.is_char_boundary(end) { end -= 1; }
        &combined[..end]
    } else {
        &combined
    };
    call_summarize(truncated, gen_config, filename, level, db, conversation_id).await
}

/// Make a single summarization LLM call with level-aware prompts.
async fn call_summarize(
    content: &str,
    gen_config: &RagGenModelConfig,
    filename: &str,
    level: usize,
    _db: &sqlx::SqlitePool,
    _conversation_id: &str,
) -> Result<String, String> {
    let system_prompt = if level <= 1 {
        format!(
            "You are summarizing sections of '{}'. Preserve ALL key details: entities, \
             relationships, dates, numbers, technical terms, and specific claims. Be thorough \
             — this summary replaces the original text for retrieval.",
            filename
        )
    } else {
        format!(
            "You are creating a high-level thematic summary of '{}'. Synthesize the following \
             summaries into a coherent overview that captures the main themes, arguments, and \
             conclusions. Preserve important entities and relationships but focus on the big picture.",
            filename
        )
    };

    let user_prompt = format!(
        "Summarize the following content, preserving all key concepts, entities, and relationships:\n\n{}",
        content
    );

    let _input_chars = content.len();
    let timeout_secs = match gen_config.provider_type.as_str() {
        "omlx" | "ollama" => 300,
        _ => 90,
    };
    let summary = tokio::time::timeout(
        std::time::Duration::from_secs(timeout_secs),
        super::retrieval::prompt_llm(gen_config, &system_prompt, &user_prompt),
    )
    .await
    .map_err(|_| format!("Summarization timed out after {}s for level {} of '{}'", timeout_secs, level, filename))?
    .map_err(|e| format!("Summarization failed: {}", e))?;

    Ok(summary)
}

// ══════════════════════════════════════════════════════════════
// Token-budget retrieval
// ══════════════════════════════════════════════════════════════

/// Select results by token budget (collapsed-tree approach from the paper).
/// Greedily adds candidates (sorted by relevance) until budget is exhausted.
pub fn select_by_token_budget(
    candidates: Vec<super::store::SearchResult>,
    budget: usize,
) -> Vec<super::store::SearchResult> {
    let mut selected = Vec::new();
    let mut tokens_used = 0;

    for candidate in candidates {
        let est_tokens = candidate.content.len() / 4;
        if tokens_used + est_tokens > budget && !selected.is_empty() {
            break;
        }
        tokens_used += est_tokens;
        selected.push(candidate);
    }

    selected
}

// ══════════════════════════════════════════════════════════════
// Tree traversal retrieval
// ══════════════════════════════════════════════════════════════

/// Batch-fetch child_ids from document_summaries for multiple parent IDs.
async fn fetch_child_ids_batch(db: &sqlx::SqlitePool, parent_ids: &[String]) -> Vec<String> {
    if parent_ids.is_empty() { return Vec::new(); }
    let placeholders = parent_ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let query_str = format!(
        "SELECT child_ids FROM document_summaries WHERE id IN ({}) AND child_ids IS NOT NULL",
        placeholders
    );
    let mut query = sqlx::query_scalar::<_, String>(&query_str);
    for id in parent_ids { query = query.bind(id); }
    let rows = match query.fetch_all(db).await {
        Ok(r) => r,
        Err(e) => {
            tracing::warn!("Failed to batch-fetch child_ids: {}", e);
            return Vec::new();
        }
    };
    let mut all_children = Vec::new();
    for json_str in rows {
        if let Ok(ids) = serde_json::from_str::<Vec<String>>(&json_str) {
            all_children.extend(ids);
        }
    }
    all_children.sort();
    all_children.dedup();
    all_children
}

/// Tree traversal retrieval matching the paper's `retrieve_information`.
/// Starts at the highest tree level, selects top-k nodes by similarity,
/// expands to their children, and repeats down to leaf chunks.
/// Returns nodes from ALL levels traversed (summaries + leaves).
pub async fn tree_traversal_search(
    query_embedding: &[f32],
    store: &VectorStore,
    db: &sqlx::SqlitePool,
    conversation_id: &str,
    top_k_per_level: usize,
    token_budget: usize,
) -> Result<Vec<super::store::SearchResult>, String> {
    // 1. Find max level in the tree
    let max_level = sqlx::query_scalar::<_, i64>(
        "SELECT COALESCE(MAX(level), 0) FROM document_summaries WHERE conversation_id = ?"
    )
    .bind(conversation_id)
    .fetch_one(db)
    .await
    .unwrap_or(0) as usize;

    if max_level == 0 {
        return Ok(Vec::new());
    }

    // 2. Search at the top level
    let top_results = store.search_by_level(query_embedding, top_k_per_level, max_level).await?;

    // 3. Collect all selected nodes across levels
    let mut all_selected: Vec<super::store::SearchResult> = Vec::new();
    let mut current_level_results = top_results;

    // 4. Traverse down
    for level in (1..=max_level).rev() {
        // Add current level's selected nodes to result set
        all_selected.extend(current_level_results.iter().cloned());

        if level == 1 { break; } // Next level is 0 (leaves) - handle separately

        // Look up child_ids for selected nodes
        let selected_ids: Vec<String> = current_level_results.iter()
            .map(|r| r.chunk_id.clone())
            .collect();

        if selected_ids.is_empty() { break; }

        // Batch query child_ids from SQLite
        let child_ids = fetch_child_ids_batch(db, &selected_ids).await;

        if child_ids.is_empty() {
            // Fallback: child_ids not populated (old tree format)
            // Search the next level down instead
            current_level_results = store.search_by_level(query_embedding, top_k_per_level, level - 1).await?;
            continue;
        }

        // Get children from LanceDB
        let children = store.get_by_ids(&child_ids).await?;

        if children.is_empty() {
            current_level_results = store.search_by_level(query_embedding, top_k_per_level, level - 1).await?;
            continue;
        }

        // Rank children by cosine similarity to query
        let mut scored: Vec<(super::store::SearchResult, f32)> = children.into_iter()
            .map(|node| {
                let sim = cosine_similarity(query_embedding, &node.embedding);
                let result = super::store::SearchResult {
                    chunk_id: node.chunk_id,
                    document_id: node.document_id,
                    filename: String::new(),
                    chunk_index: 0,
                    page_number: None,
                    section_name: None,
                    content: node.content,
                    start_offset: 0,
                    end_offset: 0,
                    relevance_score: sim,
                    level: node.level,
                };
                (result, sim)
            })
            .collect();

        scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
        scored.truncate(top_k_per_level);

        current_level_results = scored.into_iter().map(|(r, _)| r).collect();
    }

    // Final level: expand to leaf chunks (level 0)
    // Get child_ids of level-1 nodes
    let leaf_parent_ids: Vec<String> = current_level_results.iter()
        .map(|r| r.chunk_id.clone())
        .collect();
    all_selected.extend(current_level_results);

    // Batch fetch leaf child_ids
    let leaf_child_ids = fetch_child_ids_batch(db, &leaf_parent_ids).await;

    if !leaf_child_ids.is_empty() {
        let leaf_nodes = store.get_by_ids(&leaf_child_ids).await?;
        let mut leaf_scored: Vec<_> = leaf_nodes.into_iter()
            .map(|node| {
                let sim = cosine_similarity(query_embedding, &node.embedding);
                super::store::SearchResult {
                    chunk_id: node.chunk_id,
                    document_id: node.document_id,
                    filename: String::new(),
                    chunk_index: 0,
                    page_number: None,
                    section_name: None,
                    content: node.content,
                    start_offset: 0,
                    end_offset: 0,
                    relevance_score: sim,
                    level: node.level,
                }
            })
            .collect();
        leaf_scored.sort_by(|a, b| b.relevance_score.partial_cmp(&a.relevance_score).unwrap_or(std::cmp::Ordering::Equal));
        leaf_scored.truncate(top_k_per_level * 2); // Slightly more leaves
        all_selected.extend(leaf_scored);
    } else {
        // Fallback: search level 0 directly
        let leaves = store.search_by_level(query_embedding, top_k_per_level * 2, 0).await?;
        all_selected.extend(leaves);
    }

    // 5. Sort all selected by relevance and apply token budget
    all_selected.sort_by(|a, b| b.relevance_score.partial_cmp(&a.relevance_score).unwrap_or(std::cmp::Ordering::Equal));
    // Deduplicate by chunk_id
    let mut seen = std::collections::HashSet::new();
    all_selected.retain(|r| seen.insert(r.chunk_id.clone()));

    Ok(select_by_token_budget(all_selected, token_budget))
}

// ══════════════════════════════════════════════════════════════
// Cross-document RAPTOR tier (Tier 2)
// ══════════════════════════════════════════════════════════════

/// Build the cross-document RAPTOR tier (Tier 2).
///
/// Takes per-doc top-level summaries as input, clusters them to find
/// cross-document themes, and creates corpus-level summary nodes.
/// Uses membership-hash caching to skip re-summarizing unchanged clusters.
pub async fn build_cross_doc_tier(
    conversation_id: &str,
    per_doc_summaries: &[super::store::NodeWithEmbedding],
    embed_config: &EmbeddingConfig,
    gen_config: &RagGenModelConfig,
    vector_store: &VectorStore,
    db: &sqlx::SqlitePool,
    config: &RaptorConfig,
    emit_progress: impl Fn(&str),
) -> Result<usize, String> {
    // 1. Validate: need enough summaries to cluster
    if per_doc_summaries.len() < config.min_nodes_for_level {
        tracing::info!(
            "RAPTOR cross-doc: too few per-doc summaries ({}) to build tier, skipping",
            per_doc_summaries.len()
        );
        return Ok(0);
    }

    // 2. Determine base level: max level among inputs + 1
    let base_level = per_doc_summaries.iter()
        .map(|s| s.level)
        .max()
        .unwrap_or(0) + 1;

    tracing::info!(
        "RAPTOR cross-doc: starting tier build with {} per-doc summaries, base_level={}",
        per_doc_summaries.len(), base_level
    );

    // 3. Create seeded RNG
    let mut rng = match config.seed {
        Some(s) => rand::rngs::StdRng::seed_from_u64(s),
        None => rand::rngs::StdRng::from_entropy(),
    };

    // 4. Convert inputs to TreeNodes
    let mut current_nodes: Vec<TreeNode> = per_doc_summaries.iter()
        .map(|s| TreeNode {
            id: s.chunk_id.clone(),
            content: s.content.clone(),
            embedding: s.embedding.clone(),
            level: s.level,
            document_id: s.document_id.clone(),
            source_chunk_ids: vec![s.chunk_id.clone()],
        })
        .collect();

    let mut total_summaries = 0usize;

    // 5. Build levels
    for level in base_level..=(base_level + config.max_levels) {
        if current_nodes.len() < config.min_nodes_for_level {
            break;
        }

        emit_progress(&format!(
            "Building cross-doc RAPTOR level {} ({} nodes → clustering)...",
            level, current_nodes.len()
        ));

        // Hierarchical clustering: global UMAP+GMM → local refinement
        tracing::info!(
            "RAPTOR cross-doc level {}: starting clustering for {} nodes",
            level, current_nodes.len()
        );
        let embeddings_refs: Vec<&[f32]> = current_nodes.iter()
            .map(|n| n.embedding.as_slice())
            .collect();
        let clusters = hierarchical_cluster(&embeddings_refs, config, &mut rng);
        tracing::info!(
            "RAPTOR cross-doc level {}: clustering done → {} clusters",
            level, clusters.len()
        );

        // Re-cluster oversized clusters
        let contents: Vec<String> = current_nodes.iter().map(|n| n.content.clone()).collect();
        let clusters = recluster_oversized(
            clusters, &contents, &embeddings_refs,
            config.max_cluster_tokens, config, 0, &mut rng,
        );

        tracing::info!(
            "RAPTOR cross-doc level {}: {} nodes → {} clusters (soft, after re-clustering)",
            level, current_nodes.len(), clusters.len()
        );

        let non_empty_clusters: Vec<(usize, &Vec<usize>)> = clusters.iter().enumerate()
            .filter(|(_, c)| !c.is_empty())
            .collect();
        let total_clusters = non_empty_clusters.len();

        emit_progress(&format!(
            "Summarizing {} cross-doc clusters at level {} (parallel)...",
            total_clusters, level
        ));

        // For each cluster: compute membership hash, check cache, summarize if needed
        use std::collections::hash_map::DefaultHasher;
        use std::hash::{Hash, Hasher};

        // Prepare cluster data: (cluster_idx, texts, source_chunk_ids, child_node_ids, source_doc_ids, membership_hash)
        let cluster_inputs: Vec<(usize, Vec<String>, Vec<String>, Vec<String>, Vec<String>, String)> =
            non_empty_clusters.iter()
                .map(|&(cluster_idx, cluster_indices)| {
                    let cluster_texts: Vec<String> = cluster_indices.iter()
                        .map(|&i| current_nodes[i].content.clone())
                        .collect();
                    let source_ids: Vec<String> = cluster_indices.iter()
                        .flat_map(|&i| current_nodes[i].source_chunk_ids.clone())
                        .collect();
                    let child_node_ids: Vec<String> = cluster_indices.iter()
                        .map(|&i| current_nodes[i].id.clone())
                        .collect();
                    // Deduplicate source document IDs
                    let mut source_doc_ids: Vec<String> = cluster_indices.iter()
                        .map(|&i| current_nodes[i].document_id.clone())
                        .collect();
                    source_doc_ids.sort();
                    source_doc_ids.dedup();

                    // Compute membership hash from sorted child IDs
                    let mut member_ids: Vec<&str> = cluster_indices.iter()
                        .map(|&i| current_nodes[i].id.as_str())
                        .collect();
                    member_ids.sort();
                    let mut hasher = DefaultHasher::new();
                    member_ids.join(",").hash(&mut hasher);
                    let membership_hash = format!("{:016x}", hasher.finish());

                    (cluster_idx, cluster_texts, source_ids, child_node_ids, source_doc_ids, membership_hash)
                })
                .collect();

        // Check cache and summarize
        use futures::stream::{self, StreamExt};
        let summary_results: Vec<_> = stream::iter(cluster_inputs.into_iter().map(
            |(cluster_idx, cluster_texts, source_ids, child_node_ids, source_doc_ids, membership_hash)| {
                let gen_cfg = gen_config.clone();
                let db_pool = db.clone();
                let conv_id = conversation_id.to_string();
                let max_ctx = config.max_summary_context_tokens;
                async move {
                    // Check cache: look for existing summary with same membership hash
                    let cached: Option<(String, String)> = sqlx::query_as(
                        "SELECT id, content FROM document_summaries \
                         WHERE conversation_id = ? AND membership_hash = ? LIMIT 1"
                    )
                    .bind(&conv_id)
                    .bind(&membership_hash)
                    .fetch_optional(&db_pool)
                    .await
                    .ok()
                    .flatten();

                    let (summary, was_cached) = if let Some((_cached_id, cached_content)) = cached {
                        tracing::info!(
                            "RAPTOR: reusing cached summary for cluster {}",
                            cluster_idx
                        );
                        (Ok(cached_content), true)
                    } else {
                        // Not cached — call LLM
                        let result = summarize_cluster(
                            &cluster_texts, &gen_cfg, "multiple documents",
                            level, max_ctx, &db_pool, &conv_id,
                        ).await;
                        (result, false)
                    };

                    (cluster_idx, source_ids, child_node_ids, source_doc_ids, membership_hash, summary, was_cached)
                }
            }
        ))
        .buffer_unordered(match gen_config.provider_type.as_str() { "omlx" | "ollama" => 1, _ => 5 })
        .collect()
        .await;

        let mut level_nodes: Vec<TreeNode> = Vec::new();
        let mut level_summaries_for_db: Vec<(String, Vec<String>, Vec<String>, Vec<String>, String, String, i64)> = Vec::new();
        let mut parent_links: Vec<(String, Vec<String>)> = Vec::new();

        let mut succeeded = 0usize;
        let mut failed = 0usize;
        let mut cached_count = 0usize;

        for (cluster_idx, source_ids, child_node_ids, source_doc_ids, membership_hash, result, was_cached) in summary_results {
            match result {
                Ok(summary) => {
                    let summary_id = uuid::Uuid::new_v4().to_string();
                    let token_estimate = (summary.len() as i64) / 4;

                    level_summaries_for_db.push((
                        summary_id.clone(),
                        source_ids.clone(),
                        source_doc_ids,
                        child_node_ids.clone(),
                        membership_hash,
                        summary.clone(),
                        token_estimate,
                    ));
                    parent_links.push((summary_id.clone(), child_node_ids));

                    level_nodes.push(TreeNode {
                        id: summary_id,
                        content: summary,
                        embedding: Vec::new(),
                        level,
                        document_id: "__corpus__".to_string(),
                        source_chunk_ids: source_ids,
                    });
                    succeeded += 1;
                    if was_cached { cached_count += 1; }
                }
                Err(e) => {
                    tracing::warn!(
                        "RAPTOR cross-doc: summarization failed for cluster {}, skipping: {}",
                        cluster_idx, e
                    );
                    failed += 1;
                }
            }
        }

        if failed > 0 {
            tracing::info!(
                "RAPTOR cross-doc level {}: {}/{} clusters succeeded ({} cached), {} failed",
                level, succeeded, total_clusters, cached_count, failed
            );
        } else if cached_count > 0 {
            tracing::info!(
                "RAPTOR cross-doc level {}: {}/{} clusters succeeded ({} from cache)",
                level, succeeded, total_clusters, cached_count
            );
        }

        if level_nodes.is_empty() {
            break;
        }

        // Batch-embed all summaries for this level (even cached ones need embeddings)
        emit_progress(&format!(
            "Embedding {} cross-doc RAPTOR level {} summaries...",
            level_nodes.len(), level
        ));
        let texts: Vec<String> = level_nodes.iter().map(|n| n.content.clone()).collect();
        let embed_result = {
            let timeout_dur = std::time::Duration::from_secs(match embed_config.provider_type.as_str() { "omlx" | "ollama" => 300, _ => 120 });
            let first = tokio::time::timeout(
                timeout_dur,
                embeddings::embed_batch(embed_config, &texts),
            ).await;
            match first {
                Ok(Ok(r)) => r,
                Ok(Err(e)) => {
                    tracing::warn!(
                        "RAPTOR cross-doc embedding failed at level {}, retrying: {}",
                        level, e
                    );
                    tokio::time::timeout(
                        timeout_dur,
                        embeddings::embed_batch(embed_config, &texts),
                    )
                    .await
                    .map_err(|_| format!(
                        "RAPTOR cross-doc embedding timed out after retry at level {}", level
                    ))?
                    .map_err(|e| format!(
                        "RAPTOR cross-doc embedding failed after retry: {}", e
                    ))?
                }
                Err(_) => {
                    tracing::warn!(
                        "RAPTOR cross-doc embedding timed out at level {}, retrying once...",
                        level
                    );
                    tokio::time::timeout(
                        timeout_dur,
                        embeddings::embed_batch(embed_config, &texts),
                    )
                    .await
                    .map_err(|_| format!(
                        "RAPTOR cross-doc embedding timed out after retry at level {}", level
                    ))?
                    .map_err(|e| format!(
                        "RAPTOR cross-doc embedding failed after retry: {}", e
                    ))?
                }
            }
        };

        // Cost tracking removed for wren (no per-conversation billing)

        for (i, embedding) in embed_result.embeddings.into_iter().enumerate() {
            level_nodes[i].embedding = embedding;
        }

        // Store summaries in LanceDB vector store
        let summary_nodes: Vec<RaptorSummaryNode> = level_nodes.iter()
            .map(|n| RaptorSummaryNode {
                id: n.id.clone(),
                document_id: "__corpus__".to_string(),
                level: n.level,
                content: n.content.clone(),
            })
            .collect();
        let summary_embeddings: Vec<Vec<f32>> = level_nodes.iter()
            .map(|n| n.embedding.clone())
            .collect();

        vector_store
            .upsert_summaries(&summary_nodes, &summary_embeddings, "corpus_summary")
            .await?;

        // Store in SQLite with cross-doc columns.
        // We need to disable FK checks because document_summaries.document_id has a
        // REFERENCES documents(id) constraint, and '__corpus__' is a virtual document_id
        // that doesn't exist in the documents table.
        {
            let mut conn = db.acquire().await.map_err(|e| format!("Failed to acquire DB connection: {}", e))?;
            sqlx::query("PRAGMA foreign_keys = OFF")
                .execute(&mut *conn)
                .await
                .map_err(|e| format!("Failed to disable FK checks: {}", e))?;

            for (summary_id, source_ids, source_doc_ids, child_ids, membership_hash, content, token_estimate)
                in &level_summaries_for_db
            {
                let source_json = serde_json::to_string(source_ids).unwrap_or_default();
                let source_docs_json = serde_json::to_string(source_doc_ids).unwrap_or_default();
                let child_ids_json = serde_json::to_string(child_ids).unwrap_or_default();
                if let Err(e) = sqlx::query(
                    "INSERT OR REPLACE INTO document_summaries \
                     (id, document_id, conversation_id, level, source_chunk_ids, source_document_ids, \
                      child_ids, content, token_estimate, membership_hash) \
                     VALUES (?, '__corpus__', ?, ?, ?, ?, ?, ?, ?, ?)"
                )
                .bind(summary_id)
                .bind(conversation_id)
                .bind(level as i64)
                .bind(&source_json)
                .bind(&source_docs_json)
                .bind(&child_ids_json)
                .bind(content)
                .bind(token_estimate)
                .bind(membership_hash)
                .execute(&mut *conn)
                .await {
                    tracing::warn!("RAPTOR cross-doc: failed to insert corpus summary {}: {}", summary_id, e);
                }
            }

            // Backfill parent_summary_id on child summaries
            // (all cross-doc levels qualify since children are always summaries, not leaf chunks)
            if level >= base_level + 1 {
                for (parent_id, child_ids) in &parent_links {
                    for child_id in child_ids {
                        let _ = sqlx::query(
                            "UPDATE document_summaries SET parent_summary_id = ? WHERE id = ?",
                        )
                        .bind(parent_id)
                        .bind(child_id)
                        .execute(&mut *conn)
                        .await;
                    }
                }
            }

            if let Err(e) = sqlx::query("PRAGMA foreign_keys = ON")
                .execute(&mut *conn)
                .await
            {
                tracing::error!("Failed to re-enable foreign_keys on connection: {}", e);
            }
        }

        total_summaries += level_nodes.len();
        tracing::info!(
            "RAPTOR cross-doc: built level {} with {} summaries ({} cached)",
            level, level_nodes.len(), cached_count
        );

        // Current level's nodes become input for next level
        current_nodes = level_nodes;
    }

    Ok(total_summaries)
}

// ══════════════════════════════════════════════════════════════
// Main tree builder
// ══════════════════════════════════════════════════════════════

/// Build a RAPTOR tree for a document.
///
/// Uses existing chunk embeddings directly (no re-chunking/re-embedding).
/// For each level: UMAP (>50 nodes) → GMM (BIC with early-stop) → soft cluster
/// → parallel summarize (5 concurrent, 90s timeout) → embed → store.
/// Returns total number of summary nodes created.
pub async fn build_raptor_tree(
    document_id: &str,
    filename: &str,
    chunk_ids: &[String],
    chunk_contents: &[String],
    chunk_embeddings: &[Vec<f32>],
    embed_config: &EmbeddingConfig,
    gen_config: &RagGenModelConfig,
    vector_store: &VectorStore,
    db: &sqlx::SqlitePool,
    conversation_id: &str,
    config: &RaptorConfig,
    emit_progress: impl Fn(&str),
) -> Result<usize, String> {
    let mut rng = match config.seed {
        Some(s) => rand::rngs::StdRng::seed_from_u64(s),
        None => rand::rngs::StdRng::from_entropy(),
    };

    if chunk_ids.len() < config.min_nodes_for_level {
        tracing::info!("RAPTOR: too few chunks ({}) to build tree, skipping", chunk_ids.len());
        return Ok(0);
    }

    // Use original chunks and their existing embeddings directly — avoids
    // expensive re-chunking and re-embedding. Our ~375-token chunks are close
    // enough to the paper's 100-token chunks for effective clustering.
    let mut current_nodes: Vec<TreeNode> = chunk_ids.iter()
        .zip(chunk_contents.iter())
        .zip(chunk_embeddings.iter())
        .map(|((id, content), embedding)| TreeNode {
            id: id.clone(),
            content: content.clone(),
            embedding: embedding.clone(),
            level: 0,
            document_id: document_id.to_string(),
            source_chunk_ids: vec![id.clone()],
        })
        .collect();

    tracing::info!("RAPTOR: starting tree build with {} leaf chunks for {}", current_nodes.len(), filename);

    let mut total_summaries = 0usize;

    // Step 2: Build tree levels
    for level in 1..=config.max_levels {
        if current_nodes.len() < config.min_nodes_for_level {
            break;
        }

        emit_progress(&format!(
            "Building RAPTOR level {} ({} nodes → clustering)...",
            level,
            current_nodes.len()
        ));

        // Hierarchical clustering: global UMAP+GMM → local refinement
        tracing::info!("RAPTOR level {}: starting clustering for {} nodes", level, current_nodes.len());
        let embeddings_refs: Vec<&[f32]> = current_nodes.iter()
            .map(|n| n.embedding.as_slice())
            .collect();
        let clusters = hierarchical_cluster(&embeddings_refs, config, &mut rng);
        tracing::info!("RAPTOR level {}: clustering done → {} clusters", level, clusters.len());

        // Re-cluster oversized clusters (paper: max_length_in_cluster = 3500)
        let contents: Vec<String> = current_nodes.iter().map(|n| n.content.clone()).collect();
        let clusters = recluster_oversized(clusters, &contents, &embeddings_refs, config.max_cluster_tokens, config, 0, &mut rng);

        tracing::info!(
            "RAPTOR level {}: {} nodes → {} clusters (soft, after re-clustering)",
            level, current_nodes.len(), clusters.len()
        );

        // Summarize all clusters in parallel (up to 5 concurrent)
        let non_empty_clusters: Vec<(usize, &Vec<usize>)> = clusters.iter().enumerate()
            .filter(|(_, c)| !c.is_empty())
            .collect();
        let total_clusters = non_empty_clusters.len();

        emit_progress(&format!(
            "Summarizing {} clusters at level {} (parallel)...",
            total_clusters, level
        ));

        // Prepare cluster data before spawning futures (borrow checker)
        // Also collect the IDs of direct child nodes for parent_summary_id tracking
        let cluster_inputs: Vec<(usize, Vec<String>, Vec<String>, Vec<String>)> = non_empty_clusters.iter()
            .map(|&(cluster_idx, cluster_indices)| {
                let cluster_texts: Vec<String> = cluster_indices.iter()
                    .map(|&i| current_nodes[i].content.clone())
                    .collect();
                let source_ids: Vec<String> = cluster_indices.iter()
                    .flat_map(|&i| current_nodes[i].source_chunk_ids.clone())
                    .collect();
                let child_node_ids: Vec<String> = cluster_indices.iter()
                    .map(|&i| current_nodes[i].id.clone())
                    .collect();
                (cluster_idx, cluster_texts, source_ids, child_node_ids)
            })
            .collect();

        // Run summarizations with concurrency limit of 5
        use futures::stream::{self, StreamExt};
        let summary_results: Vec<_> = stream::iter(cluster_inputs.into_iter().map(|(cluster_idx, cluster_texts, source_ids, child_node_ids)| {
            let gen_cfg = gen_config.clone();
            let fname = filename.to_string();
            let db_pool = db.clone();
            let conv_id = conversation_id.to_string();
            let max_ctx = config.max_summary_context_tokens;
            async move {
                let result = summarize_cluster(
                    &cluster_texts, &gen_cfg, &fname, level, max_ctx, &db_pool, &conv_id,
                ).await;
                (cluster_idx, source_ids, child_node_ids, result)
            }
        }))
        .buffer_unordered(match gen_config.provider_type.as_str() { "omlx" | "ollama" => 1, _ => 5 })
        .collect()
        .await;

        let mut level_nodes: Vec<TreeNode> = Vec::new();
        let mut level_summaries_for_db: Vec<(String, Vec<String>, Vec<String>, String, i64)> = Vec::new();
        // Track summary_id → child_node_ids for parent_summary_id backfill
        let mut parent_links: Vec<(String, Vec<String>)> = Vec::new();

        let mut succeeded = 0usize;
        let mut failed = 0usize;
        for (cluster_idx, source_ids, child_node_ids, result) in summary_results {
            match result {
                Ok(summary) => {
                    let summary_id = uuid::Uuid::new_v4().to_string();
                    let token_estimate = (summary.len() as i64) / 4;

                    level_summaries_for_db.push((
                        summary_id.clone(),
                        source_ids.clone(),
                        child_node_ids.clone(),
                        summary.clone(),
                        token_estimate,
                    ));
                    parent_links.push((summary_id.clone(), child_node_ids));

                    level_nodes.push(TreeNode {
                        id: summary_id,
                        content: summary,
                        embedding: Vec::new(),
                        level,
                        document_id: document_id.to_string(),
                        source_chunk_ids: source_ids,
                    });
                    succeeded += 1;
                }
                Err(e) => {
                    tracing::warn!("RAPTOR: summarization failed for cluster {}, skipping: {}", cluster_idx, e);
                    failed += 1;
                }
            }
        }

        if failed > 0 {
            tracing::info!("RAPTOR level {}: {}/{} clusters succeeded, {} failed/timed out", level, succeeded, total_clusters, failed);
        }

        if level_nodes.is_empty() {
            break;
        }

        // Batch-embed all summaries for this level
        emit_progress(&format!("Embedding {} RAPTOR level {} summaries...", level_nodes.len(), level));
        let texts: Vec<String> = level_nodes.iter().map(|n| n.content.clone()).collect();
        let embed_result = {
            let timeout_dur = std::time::Duration::from_secs(match embed_config.provider_type.as_str() { "omlx" | "ollama" => 300, _ => 120 });
            let first = tokio::time::timeout(timeout_dur, embeddings::embed_batch(embed_config, &texts)).await;
            match first {
                Ok(Ok(r)) => r,
                Ok(Err(e)) => {
                    tracing::warn!("RAPTOR embedding failed at level {}, retrying: {}", level, e);
                    tokio::time::timeout(timeout_dur, embeddings::embed_batch(embed_config, &texts))
                        .await
                        .map_err(|_| format!("RAPTOR embedding timed out after retry at level {}", level))?
                        .map_err(|e| format!("RAPTOR embedding failed after retry: {}", e))?
                }
                Err(_) => {
                    tracing::warn!("RAPTOR embedding timed out at level {}, retrying once...", level);
                    tokio::time::timeout(timeout_dur, embeddings::embed_batch(embed_config, &texts))
                        .await
                        .map_err(|_| format!("RAPTOR embedding timed out after retry at level {}", level))?
                        .map_err(|e| format!("RAPTOR embedding failed after retry: {}", e))?
                }
            }
        };

        // Cost tracking removed for wren (no per-conversation billing)

        for (i, embedding) in embed_result.embeddings.into_iter().enumerate() {
            level_nodes[i].embedding = embedding;
        }

        // Store summaries in vector store
        let summary_nodes: Vec<RaptorSummaryNode> = level_nodes.iter()
            .map(|n| RaptorSummaryNode {
                id: n.id.clone(),
                document_id: n.document_id.clone(),
                level: n.level,
                content: n.content.clone(),
            })
            .collect();
        let summary_embeddings: Vec<Vec<f32>> = level_nodes.iter()
            .map(|n| n.embedding.clone())
            .collect();

        vector_store
            .upsert_summaries(&summary_nodes, &summary_embeddings, filename)
            .await?;

        // Store in SQLite for metadata
        for (summary_id, source_ids, child_ids, content, token_estimate) in &level_summaries_for_db {
            let source_json = serde_json::to_string(source_ids).unwrap_or_default();
            let child_ids_json = serde_json::to_string(child_ids).unwrap_or_default();
            let _ = sqlx::query(
                "INSERT OR REPLACE INTO document_summaries \
                 (id, document_id, conversation_id, level, source_chunk_ids, child_ids, content, token_estimate) \
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(summary_id)
            .bind(document_id)
            .bind(conversation_id)
            .bind(level as i64)
            .bind(&source_json)
            .bind(&child_ids_json)
            .bind(content)
            .bind(token_estimate)
            .execute(db)
            .await;
        }

        // Backfill parent_summary_id on child summaries (level >= 2 only;
        // level-1 children are leaf chunks which live in document_chunks, not document_summaries)
        if level >= 2 {
            for (parent_id, child_ids) in &parent_links {
                for child_id in child_ids {
                    let _ = sqlx::query(
                        "UPDATE document_summaries SET parent_summary_id = ? WHERE id = ?",
                    )
                    .bind(parent_id)
                    .bind(child_id)
                    .execute(db)
                    .await;
                }
            }
        }

        total_summaries += level_nodes.len();
        tracing::info!(
            "RAPTOR: built level {} with {} summaries for document {}",
            level, level_nodes.len(), document_id
        );

        // Current level's nodes become input for next level
        current_nodes = level_nodes;
    }

    Ok(total_summaries)
}

// ══════════════════════════════════════════════════════════════
// Tests
// ══════════════════════════════════════════════════════════════

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_gmm_basic_clustering() {
        // Create two well-separated clusters in 2D
        let mut data = Array2::zeros((20, 2));
        for i in 0..10 {
            data[[i, 0]] = i as f32 * 0.1;
            data[[i, 1]] = i as f32 * 0.1;
        }
        for i in 10..20 {
            data[[i, 0]] = 10.0 + i as f32 * 0.1;
            data[[i, 1]] = 10.0 + i as f32 * 0.1;
        }

        let mut rng = rand::rngs::StdRng::seed_from_u64(42);
        let gmm = GaussianMixture::fit(&data, 2, 50, 1e-4, &mut rng);
        let clusters = gmm.soft_assignments(&data, 0.1);

        // Should have 2 non-empty clusters
        let non_empty: Vec<_> = clusters.iter().filter(|c| !c.is_empty()).collect();
        assert_eq!(non_empty.len(), 2, "Should find 2 clusters for well-separated data");
    }

    #[test]
    fn test_bic_selects_reasonable_k() {
        // 3 clear clusters in 2D
        let mut data = Array2::zeros((30, 2));
        for i in 0..10 {
            data[[i, 0]] = i as f32 * 0.1;
            data[[i, 1]] = 0.0;
        }
        for i in 10..20 {
            data[[i, 0]] = 10.0 + i as f32 * 0.1;
            data[[i, 1]] = 0.0;
        }
        for i in 20..30 {
            data[[i, 0]] = 20.0 + i as f32 * 0.1;
            data[[i, 1]] = 0.0;
        }

        let mut rng = rand::rngs::StdRng::seed_from_u64(42);
        let gmm = find_optimal_k(&data, 10, &mut rng);
        // BIC should select k=2 or k=3 for well-separated data
        assert!(gmm.k >= 2 && gmm.k <= 4, "BIC selected k={}, expected 2-4", gmm.k);
    }

    #[test]
    fn test_soft_clustering_allows_overlap() {
        // Create data where middle points should belong to both clusters
        let mut data = Array2::zeros((12, 2));
        // Cluster 1: left
        for i in 0..4 {
            data[[i, 0]] = -5.0 + i as f32 * 0.1;
            data[[i, 1]] = 0.0;
        }
        // Middle points (ambiguous)
        for i in 4..8 {
            data[[i, 0]] = 0.0 + i as f32 * 0.1;
            data[[i, 1]] = 0.0;
        }
        // Cluster 2: right
        for i in 8..12 {
            data[[i, 0]] = 5.0 + i as f32 * 0.1;
            data[[i, 1]] = 0.0;
        }

        let mut rng = rand::rngs::StdRng::seed_from_u64(42);
        let gmm = GaussianMixture::fit(&data, 2, 50, 1e-4, &mut rng);
        let clusters = gmm.soft_assignments(&data, 0.1);

        // With soft clustering and low threshold, some nodes should appear in multiple clusters
        let total_assignments: usize = clusters.iter().map(|c| c.len()).sum();
        assert!(total_assignments >= 12, "Soft clustering should assign all nodes (got {})", total_assignments);
    }

    #[test]
    fn test_umap_reduces_dimensions() {
        let n = 20;
        let d = 50;
        let mut data = Array2::zeros((n, d));
        for i in 0..n {
            for j in 0..d {
                data[[i, j]] = (i * d + j) as f32 * 0.01;
            }
        }

        let mut rng = rand::rngs::StdRng::seed_from_u64(42);
        let reduced = umap_reduce(&data, 5, 10, 50, &mut rng);
        assert_eq!(reduced.nrows(), n);
        assert_eq!(reduced.ncols(), 5);
    }

    #[test]
    fn test_token_budget_selection() {
        use super::super::store::SearchResult;

        let candidates = vec![
            SearchResult {
                chunk_id: "a".into(), document_id: "d".into(), filename: "f".into(),
                chunk_index: 0, page_number: None, section_name: None,
                content: "x".repeat(400), // ~100 tokens
                start_offset: 0, end_offset: 400, relevance_score: 0.9, level: 0,
            },
            SearchResult {
                chunk_id: "b".into(), document_id: "d".into(), filename: "f".into(),
                chunk_index: 1, page_number: None, section_name: None,
                content: "y".repeat(400), // ~100 tokens
                start_offset: 0, end_offset: 400, relevance_score: 0.8, level: 1,
            },
            SearchResult {
                chunk_id: "c".into(), document_id: "d".into(), filename: "f".into(),
                chunk_index: 2, page_number: None, section_name: None,
                content: "z".repeat(8000), // ~2000 tokens
                start_offset: 0, end_offset: 8000, relevance_score: 0.7, level: 0,
            },
        ];

        let selected = select_by_token_budget(candidates, 250);
        assert_eq!(selected.len(), 2, "Should include 2 results within 250 token budget");
    }

    #[test]
    fn test_hierarchical_cluster_produces_clusters() {
        // 20 points in 10D forming 2 clear groups
        let config = RaptorConfig::default();
        let mut embeddings: Vec<Vec<f32>> = Vec::new();
        for i in 0..10 {
            let mut v = vec![0.0f32; 10];
            v[0] = i as f32 * 0.1;
            v[1] = i as f32 * 0.1;
            embeddings.push(v);
        }
        for i in 0..10 {
            let mut v = vec![0.0f32; 10];
            v[0] = 10.0 + i as f32 * 0.1;
            v[1] = 10.0 + i as f32 * 0.1;
            embeddings.push(v);
        }

        let mut rng = rand::rngs::StdRng::seed_from_u64(42);
        let clusters = hierarchical_cluster(&embeddings, &config, &mut rng);
        assert!(!clusters.is_empty(), "Should produce at least one cluster");

        // All 20 nodes should be assigned to at least one cluster
        let mut assigned: std::collections::HashSet<usize> = std::collections::HashSet::new();
        for cluster in &clusters {
            for &idx in cluster {
                assigned.insert(idx);
            }
        }
        assert_eq!(assigned.len(), 20, "All 20 nodes should be assigned");
    }

    #[test]
    fn test_hierarchical_cluster_small_input() {
        // Fewer than 4 nodes → single cluster
        let config = RaptorConfig::default();
        let embeddings = vec![
            vec![1.0, 0.0, 0.0],
            vec![0.0, 1.0, 0.0],
            vec![0.0, 0.0, 1.0],
        ];

        let mut rng = rand::rngs::StdRng::seed_from_u64(42);
        let clusters = hierarchical_cluster(&embeddings, &config, &mut rng);
        assert_eq!(clusters.len(), 1, "3 nodes should produce single cluster (below min threshold)");
        assert_eq!(clusters[0].len(), 3);
    }

    #[test]
    fn test_recluster_oversized() {
        let config = RaptorConfig::default();
        // Create a cluster where total tokens exceed max_cluster_tokens
        let contents: Vec<String> = (0..20).map(|i| format!("Content block {} {}", i, "x".repeat(800))).collect();
        let embeddings: Vec<Vec<f32>> = (0..20).map(|i| {
            let mut v = vec![0.0f32; 10];
            // Two groups: first 10 near origin, last 10 far away
            if i >= 10 { v[0] = 10.0; v[1] = 10.0; }
            v[0] += i as f32 * 0.1;
            v
        }).collect();

        // Single oversized cluster containing all 20 nodes (~4000 tokens total)
        let clusters = vec![(0..20).collect::<Vec<usize>>()];
        let mut rng = rand::rngs::StdRng::seed_from_u64(42);
        let result = recluster_oversized(clusters, &contents, &embeddings, 1000, &config, 0, &mut rng);

        // Should have been split into multiple clusters
        assert!(result.len() > 1, "Oversized cluster should be re-split (got {} clusters)", result.len());
    }

    #[test]
    fn test_recluster_small_cluster_unchanged() {
        let config = RaptorConfig::default();
        let contents = vec!["short".to_string(), "text".to_string()];
        let embeddings = vec![vec![1.0, 0.0], vec![0.0, 1.0]];

        let clusters = vec![vec![0, 1]];
        let mut rng = rand::rngs::StdRng::seed_from_u64(42);
        let result = recluster_oversized(clusters.clone(), &contents, &embeddings, 3500, &config, 0, &mut rng);

        assert_eq!(result.len(), 1, "Small cluster should not be re-split");
        assert_eq!(result[0], vec![0, 1]);
    }

    #[test]
    fn test_find_optimal_k_early_stop() {
        // Well-separated data: BIC should find optimum quickly
        let mut data = Array2::zeros((40, 2));
        for i in 0..20 {
            data[[i, 0]] = i as f32 * 0.1;
            data[[i, 1]] = 0.0;
        }
        for i in 20..40 {
            data[[i, 0]] = 20.0 + (i - 20) as f32 * 0.1;
            data[[i, 1]] = 0.0;
        }

        let mut rng = rand::rngs::StdRng::seed_from_u64(42);
        let gmm = find_optimal_k(&data, 20, &mut rng);
        assert!(gmm.k >= 2 && gmm.k <= 5, "Should find k=2-5, got k={}", gmm.k);
    }

    #[test]
    fn test_identical_embeddings_dont_panic() {
        // All identical points — GMM should not panic
        let data = Array2::from_elem((10, 3), 1.0_f32);
        let mut rng = rand::rngs::StdRng::seed_from_u64(42);
        let gmm = GaussianMixture::fit(&data, 2, 20, 1e-4, &mut rng);
        // Should still produce assignments without panicking
        let clusters = gmm.soft_assignments(&data, 0.1);
        let total: usize = clusters.iter().map(|c| c.len()).sum();
        assert!(total >= 10, "All points should be assigned even with identical embeddings");
    }

    #[test]
    fn test_umap_very_small_input() {
        // 2 points — should return without crashing
        let data = Array2::from_shape_vec((2, 5), vec![1.0; 10]).unwrap();
        let mut rng = rand::rngs::StdRng::seed_from_u64(42);
        let reduced = umap_reduce(&data, 3, 1, 10, &mut rng);
        assert_eq!(reduced.nrows(), 2);
        assert_eq!(reduced.ncols(), 3);
    }

    #[test]
    fn test_seeded_clustering_is_deterministic() {
        let embeddings: Vec<Vec<f32>> = (0..20).map(|i| {
            let mut v = vec![0.0f32; 10];
            if i < 10 { v[0] = i as f32 * 0.1; v[1] = i as f32 * 0.1; }
            else { v[0] = 10.0 + i as f32 * 0.1; v[1] = 10.0 + i as f32 * 0.1; }
            v
        }).collect();
        let config = RaptorConfig::default();

        let mut rng1 = rand::rngs::StdRng::seed_from_u64(42);
        let clusters1 = hierarchical_cluster(&embeddings, &config, &mut rng1);

        let mut rng2 = rand::rngs::StdRng::seed_from_u64(42);
        let clusters2 = hierarchical_cluster(&embeddings, &config, &mut rng2);

        assert_eq!(clusters1, clusters2, "Same seed should produce identical clusters");
    }

    #[test]
    fn test_knn_parallel_correctness() {
        // Verify parallel kNN produces valid results
        let n = 200;
        let d = 50;
        let data = Array2::from_shape_fn((n, d), |(i, j)| ((i * d + j) as f32 * 0.001).sin());
        let k = 10;

        let (indices, distances) = build_knn_graph(&data, k);

        assert_eq!(indices.len(), n);
        assert_eq!(distances.len(), n);
        for i in 0..n {
            assert_eq!(indices[i].len(), k, "Row {} should have {} neighbors", i, k);
            assert_eq!(distances[i].len(), k);
            // Distances should be sorted ascending
            for w in distances[i].windows(2) {
                assert!(w[0] <= w[1] + 1e-6, "Distances not sorted for row {}", i);
            }
            // No self-loops
            assert!(!indices[i].contains(&i), "Row {} contains self-loop", i);
        }
    }
}
