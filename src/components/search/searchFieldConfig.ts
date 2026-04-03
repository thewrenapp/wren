export type AdvancedMatchMode = "all" | "any";

export type AdvancedCriterion = {
  id: string;
  field: string;
  operator: string;
  value: string;
};

export type AdvancedScope = "all" | "collection";

export const advancedFields = [
  { value: "title", label: "Title" },
  { value: "creator", label: "Creator" },
  { value: "year", label: "Year" },
  { value: "publication_title", label: "Publication Title" },
  { value: "abstract", label: "Abstract" },
  { value: "tags", label: "Tags" },
  { value: "collection", label: "Collection" },
  { value: "saved_search", label: "Smart Filter" },
  { value: "item_type", label: "Item Type" },
  { value: "date_added", label: "Date Added" },
];

export const advancedOperators = [
  { value: "contains", label: "contains", requiresValue: true },
  { value: "does_not_contain", label: "does not contain", requiresValue: true },
  { value: "is", label: "is", requiresValue: true },
  { value: "is_not", label: "is not", requiresValue: true },
  { value: "begins_with", label: "begins with", requiresValue: true },
  { value: "ends_with", label: "ends with", requiresValue: true },
  { value: "is_before", label: "is before", requiresValue: true },
  { value: "is_after", label: "is after", requiresValue: true },
  { value: "is_empty", label: "is empty", requiresValue: false },
  { value: "is_not_empty", label: "is not empty", requiresValue: false },
];
