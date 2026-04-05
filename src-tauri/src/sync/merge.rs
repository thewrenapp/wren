use std::collections::HashMap;

use super::entry_json::*;

/// Result of merging two EntryJson instances.
pub struct MergeResult {
    pub merged: EntryJson,
    pub conflicts: Vec<ConflictRecord>,
    pub changed: bool,
}

/// A detected conflict where both sides edited the same field.
#[derive(Debug, Clone)]
pub struct ConflictRecord {
    pub field_name: String,
    pub local_value: String,
    pub remote_value: String,
    pub local_timestamp: String,
    pub remote_timestamp: String,
    pub winner: ConflictWinner,
}

#[derive(Debug, Clone, PartialEq)]
pub enum ConflictWinner {
    Local,
    Remote,
}

/// Merge two EntryJson instances (local and remote) using field-level LWW.
/// Returns the merged result plus any conflicts detected.
pub fn merge_entries(local: &EntryJson, remote: &EntryJson) -> MergeResult {
    let mut conflicts = Vec::new();
    let mut changed = false;

    // Start with a clone of local as the base
    let mut merged = local.clone();

    // Merge scalar fields with LWW
    merge_scalar(&mut merged.item_type, &remote.item_type, "item_type", &mut conflicts, &mut changed);
    merge_scalar(&mut merged.title, &remote.title, "title", &mut conflicts, &mut changed);
    merge_scalar_opt(&mut merged.date, &remote.date, "date", &mut conflicts, &mut changed);
    merge_scalar_opt(&mut merged.url, &remote.url, "url", &mut conflicts, &mut changed);
    merge_scalar_opt(&mut merged.access_date, &remote.access_date, "access_date", &mut conflicts, &mut changed);

    // Merge EAV fields
    for (key, remote_field) in &remote.fields {
        match merged.fields.get(key) {
            Some(local_field) => {
                let mut local_clone = local_field.clone();
                merge_scalar(&mut local_clone, remote_field, key, &mut conflicts, &mut changed);
                merged.fields.insert(key.clone(), local_clone);
            }
            None => {
                merged.fields.insert(key.clone(), remote_field.clone());
                changed = true;
            }
        }
    }

    // Merge creators (whole-list LWW)
    if remote.creators.t > merged.creators.t {
        merged.creators = remote.creators.clone();
        changed = true;
    }

    // Merge tags (add-wins set)
    changed |= merge_tags(&mut merged.tags, &remote.tags);

    // Merge collections (add-wins set)
    changed |= merge_collections(&mut merged.collections, &remote.collections);

    // Merge annotations (by key)
    changed |= merge_annotations(&mut merged.annotations, &remote.annotations, &mut conflicts);

    // Merge links (by target_key + link_type)
    changed |= merge_links(&mut merged.links, &remote.links);

    // Merge inline tables (by key, LWW on whole table by modified_at)
    changed |= merge_inline_tables(&mut merged.inline_tables, &remote.inline_tables);

    // Merge parsed_content (whole-block LWW)
    match (&merged.parsed_content, &remote.parsed_content) {
        (Some(local_pc), Some(remote_pc)) => {
            if remote_pc.t > local_pc.t {
                merged.parsed_content = remote.parsed_content.clone();
                changed = true;
            }
        }
        (None, Some(_)) => {
            merged.parsed_content = remote.parsed_content.clone();
            changed = true;
        }
        _ => {}
    }

    // Merge tombstones (union)
    for remote_ts in &remote.tombstones {
        let exists = merged.tombstones.iter().any(|t| {
            t.tombstone_type == remote_ts.tombstone_type
                && t.key == remote_ts.key
                && t.name == remote_ts.name
        });
        if !exists {
            merged.tombstones.push(remote_ts.clone());
            changed = true;
        }
    }

    // Update _meta: keep earliest created_at, merge deleted_at with LWW
    if remote._meta.created_at < merged._meta.created_at {
        merged._meta.created_at = remote._meta.created_at.clone();
    }
    match (&merged._meta.deleted_at, &remote._meta.deleted_at) {
        (None, Some(_)) => {
            merged._meta.deleted_at = remote._meta.deleted_at.clone();
            merged._meta.deleted_by_device = remote._meta.deleted_by_device.clone();
            changed = true;
        }
        (Some(local_del), Some(remote_del)) if remote_del > local_del => {
            merged._meta.deleted_at = remote._meta.deleted_at.clone();
            merged._meta.deleted_by_device = remote._meta.deleted_by_device.clone();
            changed = true;
        }
        _ => {}
    }

    MergeResult { merged, conflicts, changed }
}

// ── Helpers ─────────────────────────────────────────────────────────

fn merge_scalar<T: Clone + PartialEq + ToString>(
    local: &mut Timestamped<T>,
    remote: &Timestamped<T>,
    field_name: &str,
    conflicts: &mut Vec<ConflictRecord>,
    changed: &mut bool,
) {
    if remote.t > local.t {
        *local = remote.clone();
        *changed = true;
    } else if remote.t == local.t && remote.v != local.v {
        // Same timestamp, different values — true conflict. Remote wins by convention.
        conflicts.push(ConflictRecord {
            field_name: field_name.to_string(),
            local_value: local.v.to_string(),
            remote_value: remote.v.to_string(),
            local_timestamp: local.t.clone(),
            remote_timestamp: remote.t.clone(),
            winner: ConflictWinner::Remote,
        });
        *local = remote.clone();
        *changed = true;
    }
}

fn merge_scalar_opt<T: Clone + PartialEq + std::fmt::Debug>(
    local: &mut Timestamped<Option<T>>,
    remote: &Timestamped<Option<T>>,
    field_name: &str,
    conflicts: &mut Vec<ConflictRecord>,
    changed: &mut bool,
) {
    if remote.t > local.t {
        *local = remote.clone();
        *changed = true;
    } else if remote.t == local.t && remote.v != local.v {
        conflicts.push(ConflictRecord {
            field_name: field_name.to_string(),
            local_value: format!("{:?}", local.v),
            remote_value: format!("{:?}", remote.v),
            local_timestamp: local.t.clone(),
            remote_timestamp: remote.t.clone(),
            winner: ConflictWinner::Remote,
        });
        *local = remote.clone();
        *changed = true;
    }
}

/// Add-wins set merge for tags. Returns true if anything changed.
fn merge_tags(local: &mut HashMap<String, TagEntry>, remote: &HashMap<String, TagEntry>) -> bool {
    let mut changed = false;
    for (name, remote_entry) in remote {
        match local.get(name) {
            Some(local_entry) => {
                // Both have this tag. Merge: latest add or remove wins.
                let local_latest = local_entry.removed.as_deref().unwrap_or(&local_entry.added);
                let remote_latest = remote_entry.removed.as_deref().unwrap_or(&remote_entry.added);

                if remote_latest > local_latest {
                    local.insert(name.clone(), remote_entry.clone());
                    changed = true;
                } else if remote_latest == local_latest {
                    // Tie: add wins over remove
                    let local_is_added = local_entry.removed.is_none()
                        || local_entry.added >= *local_entry.removed.as_ref().unwrap();
                    let remote_is_added = remote_entry.removed.is_none()
                        || remote_entry.added >= *remote_entry.removed.as_ref().unwrap();
                    if remote_is_added && !local_is_added {
                        local.insert(name.clone(), remote_entry.clone());
                        changed = true;
                    }
                }
                // Also merge color if remote has one and local doesn't
                if let Some(local_mut) = local.get_mut(name)
                    && local_mut.color.is_none() && remote_entry.color.is_some() {
                        local_mut.color = remote_entry.color.clone();
                        changed = true;
                    }
            }
            None => {
                local.insert(name.clone(), remote_entry.clone());
                changed = true;
            }
        }
    }
    changed
}

/// Add-wins set merge for collections. Returns true if anything changed.
fn merge_collections(
    local: &mut HashMap<String, CollectionEntry>,
    remote: &HashMap<String, CollectionEntry>,
) -> bool {
    let mut changed = false;
    for (key, remote_entry) in remote {
        match local.get(key) {
            Some(local_entry) => {
                let local_latest = local_entry.removed.as_deref().unwrap_or(&local_entry.added);
                let remote_latest = remote_entry.removed.as_deref().unwrap_or(&remote_entry.added);
                if remote_latest > local_latest {
                    local.insert(key.clone(), remote_entry.clone());
                    changed = true;
                }
            }
            None => {
                local.insert(key.clone(), remote_entry.clone());
                changed = true;
            }
        }
    }
    changed
}

/// Merge annotations by key. Returns true if anything changed.
fn merge_annotations(
    local: &mut Vec<AnnotationJson>,
    remote: &[AnnotationJson],
    conflicts: &mut Vec<ConflictRecord>,
) -> bool {
    let mut changed = false;
    let local_keys: HashMap<String, usize> = local.iter().enumerate()
        .map(|(i, a)| (a.key.clone(), i))
        .collect();

    for remote_ann in remote {
        match local_keys.get(&remote_ann.key) {
            Some(&idx) => {
                // Both have this annotation — LWW on comment and color
                let local_ann = &mut local[idx];
                let mut field_changed = false;

                if remote_ann.comment.t > local_ann.comment.t {
                    local_ann.comment = remote_ann.comment.clone();
                    field_changed = true;
                } else if remote_ann.comment.t == local_ann.comment.t
                    && remote_ann.comment.v != local_ann.comment.v
                {
                    conflicts.push(ConflictRecord {
                        field_name: format!("annotation:{}.comment", remote_ann.key),
                        local_value: format!("{:?}", local_ann.comment.v),
                        remote_value: format!("{:?}", remote_ann.comment.v),
                        local_timestamp: local_ann.comment.t.clone(),
                        remote_timestamp: remote_ann.comment.t.clone(),
                        winner: ConflictWinner::Remote,
                    });
                    local_ann.comment = remote_ann.comment.clone();
                    field_changed = true;
                }

                if remote_ann.color.t > local_ann.color.t {
                    local_ann.color = remote_ann.color.clone();
                    field_changed = true;
                }

                changed |= field_changed;
            }
            None => {
                // New annotation from remote
                local.push(remote_ann.clone());
                changed = true;
            }
        }
    }
    changed
}

/// Merge inline tables by key. LWW on whole table by modified_at. Returns true if changed.
fn merge_inline_tables(
    local: &mut Vec<InlineTableJson>,
    remote: &[InlineTableJson],
) -> bool {
    let mut changed = false;
    let local_keys: HashMap<String, usize> = local.iter().enumerate()
        .map(|(i, t)| (t.key.clone(), i))
        .collect();

    for remote_table in remote {
        match local_keys.get(&remote_table.key) {
            Some(&idx) => {
                if remote_table.modified_at > local[idx].modified_at {
                    local[idx] = remote_table.clone();
                    changed = true;
                }
            }
            None => {
                local.push(remote_table.clone());
                changed = true;
            }
        }
    }
    changed
}

/// Merge links by (target_entry_key, link_type) pair. Returns true if changed.
fn merge_links(local: &mut Vec<EntryLinkJson>, remote: &[EntryLinkJson]) -> bool {
    let mut changed = false;
    let local_set: std::collections::HashSet<(String, String)> = local
        .iter()
        .map(|l| (l.target_entry_key.clone(), l.link_type.clone()))
        .collect();

    for remote_link in remote {
        let key = (remote_link.target_entry_key.clone(), remote_link.link_type.clone());
        if !local_set.contains(&key) {
            local.push(remote_link.clone());
            changed = true;
        }
    }
    changed
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ts<T>(v: T, time: &str) -> Timestamped<T> {
        Timestamped::new(v, time.to_string())
    }

    fn make_entry(title: &str, t: &str) -> EntryJson {
        EntryJson {
            schema_version: SCHEMA_VERSION,
            key: "test-key".to_string(),
            _meta: EntryMeta {
                created_at: "2024-01-01T00:00:00Z".to_string(),
                created_by_device: None,
                deleted_at: None,
                deleted_by_device: None,
            },
            item_type: ts("journalArticle".to_string(), "2024-01-01T00:00:00Z"),
            title: ts(title.to_string(), t),
            date: ts(None, "2024-01-01T00:00:00Z"),
            url: ts(None, "2024-01-01T00:00:00Z"),
            access_date: ts(None, "2024-01-01T00:00:00Z"),
            fields: HashMap::new(),
            creators: ts(vec![], "2024-01-01T00:00:00Z"),
            tags: HashMap::new(),
            collections: HashMap::new(),
            attachments: vec![],
            annotations: vec![],
            links: vec![],
            inline_tables: vec![],
            parsed_content: None,
            sharing: None,
            private: PrivateData::default(),
            tombstones: vec![],
        }
    }

    #[test]
    fn test_lww_remote_wins() {
        let local = make_entry("Old Title", "2024-01-01T10:00:00Z");
        let remote = make_entry("New Title", "2024-01-01T12:00:00Z");

        let result = merge_entries(&local, &remote);
        assert_eq!(result.merged.title.v, "New Title");
        assert!(result.changed);
        assert!(result.conflicts.is_empty());
    }

    #[test]
    fn test_lww_local_wins() {
        let local = make_entry("Latest Title", "2024-01-01T14:00:00Z");
        let remote = make_entry("Older Title", "2024-01-01T12:00:00Z");

        let result = merge_entries(&local, &remote);
        assert_eq!(result.merged.title.v, "Latest Title");
        assert!(!result.changed);
    }

    #[test]
    fn test_different_fields_both_preserved() {
        let mut local = make_entry("Title A", "2024-01-01T10:00:00Z");
        local.fields.insert("DOI".to_string(), ts("10.1234".to_string(), "2024-01-01T10:00:00Z"));

        let mut remote = make_entry("Title A", "2024-01-01T10:00:00Z");
        remote.fields.insert("volume".to_string(), ts("42".to_string(), "2024-01-01T12:00:00Z"));

        let result = merge_entries(&local, &remote);
        assert!(result.merged.fields.contains_key("DOI"));
        assert!(result.merged.fields.contains_key("volume"));
    }

    #[test]
    fn test_tag_add_wins() {
        let mut local = make_entry("Title", "2024-01-01T10:00:00Z");
        local.tags.insert("ml".to_string(), TagEntry {
            added: "2024-01-01T10:00:00Z".to_string(),
            color: None,
            removed: Some("2024-01-01T12:00:00Z".to_string()),
        });

        let mut remote = make_entry("Title", "2024-01-01T10:00:00Z");
        remote.tags.insert("ml".to_string(), TagEntry {
            added: "2024-01-01T12:00:00Z".to_string(),
            color: None,
            removed: None,
        });

        let result = merge_entries(&local, &remote);
        let tag = result.merged.tags.get("ml").unwrap();
        assert!(tag.removed.is_none()); // add wins
    }

    #[test]
    fn test_annotation_merge_independent() {
        let mut local = make_entry("Title", "2024-01-01T10:00:00Z");
        local.annotations.push(AnnotationJson {
            key: "ann-1".to_string(),
            attachment_key: "att-1".to_string(),
            annotation_type: "highlight".to_string(),
            page_number: 1,
            position_json: "{}".to_string(),
            selected_text: Some("text 1".to_string()),
            comment: ts(None, "2024-01-01T10:00:00Z"),
            color: ts("#FF0".to_string(), "2024-01-01T10:00:00Z"),
            sort_index: None,
            created_at: "2024-01-01T10:00:00Z".to_string(),
        });

        let mut remote = make_entry("Title", "2024-01-01T10:00:00Z");
        remote.annotations.push(AnnotationJson {
            key: "ann-2".to_string(),
            attachment_key: "att-1".to_string(),
            annotation_type: "highlight".to_string(),
            page_number: 5,
            position_json: "{}".to_string(),
            selected_text: Some("text 2".to_string()),
            comment: ts(None, "2024-01-01T11:00:00Z"),
            color: ts("#0FF".to_string(), "2024-01-01T11:00:00Z"),
            sort_index: None,
            created_at: "2024-01-01T11:00:00Z".to_string(),
        });

        let result = merge_entries(&local, &remote);
        assert_eq!(result.merged.annotations.len(), 2);
    }
}
