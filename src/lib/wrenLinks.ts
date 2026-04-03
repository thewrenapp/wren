/**
 * Build a wren:// URL to select/open an entry.
 */
export function buildEntryLink(entryKey: string): string {
  return `wren://select/library/items/${entryKey}`;
}

/**
 * Build a wren:// URL to open a PDF attachment, optionally at a specific page or annotation.
 */
export function buildPdfLink(
  entryKey: string,
  attachmentKey: string,
  options?: { page?: number; annotationKey?: string }
): string {
  let url = `wren://open-pdf/library/items/${entryKey}/${attachmentKey}`;
  const params = new URLSearchParams();
  if (options?.page) params.set("page", String(options.page));
  if (options?.annotationKey) params.set("annotation", options.annotationKey);
  const qs = params.toString();
  return qs ? `${url}?${qs}` : url;
}
