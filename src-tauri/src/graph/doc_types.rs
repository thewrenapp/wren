/// Curated category/type lists for each document type.
///
/// The LLM extraction prompt includes the appropriate lists based on
/// `document_type` from the classifier stage.

pub struct DocTypeConfig {
    pub entity_categories: &'static [&'static str],
    pub claim_types: &'static [&'static str],
    pub relation_types: &'static [&'static str],
    pub extraction_guidance: &'static str,
    /// Concrete examples of claims to extract for this document type.
    /// Included verbatim in the prompt so the LLM knows what to look for.
    pub claim_examples: &'static str,
}

// ── Document-type configs ────────────────────────────────────────────

static RESEARCH_PAPER: DocTypeConfig = DocTypeConfig {
    entity_categories: &[
        "concept", "method", "model", "dataset", "metric", "theory",
        "task", "material", "algorithm", "framework",
    ],
    claim_types: &[
        "finding", "hypothesis", "conclusion", "limitation", "observation",
    ],
    relation_types: &[
        "introduces", "uses", "discusses", "extends", "critiques",
        "compares", "evaluates",
    ],
    extraction_guidance: "Focus on scientific contributions: novel methods, key findings, datasets used, baseline comparisons, and limitations acknowledged by the authors.",
    claim_examples: r#"- Quantitative results ("achieves 95% accuracy", "reduces error by 30%")
- Comparisons ("outperforms X on Y", "faster than baseline")
- Design choices ("we use X because Y", "the model consists of N layers")
- Motivations ("existing methods fail to...", "there is a gap in...")
- Background facts ("X is widely used for Y")
- Limitations ("does not handle X", "assumes Y")
- Methodological details ("trained on N samples", "uses learning rate of 0.001")"#,
};

static LEGAL_CASE: DocTypeConfig = DocTypeConfig {
    entity_categories: &[
        "legal_principle", "statute", "regulation", "jurisdiction",
        "party", "precedent", "doctrine", "remedy",
    ],
    claim_types: &[
        "holding", "ruling", "dissent", "reasoning", "obiter_dictum",
    ],
    relation_types: &[
        "applies", "distinguishes", "overrules", "cites", "interprets",
        "discusses",
    ],
    extraction_guidance: "Focus on the legal holdings, statutes applied, precedents cited or distinguished, and the court's reasoning.",
    claim_examples: r#"- Holdings ("the court held that X")
- Interpretations of law ("section 5 requires X", "the statute does not apply to Y")
- Factual findings ("the defendant was aware of...", "the evidence shows...")
- Reasoning ("because X, the court concludes Y")
- Procedural rulings ("the motion to dismiss is granted")
- Distinctions ("unlike in Smith v. Jones, here...")"#,
};

static PATENT: DocTypeConfig = DocTypeConfig {
    entity_categories: &[
        "invention", "prior_art", "technical_field", "application_domain",
        "component", "material",
    ],
    claim_types: &[
        "claim", "disclosure", "advantage", "limitation",
    ],
    relation_types: &[
        "claims", "discloses", "references", "improves_upon", "discusses",
    ],
    extraction_guidance: "Focus on the claimed invention, prior art referenced, technical advantages, and the scope of the claims.",
    claim_examples: r#"- Technical claims ("a system comprising X and Y")
- Advantages over prior art ("reduces processing time by X", "eliminates the need for Y")
- Design specifications ("the component operates at N degrees")
- Scope limitations ("limited to the field of X")
- Prior art shortcomings ("existing solutions fail to...")"#,
};

static THESIS: DocTypeConfig = DocTypeConfig {
    entity_categories: &[
        "concept", "method", "theory", "framework", "research_question",
        "contribution",
    ],
    claim_types: &[
        "finding", "hypothesis", "conclusion", "limitation", "definition",
        "argument",
    ],
    relation_types: &[
        "introduces", "uses", "discusses", "extends", "critiques", "defines",
    ],
    extraction_guidance: "Focus on the research questions, methodology, key contributions, theoretical framework, and conclusions.",
    claim_examples: r#"- Research questions ("this thesis investigates whether X")
- Hypotheses ("we hypothesize that X leads to Y")
- Findings ("the results show X", "participants reported Y")
- Methodological choices ("we use X because Y", "N participants were recruited")
- Contributions ("this work is the first to...", "we extend X by...")
- Limitations ("the sample size was limited to...", "does not account for...")"#,
};

static BOOK: DocTypeConfig = DocTypeConfig {
    entity_categories: &[
        "theme", "concept", "theory", "argument", "framework", "person",
        "event", "movement",
    ],
    claim_types: &[
        "thesis", "argument", "critique", "definition", "observation",
    ],
    relation_types: &[
        "introduces", "discusses", "argues", "critiques", "synthesizes",
        "defines",
    ],
    extraction_guidance: "Focus on the central arguments, key themes, theoretical positions, and important definitions or frameworks introduced.",
    claim_examples: r#"- Central arguments ("the author argues that X")
- Definitions ("X is defined as Y", "by Z, the author means...")
- Historical claims ("X led to Y", "in the 1990s, Z became...")
- Critiques ("previous accounts of X overlook Y")
- Causal claims ("X is caused by Y", "X contributes to Y")
- Observations ("X is a common pattern in Y")"#,
};

static STATUTE: DocTypeConfig = DocTypeConfig {
    entity_categories: &[
        "provision", "definition", "requirement", "penalty", "exception",
        "jurisdiction",
    ],
    claim_types: &[
        "requirement", "prohibition", "exception", "definition",
    ],
    relation_types: &[
        "defines", "requires", "prohibits", "amends", "references",
    ],
    extraction_guidance: "Focus on key provisions, defined terms, requirements imposed, exceptions, and cross-references to other legislation.",
    claim_examples: r#"- Requirements ("every employer must provide X")
- Prohibitions ("it is unlawful to X")
- Definitions ("for the purposes of this Act, X means Y")
- Penalties ("a fine not exceeding X", "imprisonment for up to Y years")
- Exceptions ("this section does not apply to X")
- Thresholds ("applies to organizations with more than N employees")"#,
};

static WEBPAGE_REPORT: DocTypeConfig = DocTypeConfig {
    entity_categories: &[
        "topic", "entity", "event", "statistic", "organization",
        "technology",
    ],
    claim_types: &[
        "assertion", "statistic", "prediction", "recommendation",
    ],
    relation_types: &[
        "discusses", "mentions", "references", "analyzes", "reports",
    ],
    extraction_guidance: "Focus on the main topics covered, key statistics or data points, organizations mentioned, and any predictions or recommendations.",
    claim_examples: r#"- Statistics ("X increased by 30% in 2024", "N users were affected")
- Predictions ("X is expected to reach Y by 2030")
- Recommendations ("organizations should adopt X")
- Factual assertions ("X is the leading provider of Y")
- Comparisons ("X outpaces Y in market share")
- Causal claims ("the increase in X was driven by Y")"#,
};

static GENERAL: DocTypeConfig = DocTypeConfig {
    entity_categories: &[
        "concept", "entity", "topic", "method", "tool", "person",
        "organization",
    ],
    claim_types: &[
        "assertion", "observation", "conclusion", "recommendation",
    ],
    relation_types: &[
        "discusses", "mentions", "references", "analyzes",
    ],
    extraction_guidance: "Extract the most important concepts, entities, and claims from this document.",
    claim_examples: r#"- Factual assertions ("X is Y", "X was developed by Y")
- Comparisons ("X is better/worse than Y")
- Causal claims ("X leads to Y", "X is caused by Y")
- Definitions ("X means Y", "X refers to Y")
- Recommendations ("one should use X for Y")
- Observations ("X is commonly seen in Y")"#,
};

/// Get the appropriate doc-type configuration based on the document type
/// string from the classifier stage.
pub fn get_doc_type_config(document_type: &str) -> &'static DocTypeConfig {
    match document_type {
        "research_paper" | "journalArticle" | "conferencePaper" | "preprint" => &RESEARCH_PAPER,
        "legal_case" | "case" => &LEGAL_CASE,
        "patent" => &PATENT,
        "thesis" | "dissertation" => &THESIS,
        "book" | "bookSection" => &BOOK,
        "statute" | "bill" | "hearing" => &STATUTE,
        "webpage" | "report" | "blogPost" | "newspaperArticle" | "magazineArticle" => &WEBPAGE_REPORT,
        _ => &GENERAL,
    }
}
