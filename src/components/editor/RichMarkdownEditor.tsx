import { useRef, useEffect, useState, useCallback, useImperativeHandle, forwardRef } from "react";
import { EditorView, keymap } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { syntaxHighlighting, defaultHighlightStyle } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import "katex/dist/katex.min.css";
import debounce from "lodash.debounce";
import { markdownRenderPlugin, markdownClickHandler, blockDecorationField, refreshBlockDecorations } from "./extensions/markdownRendering";
import { markdownRenderTheme } from "./extensions/markdownTheme";
import { slashCommandPlugin } from "./extensions/slashCommands";
import {
  noteAnnotationsField,
  commentClickHandler,
  loadComments,
  addComment,
  removeComment,
  updateCommentText,
  setActiveComment,
  annotationToComment,
  buildPositionJson,
  reanchorComment,
  getCommentPositions,
  type NoteComment,
} from "./extensions/noteAnnotations";
import { SlashSearchPanel } from "./SlashSearchPanel";
import { NoteCommentPopover } from "./NoteCommentPopover";
import { EditorToolbar } from "./EditorToolbar";
import { useMarkdownSearch, searchHighlightField } from "./useMarkdownSearch";
import {
  saveMarkdownContent,
  reindexAttachment,
  syncNoteEntryLinks,
  getAnnotations,
  createAnnotation,
  updateAnnotation,
  deleteAnnotation,
} from "@/services/tauri/commands";
import { cn } from "@/lib/utils";
import { initShiki, changeTheme } from "./extensions/shikiHighlighter";
import { useSettingsStore } from "@/stores/settingsStore";

// =====================================================
// Types
// =====================================================

export interface RichMarkdownEditorRef {
  /** Flush any pending saves immediately */
  flush: () => void;
  /** Reindex if content changed since last reindex */
  reindexIfNeeded: () => Promise<void>;
}

interface RichMarkdownEditorProps {
  content: string;
  attachmentId: number;
  showToolbar?: boolean;
  showReindex?: boolean;
  onDirtyChange?: (dirty: boolean) => void;
  className?: string;
  infoPaneOpen?: boolean;
  onToggleInfoPane?: () => void;
}

// =====================================================
// Component
// =====================================================

export const RichMarkdownEditor = forwardRef<RichMarkdownEditorRef, RichMarkdownEditorProps>(
  function RichMarkdownEditor(
    {
      content,
      attachmentId,
      showToolbar = true,
      showReindex = false,
      onDirtyChange,
      className,
      infoPaneOpen,
      onToggleInfoPane,
    },
    ref,
  ) {
    const containerRef = useRef<HTMLDivElement>(null);
    const viewRef = useRef<EditorView | null>(null);
    const [editorView, setEditorView] = useState<EditorView | null>(null);
    const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
    const needsReindexRef = useRef(false);
    const attachmentIdRef = useRef(attachmentId);
    const savedFadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const onDirtyChangeRef = useRef(onDirtyChange);
    onDirtyChangeRef.current = onDirtyChange;
    const loadedCommentIdsRef = useRef<Set<number>>(new Set());

    // Search hook
    const mdSearch = useMarkdownSearch(editorView);

    // Slash search panel state
    const [slashSearch, setSlashSearch] = useState<{
      type: "entry" | "attachment" | "tag" | "collection";
      replaceFrom: number;
      replaceTo: number;
      anchor: { x: number; y: number };
    } | null>(null);

    // Comment popover state
    const [activeComment, setActiveCommentState] = useState<{
      comment: NoteComment;
      anchor: { x: number; y: number };
    } | null>(null);

    // Keep attachmentId ref in sync
    attachmentIdRef.current = attachmentId;

    // Debounced save function
    const saveFn = useRef(async (aid: number, text: string) => {
      try {
        setSaveStatus("saving");
        await saveMarkdownContent(aid, text);
        // Sync backlinks (fire-and-forget, don't block save indicator)
        syncNoteEntryLinks(aid, text).catch(() => {});
        needsReindexRef.current = true;
        setSaveStatus("saved");
        onDirtyChangeRef.current?.(false);
        // Fade "Saved" after 2s
        if (savedFadeTimerRef.current) clearTimeout(savedFadeTimerRef.current);
        savedFadeTimerRef.current = setTimeout(() => setSaveStatus("idle"), 2000);
      } catch (err) {
        console.error("Failed to save markdown:", err);
        setSaveStatus("idle");
      }
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const debouncedSave = useRef(
      debounce(((aid: number, text: string) => {
        saveFn.current(aid, text);
      }) as any, 1500),
    ).current;

    // Flush + reindex on unmount
    useEffect(() => {
      return () => {
        debouncedSave.flush();
        if (needsReindexRef.current) {
          reindexAttachment(attachmentIdRef.current).catch(console.error);
        }
        if (savedFadeTimerRef.current) clearTimeout(savedFadeTimerRef.current);
      };
    }, []);

    // Expose imperative handle
    useImperativeHandle(ref, () => ({
      flush() {
        debouncedSave.flush();
      },
      async reindexIfNeeded() {
        if (needsReindexRef.current) {
          needsReindexRef.current = false;
          await reindexAttachment(attachmentIdRef.current);
        }
      },
    }));

    // Reindex handler for toolbar button
    const handleReindex = useCallback(async () => {
      debouncedSave.flush();
      needsReindexRef.current = false;
      try {
        await reindexAttachment(attachmentIdRef.current);
      } catch (err) {
        console.error("Failed to reindex:", err);
      }
    }, []);

    // Add comment on current selection
    const handleAddComment = useCallback(async (view: EditorView) => {
      const { from, to } = view.state.selection.main;
      if (from === to) return; // Need a selection
      const selectedText = view.state.doc.sliceString(from, to);
      const docText = view.state.doc.toString();
      const posJson = buildPositionJson(from, to, selectedText, docText);
      try {
        const ann = await createAnnotation({
          attachmentId: attachmentIdRef.current,
          annotationType: "comment",
          pageNumber: 0,
          positionJson: posJson,
          selectedText,
          comment: "",
          color: "hsl(var(--primary))",
        });
        const nc: NoteComment = {
          id: ann.id,
          key: ann.key,
          startOffset: from,
          endOffset: to,
          selectedText,
          comment: "",
          color: ann.color,
          dateAdded: ann.dateAdded,
          dateModified: ann.dateModified,
        };
        view.dispatch({ effects: addComment.of(nc) });
        loadedCommentIdsRef.current.add(ann.id);
        // Immediately open the popover for the new comment
        const coords = view.coordsAtPos(to);
        if (coords) {
          // Small delay to let the decoration render first
          setTimeout(() => {
            const indicator = view.dom.querySelector(
              `.cm-md-comment-indicator[data-comment-id="${ann.id}"]`,
            );
            const rect = indicator?.getBoundingClientRect();
            const anchorX = (rect ? rect.left + rect.width / 2 : coords.left);
            const anchorY = (rect ? rect.bottom : coords.bottom);
            view.dispatch({ effects: setActiveComment.of(ann.id) });
            setActiveCommentState({
              comment: nc,
              anchor: { x: anchorX, y: anchorY },
            });
          }, 50);
        }
      } catch (err) {
        console.error("Failed to create comment:", err);
      }
    }, []);

    // Update comment text
    const handleUpdateComment = useCallback(async (id: number, text: string) => {
      try {
        await updateAnnotation(id, { comment: text }, attachmentIdRef.current);
        viewRef.current?.dispatch({ effects: updateCommentText.of({ id, comment: text }) });
        setActiveCommentState((prev) =>
          prev && prev.comment.id === id
            ? { ...prev, comment: { ...prev.comment, comment: text } }
            : prev,
        );
      } catch (err) {
        console.error("Failed to update comment:", err);
      }
    }, []);

    // Delete comment
    const handleDeleteComment = useCallback(async (id: number) => {
      try {
        await deleteAnnotation(id, attachmentIdRef.current);
        viewRef.current?.dispatch({ effects: removeComment.of(id) });
        loadedCommentIdsRef.current.delete(id);
        setActiveCommentState(null);
      } catch (err) {
        console.error("Failed to delete comment:", err);
      }
    }, []);

    // Close comment popover
    const handleCloseComment = useCallback(() => {
      setActiveCommentState(null);
      viewRef.current?.dispatch({ effects: setActiveComment.of(null) });
    }, []);

    // Keyboard shortcuts for formatting
    const formattingKeymap = keymap.of([
      {
        key: "Mod-b",
        run(view) {
          wrapSelection(view, "**", "**");
          return true;
        },
      },
      {
        key: "Mod-i",
        run(view) {
          wrapSelection(view, "*", "*");
          return true;
        },
      },
      {
        key: "Mod-Shift-s",
        run(view) {
          wrapSelection(view, "~~", "~~");
          return true;
        },
      },
      {
        key: "Mod-e",
        run(view) {
          wrapSelection(view, "`", "`");
          return true;
        },
      },
      {
        key: "Mod-k",
        run(view) {
          insertLink(view);
          return true;
        },
      },
      {
        key: "Mod-Shift-h",
        run(view) {
          wrapSelection(view, "==", "==");
          return true;
        },
      },
      {
        key: "Mod-Shift-m",
        run(view) {
          handleAddComment(view);
          return true;
        },
      },
      {
        key: "Mod-Shift-r",
        run() {
          handleReindex();
          return true;
        },
      },
    ]);

    // Create/recreate editor
    useEffect(() => {
      if (!containerRef.current) return;

      const extensions = [
        markdown({ base: markdownLanguage, codeLanguages: languages }),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        markdownRenderPlugin,
        blockDecorationField,
        markdownClickHandler,
        markdownRenderTheme,
        searchHighlightField,
        slashCommandPlugin,
        noteAnnotationsField,
        commentClickHandler,
        EditorView.lineWrapping,
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        formattingKeymap,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            onDirtyChange?.(true);
            const text = update.state.doc.toString();
            debouncedSave(attachmentIdRef.current, text);
          }
        }),
      ];

      const state = EditorState.create({
        doc: content,
        extensions,
      });

      const view = new EditorView({
        state,
        parent: containerRef.current,
      });

      viewRef.current = view;
      setEditorView(view);

      return () => {
        view.destroy();
        viewRef.current = null;
        setEditorView(null);
      };
    }, []); // Only create once

    // Initialize Shiki and subscribe to theme changes
    useEffect(() => {
      const codeTheme = useSettingsStore.getState().codeTheme;
      initShiki(codeTheme.light, codeTheme.dark).then(() => {
        // Signal the StateField to rebuild with Shiki highlighting
        viewRef.current?.dispatch({
          effects: refreshBlockDecorations.of(null),
        });
      });

      // Subscribe to code theme and line number changes in settings
      let prevTheme = codeTheme;
      let prevLineNumbers = useSettingsStore.getState().showCodeLineNumbers;
      const unsub = useSettingsStore.subscribe((state) => {
        const next = state.codeTheme;
        if (next.light !== prevTheme.light || next.dark !== prevTheme.dark) {
          prevTheme = next;
          changeTheme(next.light, next.dark).then(() => {
            viewRef.current?.dispatch({
              effects: refreshBlockDecorations.of(null),
            });
          });
        }
        if (state.showCodeLineNumbers !== prevLineNumbers) {
          prevLineNumbers = state.showCodeLineNumbers;
          viewRef.current?.dispatch({
            effects: refreshBlockDecorations.of(null),
          });
        }
      });

      return unsub;
    }, []);

    // Load comment annotations when attachmentId changes
    useEffect(() => {
      const view = viewRef.current;
      if (!view) return;

      let cancelled = false;
      getAnnotations(attachmentId).then((annotations) => {
        if (cancelled) return;
        const docText = view.state.doc.toString();
        const comments: NoteComment[] = [];
        const orphanedIds: number[] = [];
        for (const ann of annotations) {
          if (ann.annotationType !== "comment") continue;
          const nc = annotationToComment(ann);
          if (!nc) continue;
          // Re-anchor if needed
          const reanchored = reanchorComment(
            { startOffset: nc.startOffset, endOffset: nc.endOffset, selectedText: nc.selectedText },
            docText,
          );
          if (reanchored) {
            comments.push({ ...nc, startOffset: reanchored.startOffset, endOffset: reanchored.endOffset });
          } else {
            // Comment text no longer exists in document — clean up from DB
            orphanedIds.push(ann.id);
          }
        }
        // Track loaded comment IDs for orphan detection on save
        loadedCommentIdsRef.current = new Set(comments.map((c) => c.id));
        view.dispatch({ effects: loadComments.of(comments) });
        // Delete orphaned comments from database
        for (const id of orphanedIds) {
          deleteAnnotation(id, attachmentId).catch((err) =>
            console.error("Failed to delete orphaned comment:", err)
          );
        }
      }).catch(console.error);

      return () => { cancelled = true; };
    }, [attachmentId]);

    // Listen for comment click events (from the CM6 click handler)
    useEffect(() => {
      const handleCommentClick = (e: Event) => {
        const { commentId, anchor } = (e as CustomEvent).detail;
        if (commentId == null) {
          setActiveCommentState(null);
          return;
        }
        const view = viewRef.current;
        if (!view) return;
        const state = view.state.field(noteAnnotationsField);
        const comment = state.comments.find((c) => c.id === commentId);
        if (comment && anchor) {
          setActiveCommentState({ comment, anchor });
        }
      };
      window.addEventListener("wren:comment-click", handleCommentClick);
      return () => window.removeEventListener("wren:comment-click", handleCommentClick);
    }, []);

    // Persist comment positions on save and clean up collapsed comments
    useEffect(() => {
      const view = viewRef.current;
      if (!view) return;
      if (saveStatus !== "saved") return;

      const comments = getCommentPositions(view);
      const currentIds = new Set(comments.map((c) => c.id));
      for (const c of comments) {
        const docText = view.state.doc.toString();
        const posJson = buildPositionJson(c.startOffset, c.endOffset, c.selectedText, docText);
        updateAnnotation(c.id, { positionJson: posJson }).catch(() => {});
      }
      // Delete comments that were in the editor but got collapsed during editing
      for (const id of loadedCommentIdsRef.current) {
        if (!currentIds.has(id)) {
          deleteAnnotation(id, attachmentIdRef.current).catch((err) =>
            console.error("Failed to delete collapsed comment:", err)
          );
        }
      }
      // Update tracked IDs to match current state
      loadedCommentIdsRef.current = currentIds;
    }, [saveStatus]);

    // Listen for toolbar/palette "add comment" events
    useEffect(() => {
      const handler = () => {
        const view = viewRef.current;
        if (view) handleAddComment(view);
      };
      window.addEventListener("wren:editor-add-comment", handler);
      return () => window.removeEventListener("wren:editor-add-comment", handler);
    }, [handleAddComment]);

    // Listen for slash command reference search events
    useEffect(() => {
      const handleSlashSearch = (e: Event) => {
        const { type, replaceFrom, replaceTo } = (e as CustomEvent).detail;
        const view = viewRef.current;
        if (!view) return;
        const coords = view.coordsAtPos(replaceFrom);
        if (!coords) return;
        setSlashSearch({
          type,
          replaceFrom,
          replaceTo,
          anchor: { x: coords.left, y: coords.bottom },
        });
      };
      window.addEventListener("wren:slash-search", handleSlashSearch);
      return () => window.removeEventListener("wren:slash-search", handleSlashSearch);
    }, []);

    // Update content when it changes externally (e.g., switching attachments)
    useEffect(() => {
      const view = viewRef.current;
      if (!view) return;
      const currentContent = view.state.doc.toString();
      if (currentContent !== content) {
        // Flush any pending save for the previous content before replacing
        debouncedSave.flush();
        view.dispatch({
          changes: {
            from: 0,
            to: currentContent.length,
            insert: content,
          },
        });
      }
    }, [content]);

    return (
      <div className={cn("flex flex-col h-full min-w-0", className)}>
        {showToolbar && (
          <EditorToolbar
            editorView={editorView}
            saveStatus={saveStatus}
            showReindex={showReindex}
            onReindex={handleReindex}
            infoPaneOpen={infoPaneOpen}
            onToggleInfoPane={onToggleInfoPane}
            onSearch={mdSearch.search}
            onSearchNext={mdSearch.searchNext}
            onSearchPrev={mdSearch.searchPrev}
            onSearchClear={mdSearch.clearSearch}
            searchMatchCount={mdSearch.matchCount}
            searchCurrentMatch={mdSearch.currentMatch}
          />
        )}
        <div ref={containerRef} className="flex-1 overflow-hidden w-full min-w-0" />
        {activeComment && (
          <NoteCommentPopover
            comment={activeComment.comment}
            anchor={activeComment.anchor}
            onUpdate={handleUpdateComment}
            onDelete={handleDeleteComment}
            onClose={handleCloseComment}
          />
        )}
        {slashSearch && (
          <SlashSearchPanel
            type={slashSearch.type}
            anchorPosition={slashSearch.anchor}
            onSelect={({ label, url }) => {
              const view = viewRef.current;
              if (view) {
                const linkText = `[${label}](${url})`;
                view.dispatch({
                  changes: {
                    from: slashSearch.replaceFrom,
                    to: slashSearch.replaceTo,
                    insert: linkText,
                  },
                });
                view.focus();
              }
              setSlashSearch(null);
            }}
            onClose={() => setSlashSearch(null)}
          />
        )}
      </div>
    );
  },
);

// =====================================================
// Inline formatting helpers (shared with toolbar)
// =====================================================

function wrapSelection(view: EditorView, before: string, after: string) {
  const { from, to } = view.state.selection.main;
  const selected = view.state.doc.sliceString(from, to);

  if (
    selected.startsWith(before) &&
    selected.endsWith(after) &&
    selected.length >= before.length + after.length
  ) {
    view.dispatch({
      changes: {
        from,
        to,
        insert: selected.slice(before.length, selected.length - after.length),
      },
    });
  } else {
    view.dispatch({
      changes: { from, to, insert: `${before}${selected}${after}` },
      selection: {
        anchor: from + before.length,
        head: to + before.length,
      },
    });
  }
  view.focus();
}

function insertLink(view: EditorView) {
  const { from, to } = view.state.selection.main;
  const selected = view.state.doc.sliceString(from, to);

  if (selected) {
    view.dispatch({
      changes: { from, to, insert: `[${selected}](url)` },
      selection: {
        anchor: from + selected.length + 3,
        head: from + selected.length + 6,
      },
    });
  } else {
    view.dispatch({
      changes: { from, to, insert: "[text](url)" },
      selection: { anchor: from + 1, head: from + 5 },
    });
  }
  view.focus();
}
