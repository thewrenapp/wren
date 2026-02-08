import { useRef, useEffect, useState } from "react";
import { EditorView, keymap } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import {
  syntaxHighlighting,
  defaultHighlightStyle,
  HighlightStyle,
  bracketMatching,
} from "@codemirror/language";
import { tags } from "@lezer/highlight";

const darkHighlightStyle = HighlightStyle.define([
  { tag: tags.heading1, color: "#e06c75", fontWeight: "bold" },
  { tag: tags.heading2, color: "#e06c75", fontWeight: "bold" },
  { tag: tags.heading3, color: "#e06c75", fontWeight: "bold" },
  { tag: tags.heading, color: "#e06c75", fontWeight: "bold" },
  { tag: tags.emphasis, color: "#c678dd", fontStyle: "italic" },
  { tag: tags.strong, color: "#d19a66", fontWeight: "bold" },
  { tag: tags.keyword, color: "#c678dd" },
  { tag: tags.atom, color: "#d19a66" },
  { tag: tags.bool, color: "#d19a66" },
  { tag: tags.url, color: "#61afef", textDecoration: "underline" },
  { tag: tags.link, color: "#61afef" },
  { tag: tags.labelName, color: "#61afef" },
  { tag: tags.inserted, color: "#98c379" },
  { tag: tags.deleted, color: "#e06c75" },
  { tag: tags.literal, color: "#98c379" },
  { tag: tags.string, color: "#98c379" },
  { tag: tags.number, color: "#d19a66" },
  { tag: [tags.regexp, tags.escape, tags.special(tags.string)], color: "#56b6c2" },
  { tag: tags.definition(tags.variableName), color: "#e06c75" },
  { tag: tags.local(tags.variableName), color: "#e06c75" },
  { tag: tags.typeName, color: "#e5c07b" },
  { tag: tags.namespace, color: "#e5c07b" },
  { tag: tags.className, color: "#e5c07b" },
  { tag: tags.special(tags.variableName), color: "#d19a66" },
  { tag: tags.macroName, color: "#e06c75" },
  { tag: tags.meta, color: "#abb2bf" },
  { tag: tags.comment, color: "#5c6370", fontStyle: "italic" },
  { tag: tags.processingInstruction, color: "#5c6370" },
  { tag: tags.contentSeparator, color: "#5c6370" },
  { tag: tags.monospace, color: "#98c379" },
  { tag: tags.strikethrough, textDecoration: "line-through" },
  { tag: tags.invalid, color: "#ffffff", backgroundColor: "#e06c75" },
]);

function buildTheme(isDark: boolean) {
  return EditorView.theme(
    {
      "&": {
        height: "100%",
        fontSize: "13px",
        backgroundColor: "hsl(var(--background))",
        color: "hsl(var(--foreground))",
      },
      ".cm-content": {
        fontFamily: "var(--font-mono, ui-monospace, monospace)",
        padding: "16px",
        caretColor: "hsl(var(--foreground))",
      },
      ".cm-cursor, .cm-dropCursor": {
        borderLeftColor: "hsl(var(--foreground))",
      },
      "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
        {
          backgroundColor: "hsl(var(--accent))",
        },
      ".cm-activeLine": {
        backgroundColor: "transparent",
      },
      ".cm-gutters": {
        display: "none",
      },
      ".cm-scroller": {
        overflow: "auto",
      },
      "&.cm-focused": {
        outline: "none",
      },
    },
    { dark: isDark }
  );
}

interface MarkdownEditorProps {
  content: string;
  readOnly?: boolean;
  onChange?: (content: string) => void;
  className?: string;
}

export function MarkdownEditor({
  content,
  readOnly = false,
  onChange,
  className = "",
}: MarkdownEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);

  const [isDark, setIsDark] = useState(
    () => document.documentElement.classList.contains("dark")
  );

  // Watch for dark mode changes
  useEffect(() => {
    const observer = new MutationObserver(() => {
      setIsDark(document.documentElement.classList.contains("dark"));
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;

    const extensions = [
      markdown({ base: markdownLanguage, codeLanguages: languages }),
      syntaxHighlighting(
        isDark ? darkHighlightStyle : defaultHighlightStyle,
        { fallback: true }
      ),
      bracketMatching(),
      EditorView.lineWrapping,
      EditorView.editable.of(!readOnly),
      EditorState.readOnly.of(readOnly),
      buildTheme(isDark),
    ];

    if (!readOnly) {
      extensions.push(
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap])
      );

      if (onChange) {
        extensions.push(
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              onChange(update.state.doc.toString());
            }
          })
        );
      }
    }

    const state = EditorState.create({
      doc: content,
      extensions,
    });

    const view = new EditorView({
      state,
      parent: containerRef.current,
    });

    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [readOnly, isDark]); // Recreate on readOnly or theme change

  // Update content when it changes externally
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const currentContent = view.state.doc.toString();
    if (currentContent !== content) {
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
    <div
      ref={containerRef}
      className={`h-full w-full overflow-hidden ${className}`}
    />
  );
}
