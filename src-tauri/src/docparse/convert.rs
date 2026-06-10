//! Convert oar-ocr [`StructureResult`]s into the parser's [`Block`] model.

use oar_ocr::domain::structure::{
    LayoutElement, LayoutElementType, StructureResult, TableResult,
};
use oar_ocr::processors::BoundingBox;

use super::blocks::{
    Block, BlockType, HeaderFooterBlock, ImageBlock, ListBlock, TableBlock, TableCell, TableRow,
    TextBlock, TitleBlock,
};
use super::entities::Page;

/// Convert per-page structure results (0-indexed) into blocks and pages.
pub fn results_to_document(results: &[StructureResult]) -> (Vec<Block>, Vec<Page>) {
    let mut blocks = Vec::new();
    let mut pages = Vec::with_capacity(results.len());

    for (page_idx, result) in results.iter().enumerate() {
        pages.push(Page { need_ocr: true });

        for elem in ordered_elements(result) {
            if let Some(kind) = element_to_block(elem, result) {
                blocks.push(Block {
                    pages_id: vec![page_idx],
                    kind,
                });
            }
        }
    }

    (blocks, pages)
}

/// Return references to layout elements in reading order: by `region_blocks`
/// `order_index` when available, otherwise top-to-bottom by `y_min`.
fn ordered_elements(result: &StructureResult) -> Vec<&LayoutElement> {
    let elements = &result.layout_elements;

    if let Some(regions) = &result.region_blocks {
        let mut ordered_regions: Vec<_> = regions.iter().collect();
        ordered_regions.sort_by_key(|r| r.order_index.unwrap_or(u32::MAX));

        let mut out: Vec<&LayoutElement> = Vec::with_capacity(elements.len());
        let mut seen = vec![false; elements.len()];

        for region in ordered_regions {
            for &i in &region.element_indices {
                if let Some(elem) = elements.get(i)
                    && !seen[i]
                {
                    seen[i] = true;
                    out.push(elem);
                }
            }
        }
        // Append any elements not referenced by a region, ordered by y.
        let mut leftover: Vec<(usize, &LayoutElement)> = elements
            .iter()
            .enumerate()
            .filter(|(i, _)| !seen[*i])
            .collect();
        leftover.sort_by(|a, b| order_by_y(a.1, b.1));
        out.extend(leftover.into_iter().map(|(_, e)| e));
        return out;
    }

    let mut out: Vec<&LayoutElement> = elements.iter().collect();
    out.sort_by(|a, b| order_by_y(a, b));
    out
}

fn order_by_y(a: &LayoutElement, b: &LayoutElement) -> std::cmp::Ordering {
    a.bbox
        .y_min()
        .partial_cmp(&b.bbox.y_min())
        .unwrap_or(std::cmp::Ordering::Equal)
}

/// Map a single layout element to a block, using the OCR'd `element.text`.
fn element_to_block(elem: &LayoutElement, result: &StructureResult) -> Option<BlockType> {
    let category = elem.element_type.semantic_category();
    let text = elem.text.as_deref().map(str::trim).unwrap_or("");

    match category {
        "title" => {
            if text.is_empty() {
                return None;
            }
            let level = if elem.element_type == LayoutElementType::DocTitle {
                1
            } else {
                2
            };
            Some(BlockType::Title(TitleBlock {
                text: text.to_string(),
                level,
            }))
        }
        "header" => {
            if text.is_empty() {
                return None;
            }
            Some(BlockType::Header(HeaderFooterBlock {
                text: text.to_string(),
            }))
        }
        "footer" => {
            if text.is_empty() {
                return None;
            }
            Some(BlockType::Footer(HeaderFooterBlock {
                text: text.to_string(),
            }))
        }
        "list" => {
            if text.is_empty() {
                return None;
            }
            let items: Vec<String> = text
                .lines()
                .map(str::trim)
                .filter(|l| !l.is_empty())
                .map(str::to_string)
                .collect();
            if items.is_empty() {
                return None;
            }
            Some(BlockType::ListBlock(ListBlock { items }))
        }
        "table" => Some(BlockType::Table(table_for_element(elem, result))),
        "visual" => Some(BlockType::Image(ImageBlock)),
        // Drop captions, formulas, special (page numbers/seals/references), other.
        _ if category == "text" => {
            if text.is_empty() {
                return None;
            }
            Some(BlockType::TextBlock(TextBlock {
                text: text.to_string(),
            }))
        }
        _ => None,
    }
}

/// Build a [`TableBlock`] for a table layout element by matching the best
/// overlapping recognized table, falling back to an empty table.
fn table_for_element(elem: &LayoutElement, result: &StructureResult) -> TableBlock {
    if let Some(table) = best_overlapping_table(&elem.bbox, &result.tables) {
        let rows = rows_from_cells(table);
        if !rows.is_empty() {
            return TableBlock { rows };
        }
    }
    TableBlock { rows: Vec::new() }
}

/// Pick the table whose bbox overlaps the element bbox most.
fn best_overlapping_table<'a>(
    elem_bbox: &BoundingBox,
    tables: &'a [TableResult],
) -> Option<&'a TableResult> {
    tables
        .iter()
        .map(|t| (t, overlap_area(elem_bbox, &t.bbox)))
        .filter(|(_, area)| *area > 0.0)
        .max_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal))
        .map(|(t, _)| t)
}

/// Axis-aligned overlap area between two bounding boxes.
fn overlap_area(a: &BoundingBox, b: &BoundingBox) -> f32 {
    let x = (a.x_max().min(b.x_max()) - a.x_min().max(b.x_min())).max(0.0);
    let y = (a.y_max().min(b.y_max()) - a.y_min().max(b.y_min())).max(0.0);
    x * y
}

/// Build table rows from recognized cells, grouped by row index and ordered by
/// column. Row 0 is treated as the header row.
fn rows_from_cells(table: &TableResult) -> Vec<TableRow> {
    if table.cells.is_empty() {
        return Vec::new();
    }

    let max_row = table.cells.iter().filter_map(|c| c.row).max();
    let Some(max_row) = max_row else {
        return Vec::new();
    };

    let mut rows: Vec<Vec<(usize, String)>> = vec![Vec::new(); max_row + 1];
    for cell in &table.cells {
        let (Some(row), Some(col)) = (cell.row, cell.col) else {
            continue;
        };
        if row < rows.len() {
            let text = cell.text.as_deref().unwrap_or("").trim().to_string();
            rows[row].push((col, text));
        }
    }

    rows.into_iter()
        .enumerate()
        .map(|(row_idx, mut cells)| {
            cells.sort_by_key(|(col, _)| *col);
            TableRow {
                cells: cells
                    .into_iter()
                    .map(|(_, text)| TableCell { text })
                    .collect(),
                is_header: row_idx == 0,
            }
        })
        .filter(|r| !r.cells.is_empty())
        .collect()
}
