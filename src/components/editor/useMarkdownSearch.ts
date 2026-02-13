import { useState, useCallback, useRef } from "react";
import { EditorView, Decoration, type DecorationSet } from "@codemirror/view";
import { StateField, StateEffect, RangeSetBuilder } from "@codemirror/state";
import { getInlineTableAsMarkdown } from "@/services/tauri/commands";

// =====================================================
// Types
// =====================================================

export interface SearchOptions {
  highlightAll: boolean;
  matchCase: boolean;
  wholeWords: boolean;
}

/** A match in the CM6 document text */
interface DocMatch {
  type: "doc";
  from: number;
  to: number;
}

/** A match inside a table widget's DOM */
interface TableMatch {
  type: "table";
  /** Document position of the table marker line (for ordering) */
  docPos: number;
  /** Offset within the table's expanded text (for sub-ordering) */
  offset: number;
  markElements: HTMLElement[];
}

type SearchMatch = DocMatch | TableMatch;

// =====================================================
// CM6 StateEffect + StateField for search decorations
// =====================================================

const setSearchDecos = StateEffect.define<DecorationSet>();

export const searchHighlightField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(decos, tr) {
    decos = decos.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(setSearchDecos)) {
        decos = e.value;
      }
    }
    return decos;
  },
  provide: (f) => EditorView.decorations.from(f),
});

const matchDeco = Decoration.mark({ class: "cm-search-match" });
const matchCurrentDeco = Decoration.mark({ class: "cm-search-match current" });

// =====================================================
// Table marker regex
// =====================================================

const tableMarkerRegex = /^<!--\s*wren-table:([a-f0-9-]+)\s*-->$/;

// =====================================================
// Helper: find text matches
// =====================================================

function findTextMatches(
  text: string,
  query: string,
  options: SearchOptions,
): number[] {
  const searchText = options.matchCase ? query : query.toLowerCase();
  const searchIn = options.matchCase ? text : text.toLowerCase();
  const offsets: number[] = [];

  let start = 0;
  while (start < searchIn.length) {
    const idx = searchIn.indexOf(searchText, start);
    if (idx === -1) break;

    if (options.wholeWords) {
      const before = idx > 0 ? searchIn[idx - 1] : " ";
      const after =
        idx + searchText.length < searchIn.length
          ? searchIn[idx + searchText.length]
          : " ";
      if (/\w/.test(before) || /\w/.test(after)) {
        start = idx + 1;
        continue;
      }
    }

    offsets.push(idx);
    start = idx + 1;
    if (offsets.length >= 1000) break;
  }

  return offsets;
}

// =====================================================
// Helper: build CM6 decoration set from doc matches
// =====================================================

function buildDecoSet(
  docMatches: DocMatch[],
  currentIndex: number,
): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (let i = 0; i < docMatches.length; i++) {
    const m = docMatches[i];
    builder.add(m.from, m.to, i === currentIndex ? matchCurrentDeco : matchDeco);
  }
  return builder.finish();
}

// =====================================================
// Helper: search table widget DOM and inject marks
// =====================================================

function searchTableWidgetDOM(
  wrapper: HTMLElement,
  query: string,
  options: SearchOptions,
): HTMLElement[][] {
  const walker = document.createTreeWalker(
    wrapper,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode: (node) => {
        const parent = node.parentElement;
        if (parent?.closest("mark.cm-search-match, input, button, .cm-md-codeblock-lang, .cm-md-codeblock-gutter")) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    },
  );

  const textNodes: { node: Text; start: number }[] = [];
  let totalText = "";
  let textNode: Text | null;
  while ((textNode = walker.nextNode() as Text | null)) {
    textNodes.push({ node: textNode, start: totalText.length });
    totalText += textNode.textContent || "";
  }

  const offsets = findTextMatches(totalText, query, options);
  const allMarkElements: HTMLElement[][] = [];
  const searchText = options.matchCase ? query : query.toLowerCase();

  // Process in reverse to avoid offset shifting
  for (let i = offsets.length - 1; i >= 0; i--) {
    const matchStart = offsets[i];
    const matchEnd = matchStart + searchText.length;

    let startNodeIdx = -1;
    let endNodeIdx = -1;

    for (let j = 0; j < textNodes.length; j++) {
      const nodeStart = textNodes[j].start;
      const nodeEnd = nodeStart + (textNodes[j].node.textContent?.length || 0);

      if (startNodeIdx === -1 && nodeEnd > matchStart) {
        startNodeIdx = j;
      }
      if (nodeEnd >= matchEnd) {
        endNodeIdx = j;
        break;
      }
    }

    if (startNodeIdx === -1 || endNodeIdx === -1) continue;

    try {
      const markElements: HTMLElement[] = [];

      if (startNodeIdx === endNodeIdx) {
        const range = document.createRange();
        range.setStart(
          textNodes[startNodeIdx].node,
          matchStart - textNodes[startNodeIdx].start,
        );
        range.setEnd(
          textNodes[endNodeIdx].node,
          matchEnd - textNodes[endNodeIdx].start,
        );
        const mark = document.createElement("mark");
        mark.className = "cm-search-match";
        try {
          range.surroundContents(mark);
          markElements.push(mark);
        } catch {
          continue;
        }
      } else {
        for (let j = startNodeIdx; j <= endNodeIdx; j++) {
          const node = textNodes[j].node;
          const nodeStart = textNodes[j].start;
          const nodeText = node.textContent || "";

          const wrapStart = j === startNodeIdx ? matchStart - nodeStart : 0;
          const wrapEnd = j === endNodeIdx ? matchEnd - nodeStart : nodeText.length;
          if (wrapStart >= wrapEnd) continue;

          const partRange = document.createRange();
          partRange.setStart(node, wrapStart);
          partRange.setEnd(node, wrapEnd);

          const mark = document.createElement("mark");
          mark.className = "cm-search-match";
          try {
            partRange.surroundContents(mark);
            markElements.push(mark);
          } catch {
            continue;
          }
        }
      }

      if (markElements.length > 0) {
        allMarkElements.unshift(markElements);
      }
    } catch {
      continue;
    }
  }

  return allMarkElements;
}

// =====================================================
// Helper: clear table widget marks
// =====================================================

function clearTableMarks(view: EditorView) {
  const scroller = view.dom.querySelector(".cm-scroller");
  if (!scroller) return;

  const marks = scroller.querySelectorAll("mark.cm-search-match");
  marks.forEach((mark) => {
    const parent = mark.parentNode;
    if (parent) {
      const text = document.createTextNode(mark.textContent || "");
      parent.replaceChild(text, mark);
      parent.normalize();
    }
  });
}

// =====================================================
// Hook
// =====================================================

export function useMarkdownSearch(editorView: EditorView | null) {
  const [matchCount, setMatchCount] = useState(0);
  const [currentMatch, setCurrentMatch] = useState(0);
  const matchesRef = useRef<SearchMatch[]>([]);
  const currentIndexRef = useRef(-1);
  // Keep doc matches separate so we can rebuild the decoration set on navigation
  const docMatchesRef = useRef<DocMatch[]>([]);

  const clearSearch = useCallback(() => {
    if (editorView) {
      editorView.dispatch({
        effects: setSearchDecos.of(Decoration.none),
      });
      clearTableMarks(editorView);
    }

    matchesRef.current = [];
    docMatchesRef.current = [];
    currentIndexRef.current = -1;
    setMatchCount(0);
    setCurrentMatch(0);
  }, [editorView]);

  const highlightCurrent = useCallback(
    (matches: SearchMatch[], index: number) => {
      if (!editorView) return;

      // Remove "current" class from all table marks
      const scroller = editorView.dom.querySelector(".cm-scroller");
      scroller
        ?.querySelectorAll("mark.cm-search-match.current")
        .forEach((el) => el.classList.remove("current"));

      const match = matches[index];
      if (!match) return;

      if (match.type === "doc") {
        // Find the index of this doc match within docMatchesRef
        const docIdx = docMatchesRef.current.findIndex(
          (m) => m.from === match.from && m.to === match.to,
        );
        // Rebuild entire decoration set with current highlighted
        editorView.dispatch({
          effects: setSearchDecos.of(
            buildDecoSet(docMatchesRef.current, docIdx),
          ),
        });
        // Scroll into view
        editorView.dispatch({
          effects: EditorView.scrollIntoView(match.from, { y: "center" }),
        });
      } else {
        // No doc match is current — rebuild without current highlight
        editorView.dispatch({
          effects: setSearchDecos.of(
            buildDecoSet(docMatchesRef.current, -1),
          ),
        });
        // Highlight table mark and scroll
        match.markElements.forEach((el) => el.classList.add("current"));
        match.markElements[0]?.scrollIntoView({
          behavior: "smooth",
          block: "center",
        });
      }
    },
    [editorView],
  );

  const search = useCallback(
    (query: string, options: SearchOptions) => {
      clearSearch();

      if (!editorView || !query.trim()) return;

      const doc = editorView.state.doc;
      const docMatches: DocMatch[] = [];
      const allMatches: SearchMatch[] = [];

      // 1. Find table marker lines so we can skip them in doc search
      const markerLines = new Map<number, string>();
      for (let i = 1; i <= doc.lines; i++) {
        const line = doc.line(i);
        const m = tableMarkerRegex.exec(line.text.trim());
        if (m) {
          markerLines.set(i, m[1]);
        }
      }

      // 2. Detect code block ranges (fenced ``` / ~~~)
      interface WidgetRange {
        startLine: number;
        endLine: number;
      }
      const codeBlockRanges: WidgetRange[] = [];
      let cbStart = -1;
      for (let i = 1; i <= doc.lines; i++) {
        if (markerLines.has(i)) continue;
        const trimmed = doc.line(i).text.trimStart();
        if (/^(`{3,}|~{3,})/.test(trimmed)) {
          if (cbStart === -1) {
            cbStart = i;
          } else {
            codeBlockRanges.push({ startLine: cbStart, endLine: i });
            cbStart = -1;
          }
        }
      }

      // 3. Detect static markdown table ranges
      const staticTableRanges: WidgetRange[] = [];
      let tStart = -1;
      let tHasSep = false;
      for (let i = 1; i <= doc.lines; i++) {
        if (markerLines.has(i)) continue;
        const text = doc.line(i).text.trim();
        if (text.startsWith("|")) {
          if (tStart === -1) tStart = i;
          if (/^\|[\s\-:|]+\|$/.test(text)) tHasSep = true;
        } else {
          if (tStart !== -1 && tHasSep) {
            staticTableRanges.push({ startLine: tStart, endLine: i - 1 });
          }
          tStart = -1;
          tHasSep = false;
        }
      }
      if (tStart !== -1 && tHasSep) {
        staticTableRanges.push({ startLine: tStart, endLine: doc.lines });
      }

      // 4. Build set of lines to skip (widget-replaced content)
      const skipLines = new Set<number>();
      for (const [lineNum] of markerLines) {
        skipLines.add(lineNum);
      }
      for (const range of codeBlockRanges) {
        for (let j = range.startLine; j <= range.endLine; j++) {
          skipLines.add(j);
        }
      }
      for (const range of staticTableRanges) {
        for (let j = range.startLine; j <= range.endLine; j++) {
          skipLines.add(j);
        }
      }

      // 5. Search document text, skipping widget lines
      const searchText = options.matchCase ? query : query.toLowerCase();

      for (let i = 1; i <= doc.lines; i++) {
        if (skipLines.has(i)) continue;
        const line = doc.line(i);
        const lineText = options.matchCase ? line.text : line.text.toLowerCase();

        let start = 0;
        while (start < lineText.length) {
          const idx = lineText.indexOf(searchText, start);
          if (idx === -1) break;

          const from = line.from + idx;
          const to = from + searchText.length;

          if (options.wholeWords) {
            const before = idx > 0 ? lineText[idx - 1] : " ";
            const after =
              idx + searchText.length < lineText.length
                ? lineText[idx + searchText.length]
                : " ";
            if (/\w/.test(before) || /\w/.test(after)) {
              start = idx + 1;
              continue;
            }
          }

          const docMatch: DocMatch = { type: "doc", from, to };
          docMatches.push(docMatch);
          allMatches.push(docMatch);

          start = idx + 1;
          if (allMatches.length >= 1000) break;
        }
        if (allMatches.length >= 1000) break;
      }

      docMatchesRef.current = docMatches;

      // Dispatch doc decorations (all matches, no current yet)
      if (options.highlightAll) {
        editorView.dispatch({
          effects: setSearchDecos.of(buildDecoSet(docMatches, -1)),
        });
      }

      // 6. Search code block and static table widget DOMs
      const findClosestWidget = (
        selector: string,
        lineFrom: number,
      ): HTMLElement | null => {
        const wrappers = editorView.dom.querySelectorAll(selector);
        let closest: HTMLElement | null = null;
        const coords = editorView.coordsAtPos(lineFrom);
        if (coords) {
          let minDist = Infinity;
          wrappers.forEach((w) => {
            const rect = w.getBoundingClientRect();
            const dist = Math.abs(rect.top - coords.top);
            if (dist < minDist) {
              minDist = dist;
              closest = w as HTMLElement;
            }
          });
        }
        return closest;
      };

      for (const range of codeBlockRanges) {
        const lineFrom = doc.line(range.startLine).from;
        const wrapper = findClosestWidget(
          ".cm-md-codeblock-widget",
          lineFrom,
        );
        if (!wrapper) continue;

        const markGroups = searchTableWidgetDOM(wrapper, query, options);
        for (let idx = 0; idx < markGroups.length; idx++) {
          allMatches.push({
            type: "table",
            docPos: lineFrom,
            offset: idx,
            markElements: markGroups[idx],
          });
        }
      }

      for (const range of staticTableRanges) {
        const lineFrom = doc.line(range.startLine).from;
        const wrapper = findClosestWidget(".cm-md-table-wrapper", lineFrom);
        if (!wrapper) continue;

        const markGroups = searchTableWidgetDOM(wrapper, query, options);
        for (let idx = 0; idx < markGroups.length; idx++) {
          allMatches.push({
            type: "table",
            docPos: lineFrom,
            offset: idx,
            markElements: markGroups[idx],
          });
        }
      }

      // 7. Search inline table widgets (async)
      const tableEntries = Array.from(markerLines.entries());
      if (tableEntries.length > 0) {
        Promise.all(
          tableEntries.map(async ([lineNum, key]) => {
            try {
              const mdText = await getInlineTableAsMarkdown(key);
              const offsets = findTextMatches(mdText, query, options);
              if (offsets.length === 0) return [];

              const line = doc.line(lineNum);
              const wrappers = editorView.dom.querySelectorAll(
                ".cm-md-itable-wrapper",
              );
              let wrapper: HTMLElement | null = null;
              const lineCoords = editorView.coordsAtPos(line.from);
              if (lineCoords) {
                let minDist = Infinity;
                wrappers.forEach((w) => {
                  const rect = w.getBoundingClientRect();
                  const dist = Math.abs(rect.top - lineCoords.top);
                  if (dist < minDist) {
                    minDist = dist;
                    wrapper = w as HTMLElement;
                  }
                });
              }

              if (!wrapper) return [];

              const markGroups = searchTableWidgetDOM(wrapper, query, options);
              const docPos = line.from;

              return markGroups.map(
                (markElements, idx): TableMatch => ({
                  type: "table",
                  docPos,
                  offset: offsets[idx] ?? idx,
                  markElements,
                }),
              );
            } catch {
              return [];
            }
          }),
        ).then((tableMatchArrays) => {
          const tableMatches = tableMatchArrays.flat();

          if (tableMatches.length > 0) {
            const merged = [...allMatches, ...tableMatches].sort((a, b) => {
              const posA =
                a.type === "doc" ? a.from : a.docPos + a.offset * 0.001;
              const posB =
                b.type === "doc" ? b.from : b.docPos + b.offset * 0.001;
              return posA - posB;
            });

            matchesRef.current = merged;
            setMatchCount(merged.length);

            if (merged.length > 0 && options.highlightAll) {
              currentIndexRef.current = 0;
              setCurrentMatch(1);
              highlightCurrent(merged, 0);
            }
          }
        });
      }

      // Set initial matches (doc only, tables will merge in async)
      matchesRef.current = allMatches;
      setMatchCount(allMatches.length);

      if (allMatches.length > 0 && options.highlightAll) {
        currentIndexRef.current = 0;
        setCurrentMatch(1);
        highlightCurrent(allMatches, 0);
      }
    },
    [editorView, clearSearch, highlightCurrent],
  );

  const searchNext = useCallback(() => {
    const matches = matchesRef.current;
    if (matches.length === 0) return;

    const newIndex = (currentIndexRef.current + 1) % matches.length;
    currentIndexRef.current = newIndex;
    setCurrentMatch(newIndex + 1);
    highlightCurrent(matches, newIndex);
  }, [highlightCurrent]);

  const searchPrev = useCallback(() => {
    const matches = matchesRef.current;
    if (matches.length === 0) return;

    const newIndex =
      (currentIndexRef.current - 1 + matches.length) % matches.length;
    currentIndexRef.current = newIndex;
    setCurrentMatch(newIndex + 1);
    highlightCurrent(matches, newIndex);
  }, [highlightCurrent]);

  return {
    search,
    searchNext,
    searchPrev,
    clearSearch,
    matchCount,
    currentMatch,
  };
}
