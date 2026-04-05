use anyhow::{Context, Result};
use lopdf::{dictionary, Document, Object, ObjectId};
use std::path::Path;

/// RGB color for highlight annotation
#[derive(Debug, Clone)]
pub struct HighlightColor {
    pub r: f32,
    pub g: f32,
    pub b: f32,
}

impl HighlightColor {
    /// Parse hex color string (e.g., "#FFFF00")
    pub fn from_hex(hex: &str) -> Result<Self> {
        let hex = hex.trim_start_matches('#');
        if hex.len() != 6 {
            anyhow::bail!("Invalid hex color: {}", hex);
        }

        let r = u8::from_str_radix(&hex[0..2], 16)? as f32 / 255.0;
        let g = u8::from_str_radix(&hex[2..4], 16)? as f32 / 255.0;
        let b = u8::from_str_radix(&hex[4..6], 16)? as f32 / 255.0;

        Ok(Self { r, g, b })
    }
}

/// Represents a highlight annotation to be added to a PDF
#[derive(Debug, Clone)]
pub struct HighlightAnnotation {
    /// Page number (1-indexed)
    pub page_number: u32,
    /// Bounding rectangle [x1, y1, x2, y2] in PDF coordinates
    pub rect: [f32; 4],
    /// QuadPoints for the highlight (8 floats per quad: x1,y1, x2,y2, x3,y3, x4,y4)
    pub quad_points: Vec<f32>,
    /// Color of the highlight
    pub color: HighlightColor,
    /// Optional contents/comment
    pub contents: Option<String>,
    /// Unique identifier
    pub id: String,
}

/// Add a highlight annotation to a PDF file
pub fn add_highlight_annotation(path: &Path, annotation: &HighlightAnnotation) -> Result<()> {
    let mut doc = Document::load(path)
        .with_context(|| format!("Failed to load PDF: {}", path.display()))?;

    let page_id = get_page_id(&doc, annotation.page_number)?;

    // Create the annotation dictionary
    let mut annot_dict = dictionary! {
        "Type" => Object::Name(b"Annot".to_vec()),
        "Subtype" => Object::Name(b"Highlight".to_vec()),
        "Rect" => Object::Array(
            annotation.rect.iter().map(|&v| Object::Real(v)).collect()
        ),
        "QuadPoints" => Object::Array(
            annotation.quad_points.iter().map(|&v| Object::Real(v)).collect()
        ),
        "C" => Object::Array(vec![
            Object::Real(annotation.color.r),
            Object::Real(annotation.color.g),
            Object::Real(annotation.color.b),
        ]),
        "CA" => Object::Real(0.5), // 50% opacity
        "F" => Object::Integer(4), // Print flag
        "NM" => Object::String(annotation.id.as_bytes().to_vec(), lopdf::StringFormat::Literal),
    };

    // Add contents if present
    if let Some(ref contents) = annotation.contents {
        annot_dict.set(
            "Contents",
            Object::String(contents.as_bytes().to_vec(), lopdf::StringFormat::Literal),
        );
    }

    // Add modification date
    let now = chrono::Utc::now();
    let date_str = format!("D:{}", now.format("%Y%m%d%H%M%S+00'00'"));
    annot_dict.set(
        "M",
        Object::String(date_str.as_bytes().to_vec(), lopdf::StringFormat::Literal),
    );

    // Add the annotation object to the document
    let annot_id = doc.add_object(Object::Dictionary(annot_dict));

    // Add the annotation reference to the page's Annots array
    add_annotation_to_page(&mut doc, page_id, annot_id)?;

    // Save the document
    doc.save(path)
        .with_context(|| format!("Failed to save PDF: {}", path.display()))?;

    Ok(())
}

/// Add multiple highlight annotations to a PDF file
pub fn add_highlight_annotations(path: &Path, annotations: &[HighlightAnnotation]) -> Result<()> {
    if annotations.is_empty() {
        return Ok(());
    }

    let mut doc = Document::load(path)
        .with_context(|| format!("Failed to load PDF: {}", path.display()))?;

    for annotation in annotations {
        let page_id = get_page_id(&doc, annotation.page_number)?;

        // Create the annotation dictionary
        let mut annot_dict = dictionary! {
            "Type" => Object::Name(b"Annot".to_vec()),
            "Subtype" => Object::Name(b"Highlight".to_vec()),
            "Rect" => Object::Array(
                annotation.rect.iter().map(|&v| Object::Real(v)).collect()
            ),
            "QuadPoints" => Object::Array(
                annotation.quad_points.iter().map(|&v| Object::Real(v)).collect()
            ),
            "C" => Object::Array(vec![
                Object::Real(annotation.color.r),
                Object::Real(annotation.color.g),
                Object::Real(annotation.color.b),
            ]),
            "CA" => Object::Real(0.5),
            "F" => Object::Integer(4),
            "NM" => Object::String(annotation.id.as_bytes().to_vec(), lopdf::StringFormat::Literal),
        };

        if let Some(ref contents) = annotation.contents {
            annot_dict.set(
                "Contents",
                Object::String(contents.as_bytes().to_vec(), lopdf::StringFormat::Literal),
            );
        }

        let now = chrono::Utc::now();
        let date_str = format!("D:{}", now.format("%Y%m%d%H%M%S+00'00'"));
        annot_dict.set(
            "M",
            Object::String(date_str.as_bytes().to_vec(), lopdf::StringFormat::Literal),
        );

        let annot_id = doc.add_object(Object::Dictionary(annot_dict));
        add_annotation_to_page(&mut doc, page_id, annot_id)?;
    }

    doc.save(path)
        .with_context(|| format!("Failed to save PDF: {}", path.display()))?;

    Ok(())
}

/// Remove a highlight annotation by its NM (unique name) field
pub fn remove_highlight_annotation(path: &Path, annotation_id: &str) -> Result<bool> {
    let mut doc = Document::load(path)
        .with_context(|| format!("Failed to load PDF: {}", path.display()))?;

    let mut found = false;

    // Iterate through all pages to find and remove the annotation
    let page_ids: Vec<ObjectId> = doc.page_iter().collect();

    for page_id in page_ids {
        if let Ok(page) = doc.get_dictionary(page_id)
            && let Ok(annots_obj) = page.get(b"Annots") {
                let annot_refs: Vec<ObjectId> = match annots_obj {
                    Object::Array(arr) => arr
                        .iter()
                        .filter_map(|o| o.as_reference().ok())
                        .collect(),
                    Object::Reference(r) => {
                        if let Ok(Object::Array(arr)) = doc.get_object(*r) {
                            arr.iter()
                                .filter_map(|o| o.as_reference().ok())
                                .collect()
                        } else {
                            vec![]
                        }
                    }
                    _ => vec![],
                };

                // Find and remove the annotation
                for annot_ref in &annot_refs {
                    if let Ok(annot) = doc.get_dictionary(*annot_ref)
                        && let Ok(nm) = annot.get(b"NM")
                            && let Object::String(nm_bytes, _) = nm
                                && String::from_utf8_lossy(nm_bytes) == annotation_id {
                                    // Remove from page's Annots array
                                    let page_mut = doc.get_dictionary_mut(page_id)?;
                                    if let Ok(annots_obj) = page_mut.get_mut(b"Annots")
                                        && let Object::Array(arr) = annots_obj {
                                        arr.retain(|o| {
                                            o.as_reference()
                                                .map(|r| r != *annot_ref)
                                                .unwrap_or(true)
                                        });
                                    }
                                    found = true;
                                    break;
                                }
                }

                if found {
                    break;
                }
            }
    }

    if found {
        doc.save(path)
            .with_context(|| format!("Failed to save PDF: {}", path.display()))?;
    }

    Ok(found)
}

/// Read all highlight annotations from a PDF
pub fn read_highlight_annotations(path: &Path) -> Result<Vec<HighlightAnnotation>> {
    let doc = Document::load(path)
        .with_context(|| format!("Failed to load PDF: {}", path.display()))?;

    let mut annotations = Vec::new();
    let page_ids: Vec<(u32, ObjectId)> = doc
        .page_iter()
        .enumerate()
        .map(|(i, id)| ((i + 1) as u32, id))
        .collect();

    for (page_num, page_id) in page_ids {
        if let Ok(page) = doc.get_dictionary(page_id)
            && let Ok(annots_obj) = page.get(b"Annots") {
                let annot_refs: Vec<ObjectId> = match annots_obj {
                    Object::Array(arr) => arr
                        .iter()
                        .filter_map(|o| o.as_reference().ok())
                        .collect(),
                    Object::Reference(r) => {
                        if let Ok(Object::Array(arr)) = doc.get_object(*r) {
                            arr.iter()
                                .filter_map(|o| o.as_reference().ok())
                                .collect()
                        } else {
                            vec![]
                        }
                    }
                    _ => vec![],
                };

                for annot_ref in annot_refs {
                    if let Ok(annot) = doc.get_dictionary(annot_ref) {
                        // Check if it's a highlight annotation
                        if let Ok(subtype) = annot.get(b"Subtype")
                            && let Object::Name(name) = subtype
                            && name != b"Highlight" {
                            continue;
                        }

                        // Extract annotation data
                        if let Some(highlight) = parse_highlight_annotation(annot, page_num) {
                            annotations.push(highlight);
                        }
                    }
                }
            }
    }

    Ok(annotations)
}

// Helper functions

fn get_page_id(doc: &Document, page_number: u32) -> Result<ObjectId> {
    doc.page_iter()
        .nth((page_number - 1) as usize)
        .with_context(|| format!("Page {} not found", page_number))
}

fn add_annotation_to_page(doc: &mut Document, page_id: ObjectId, annot_id: ObjectId) -> Result<()> {
    let page = doc.get_dictionary_mut(page_id)?;

    let annots = page.get_mut(b"Annots");

    match annots {
        Ok(Object::Array(arr)) => {
            arr.push(Object::Reference(annot_id));
        }
        Ok(Object::Reference(r)) => {
            let r = *r;
            if let Ok(Object::Array(arr)) = doc.get_object_mut(r) {
                arr.push(Object::Reference(annot_id));
            }
        }
        _ => {
            // Create new Annots array
            page.set("Annots", Object::Array(vec![Object::Reference(annot_id)]));
        }
    }

    Ok(())
}

fn parse_highlight_annotation(
    annot: &lopdf::Dictionary,
    page_number: u32,
) -> Option<HighlightAnnotation> {
    // Get rect
    let rect = annot.get(b"Rect").ok()?;
    let rect = if let Object::Array(arr) = rect {
        if arr.len() != 4 {
            return None;
        }
        [
            get_float(&arr[0])?,
            get_float(&arr[1])?,
            get_float(&arr[2])?,
            get_float(&arr[3])?,
        ]
    } else {
        return None;
    };

    // Get quad points
    let quad_points = if let Ok(qp) = annot.get(b"QuadPoints")
        && let Object::Array(arr) = qp {
        arr.iter().filter_map(get_float).collect()
    } else {
        vec![]
    };

    // Get color
    let color = if let Ok(c) = annot.get(b"C")
        && let Object::Array(arr) = c
        && arr.len() >= 3 {
        HighlightColor {
            r: get_float(&arr[0]).unwrap_or(1.0),
            g: get_float(&arr[1]).unwrap_or(1.0),
            b: get_float(&arr[2]).unwrap_or(0.0),
        }
    } else {
        HighlightColor {
            r: 1.0,
            g: 1.0,
            b: 0.0,
        }
    };

    // Get contents
    let contents = annot
        .get(b"Contents")
        .ok()
        .and_then(|c| {
            if let Object::String(bytes, _) = c {
                String::from_utf8(bytes.clone()).ok()
            } else {
                None
            }
        });

    // Get NM (unique name)
    let id = annot
        .get(b"NM")
        .ok()
        .and_then(|nm| {
            if let Object::String(bytes, _) = nm {
                String::from_utf8(bytes.clone()).ok()
            } else {
                None
            }
        })
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());

    Some(HighlightAnnotation {
        page_number,
        rect,
        quad_points,
        color,
        contents,
        id,
    })
}

fn get_float(obj: &Object) -> Option<f32> {
    match obj {
        Object::Real(f) => Some(*f),
        Object::Integer(i) => Some(*i as f32),
        _ => None,
    }
}
