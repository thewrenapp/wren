import type { EntrySummary } from "@/stores/libraryStore";

export type FilterType = "all" | "pdfs" | "notes" | "recent" | "untagged" | "trash";

/**
 * Filter entries based on filter type
 */
export function filterEntriesByType(
  entries: EntrySummary[],
  filterType: FilterType
): EntrySummary[] {
  switch (filterType) {
    case "pdfs":
      return entries.filter((e) => e.hasPdf);
    case "notes":
      return entries.filter((e) => e.hasNote);
    case "recent":
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);
      return entries.filter((e) => new Date(e.dateAdded) > weekAgo);
    case "untagged":
      return entries.filter((e) => e.tags.length === 0);
    case "all":
    case "trash":
    default:
      return entries;
  }
}

/**
 * Filter entries by search query
 */
export function filterEntriesBySearch(
  entries: EntrySummary[],
  searchQuery: string
): EntrySummary[] {
  if (!searchQuery) return entries;

  const query = searchQuery.toLowerCase();
  return entries.filter((entry) =>
    entry.title.toLowerCase().includes(query) ||
    (entry.creatorsDisplay?.toLowerCase().includes(query) ?? false) ||
    entry.tags.some((tag) => tag.name.toLowerCase().includes(query)) ||
    (entry.year?.includes(query) ?? false)
  );
}

/**
 * Combined filter: applies both type filter and search filter
 */
export function filterEntries(
  entries: EntrySummary[],
  filterType: FilterType,
  searchQuery: string
): EntrySummary[] {
  const filteredByType = filterEntriesByType(entries, filterType);
  return filterEntriesBySearch(filteredByType, searchQuery);
}

/**
 * Sort field type
 */
export type SortField = "title" | "creator" | "year" | "dateAdded" | "dateModified" | "itemType";
export type SortDirection = "asc" | "desc";

/**
 * Compare two entries by a specific field
 */
export function compareEntriesByField(
  a: EntrySummary,
  b: EntrySummary,
  field: SortField
): number {
  switch (field) {
    case "title":
      return a.title.localeCompare(b.title);
    case "creator":
      return (a.creatorsDisplay || "").localeCompare(b.creatorsDisplay || "");
    case "year":
      const yearA = a.year ? parseInt(a.year, 10) : 0;
      const yearB = b.year ? parseInt(b.year, 10) : 0;
      return yearA - yearB;
    case "dateAdded":
      return new Date(a.dateAdded).getTime() - new Date(b.dateAdded).getTime();
    case "dateModified":
      const modA = a.dateModified ? new Date(a.dateModified).getTime() : 0;
      const modB = b.dateModified ? new Date(b.dateModified).getTime() : 0;
      return modA - modB;
    case "itemType":
      return a.itemType.localeCompare(b.itemType);
    default:
      return new Date(a.dateAdded).getTime() - new Date(b.dateAdded).getTime();
  }
}

/**
 * Sort entries with optional secondary sort
 */
export function sortEntries(
  entries: EntrySummary[],
  sortField: SortField,
  sortDirection: SortDirection,
  secondarySortField?: SortField | null,
  secondarySortDirection?: SortDirection
): EntrySummary[] {
  return [...entries].sort((a, b) => {
    // Primary sort
    let comparison = compareEntriesByField(a, b, sortField);
    comparison = sortDirection === "asc" ? comparison : -comparison;

    // Secondary sort (if primary values are equal and secondary sort is configured)
    if (comparison === 0 && secondarySortField) {
      let secondaryComparison = compareEntriesByField(a, b, secondarySortField);
      comparison = (secondarySortDirection ?? "asc") === "asc" ? secondaryComparison : -secondaryComparison;
    }

    return comparison;
  });
}
