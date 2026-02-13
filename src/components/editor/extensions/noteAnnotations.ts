import { StateField, StateEffect, RangeSetBuilder } from "@codemirror/state";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import type { Annotation } from "@/services/tauri/commands";

// =====================================================
// Types
// =====================================================

export interface NoteComment {
  id: number;
  key: string;
  startOffset: number;
  endOffset: number;
  selectedText: string;
  comment: string;
  color: string;
  dateAdded: string;
  dateModified: string;
}

interface NoteAnnotationsState {
  comments: NoteComment[];
  activeCommentId: number | null;
}

// =====================================================
// State Effects
// =====================================================

/** Load comments from the database */
export const loadComments = StateEffect.define<NoteComment[]>();

/** Set which comment is currently active (clicked) */
export const setActiveComment = StateEffect.define<number | null>();

/** Add a new comment after it's created in the DB */
export const addComment = StateEffect.define<NoteComment>();

/** Remove a comment after it's deleted from the DB */
export const removeComment = StateEffect.define<number>();

/** Update a comment's text after editing */
export const updateCommentText = StateEffect.define<{
  id: number;
  comment: string;
}>();

// =====================================================
// Comment Indicator Widget
// =====================================================

class CommentIndicatorWidget extends WidgetType {
  constructor(
    readonly commentId: number,
    readonly isActive: boolean,
  ) {
    super();
  }

  eq(other: CommentIndicatorWidget) {
    return this.commentId === other.commentId && this.isActive === other.isActive;
  }

  toDOM() {
    const span = document.createElement("span");
    span.className = `cm-md-comment-indicator${this.isActive ? " active" : ""}`;
    span.dataset.commentId = String(this.commentId);
    span.setAttribute("aria-label", "Comment");
    // Small comment icon SVG
    span.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`;
    return span;
  }

  ignoreEvent() {
    return false;
  }
}

// =====================================================
// Decoration builders
// =====================================================

function buildDecorations(state: NoteAnnotationsState) {
  const builder = new RangeSetBuilder<Decoration>();

  // Sort comments by startOffset for proper decoration ordering
  const sorted = [...state.comments].sort(
    (a, b) => a.startOffset - b.startOffset || a.endOffset - b.endOffset,
  );

  for (const c of sorted) {
    if (c.startOffset < 0 || c.endOffset < c.startOffset) continue;
    // Mark decoration for the highlighted range
    builder.add(
      c.startOffset,
      c.endOffset,
      Decoration.mark({
        class: `cm-md-comment-highlight${state.activeCommentId === c.id ? " active" : ""}`,
        attributes: { "data-comment-id": String(c.id) },
      }),
    );
    // Widget at the end of the highlight
    builder.add(
      c.endOffset,
      c.endOffset,
      Decoration.widget({
        widget: new CommentIndicatorWidget(c.id, state.activeCommentId === c.id),
        side: 1,
      }),
    );
  }

  return builder.finish();
}

// =====================================================
// StateField
// =====================================================

export const noteAnnotationsField = StateField.define<NoteAnnotationsState>({
  create() {
    return { comments: [], activeCommentId: null };
  },

  update(state, tr) {
    let newState = state;
    let changed = false;

    // Process effects
    for (const e of tr.effects) {
      if (e.is(loadComments)) {
        newState = { ...newState, comments: e.value, activeCommentId: null };
        changed = true;
      } else if (e.is(setActiveComment)) {
        newState = { ...newState, activeCommentId: e.value };
        changed = true;
      } else if (e.is(addComment)) {
        newState = {
          ...newState,
          comments: [...newState.comments, e.value],
        };
        changed = true;
      } else if (e.is(removeComment)) {
        newState = {
          ...newState,
          comments: newState.comments.filter((c) => c.id !== e.value),
          activeCommentId:
            newState.activeCommentId === e.value ? null : newState.activeCommentId,
        };
        changed = true;
      } else if (e.is(updateCommentText)) {
        newState = {
          ...newState,
          comments: newState.comments.map((c) =>
            c.id === e.value.id ? { ...c, comment: e.value.comment } : c,
          ),
        };
        changed = true;
      }
    }

    // Map positions through document changes
    if (tr.docChanged && newState.comments.length > 0) {
      const mapped = newState.comments.map((c) => {
        const newStart = tr.changes.mapPos(c.startOffset, 1);
        const newEnd = tr.changes.mapPos(c.endOffset, -1);
        if (newStart >= newEnd) {
          // Comment range collapsed — mark for removal
          return null;
        }
        return { ...c, startOffset: newStart, endOffset: newEnd };
      });
      const filtered = mapped.filter((c): c is NoteComment => c !== null);
      if (
        filtered.length !== newState.comments.length ||
        filtered.some(
          (c, i) =>
            c.startOffset !== newState.comments[i]?.startOffset ||
            c.endOffset !== newState.comments[i]?.endOffset,
        )
      ) {
        newState = { ...newState, comments: filtered };
        changed = true;
      }
    }

    if (!changed) return state;
    return newState;
  },

  provide(field) {
    return EditorView.decorations.from(field, (state) => {
      return buildDecorations(state);
    });
  },
});

// =====================================================
// Click handler for comment indicators
// =====================================================

export const commentClickHandler = EditorView.domEventHandlers({
  click(event, view) {
    const target = event.target as HTMLElement;

    // Check if clicked on the indicator widget
    const indicator = target.closest(".cm-md-comment-indicator");
    if (indicator) {
      const commentId = Number((indicator as HTMLElement).dataset.commentId);
      if (!isNaN(commentId)) {
        const state = view.state.field(noteAnnotationsField);
        const isAlreadyActive = state.activeCommentId === commentId;
        // Capture rect BEFORE dispatch — dispatch rebuilds decorations and removes element
        const rect = indicator.getBoundingClientRect();
        view.dispatch({
          effects: setActiveComment.of(isAlreadyActive ? null : commentId),
        });
        window.dispatchEvent(
          new CustomEvent("wren:comment-click", {
            detail: {
              commentId: isAlreadyActive ? null : commentId,
              anchor: { x: rect.left + rect.width / 2, y: rect.bottom },
            },
          }),
        );
        return true;
      }
    }

    // Check if clicked on a comment highlight
    const highlight = target.closest(".cm-md-comment-highlight");
    if (highlight) {
      const commentId = Number((highlight as HTMLElement).dataset.commentId);
      if (!isNaN(commentId)) {
        const state = view.state.field(noteAnnotationsField);
        const isAlreadyActive = state.activeCommentId === commentId;
        // Capture rect BEFORE dispatch — dispatch rebuilds decorations and removes element
        const indicatorEl = view.dom.querySelector(
          `.cm-md-comment-indicator[data-comment-id="${commentId}"]`,
        );
        const rect = indicatorEl
          ? indicatorEl.getBoundingClientRect()
          : highlight.getBoundingClientRect();
        view.dispatch({
          effects: setActiveComment.of(isAlreadyActive ? null : commentId),
        });
        window.dispatchEvent(
          new CustomEvent("wren:comment-click", {
            detail: {
              commentId: isAlreadyActive ? null : commentId,
              anchor: { x: rect.left + rect.width / 2, y: rect.bottom },
            },
          }),
        );
        return true;
      }
    }

    // Click elsewhere — dismiss active comment
    const state = view.state.field(noteAnnotationsField);
    if (state.activeCommentId !== null) {
      view.dispatch({ effects: setActiveComment.of(null) });
      window.dispatchEvent(
        new CustomEvent("wren:comment-click", {
          detail: { commentId: null, anchor: null },
        }),
      );
    }

    return false;
  },
});

// =====================================================
// Helpers for converting DB annotations ↔ NoteComment
// =====================================================

export function annotationToComment(ann: Annotation): NoteComment | null {
  try {
    const pos = JSON.parse(ann.positionJson);
    if (pos.type !== "markdown" || typeof pos.startOffset !== "number") {
      return null;
    }
    return {
      id: ann.id,
      key: ann.key,
      startOffset: pos.startOffset,
      endOffset: pos.endOffset,
      selectedText: ann.selectedText || pos.selectedText || "",
      comment: ann.comment || "",
      color: ann.color,
      dateAdded: ann.dateAdded,
      dateModified: ann.dateModified,
    };
  } catch {
    return null;
  }
}

export function buildPositionJson(
  startOffset: number,
  endOffset: number,
  selectedText: string,
  docText: string,
): string {
  const contextBefore = docText.slice(Math.max(0, startOffset - 30), startOffset);
  const contextAfter = docText.slice(endOffset, endOffset + 30);
  return JSON.stringify({
    type: "markdown",
    startOffset,
    endOffset,
    selectedText,
    contextBefore,
    contextAfter,
  });
}

/**
 * Re-anchor a comment position when offsets don't match the current document.
 * Tries: exact offset → fuzzy match using context → full document search.
 * Returns updated offsets or null if the comment is orphaned.
 */
export function reanchorComment(
  pos: { startOffset: number; endOffset: number; selectedText: string; contextBefore?: string; contextAfter?: string },
  docText: string,
): { startOffset: number; endOffset: number } | null {
  const { selectedText } = pos;
  if (!selectedText) return null;

  // Try 1: exact offset
  const atOffset = docText.slice(pos.startOffset, pos.endOffset);
  if (atOffset === selectedText) {
    return { startOffset: pos.startOffset, endOffset: pos.endOffset };
  }

  // Try 2: fuzzy match using context
  if (pos.contextBefore) {
    const needle = pos.contextBefore + selectedText;
    const idx = docText.indexOf(needle);
    if (idx >= 0) {
      const start = idx + pos.contextBefore.length;
      return { startOffset: start, endOffset: start + selectedText.length };
    }
  }

  // Try 3: search full document
  const idx = docText.indexOf(selectedText);
  if (idx >= 0) {
    return { startOffset: idx, endOffset: idx + selectedText.length };
  }

  return null;
}

/** Get current comment positions for persisting back to DB */
export function getCommentPositions(view: EditorView): NoteComment[] {
  return view.state.field(noteAnnotationsField).comments;
}
