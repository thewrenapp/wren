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
import { EditorToolbar } from "./EditorToolbar";
import { saveMarkdownContent, reindexAttachment } from "@/services/tauri/commands";
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

    // Keep attachmentId ref in sync
    attachmentIdRef.current = attachmentId;

    // Debounced save function
    const saveFn = useRef(async (aid: number, text: string) => {
      try {
        setSaveStatus("saving");
        await saveMarkdownContent(aid, text);
        needsReindexRef.current = true;
        setSaveStatus("saved");
        onDirtyChange?.(false);
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
      <div className={cn("flex flex-col h-full", className)}>
        {showToolbar && (
          <EditorToolbar
            editorView={editorView}
            saveStatus={saveStatus}
            showReindex={showReindex}
            onReindex={handleReindex}
          />
        )}
        <div ref={containerRef} className="flex-1 overflow-hidden" />
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
