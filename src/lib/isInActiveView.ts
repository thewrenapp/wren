import { useTabStore } from "@/stores/tabStore";

/**
 * Check if a DOM element is in the currently active and focused view.
 * Returns false if the element is in a hidden (inactive) tab or in an
 * unfocused pane during split-pane mode.
 *
 * Use inside keydown event handlers to prevent cross-tab interference
 * (e.g. Ctrl+F opening search bars in hidden tabs).
 */
export function isInActiveView(element: HTMLElement | null): boolean {
  if (!element || element.offsetParent === null) return false;
  const paneEl = element.closest("[data-pane]");
  if (paneEl) {
    const { focusedPane } = useTabStore.getState();
    if (paneEl.getAttribute("data-pane") !== focusedPane) return false;
  }
  return true;
}
