import { useState, useCallback, useRef } from "react";
import type { Rendition } from "epubjs";

export interface SearchOptions {
  highlightAll: boolean;
  matchCase: boolean;
  wholeWords: boolean;
}

interface SearchMatch {
  markElements: HTMLElement[];
  sectionIndex: number;
  sectionHref: string;
}

export interface UseEPUBSearchReturn {
  search: (query: string, options: SearchOptions) => void;
  searchNext: () => void;
  searchPrev: () => void;
  clearSearch: () => void;
  matchCount: number;
  currentMatch: number;
}

export function useEPUBSearch(
  renditionRef: React.RefObject<Rendition | null>,
  _bookRef: React.RefObject<unknown>
): UseEPUBSearchReturn {
  const [matchCount, setMatchCount] = useState(0);
  const [currentMatch, setCurrentMatch] = useState(0);
  const matchesRef = useRef<SearchMatch[]>([]);
  const currentIndexRef = useRef(-1);
  const lastQueryRef = useRef("");
  const lastOptionsRef = useRef<SearchOptions>({ highlightAll: true, matchCase: false, wholeWords: false });

  const clearMarksInDoc = useCallback((doc: Document) => {
    const marks = doc.querySelectorAll("mark.epub-search-match");
    marks.forEach((mark) => {
      const parent = mark.parentNode;
      if (parent) {
        const text = doc.createTextNode(mark.textContent || "");
        parent.replaceChild(text, mark);
        parent.normalize();
      }
    });
  }, []);

  const clearSearch = useCallback(() => {
    const rendition = renditionRef.current;
    if (rendition) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const contents = (rendition.getContents() as any) as any[];
      for (const content of contents) {
        const doc = content.document as Document | undefined;
        if (doc) clearMarksInDoc(doc);
      }
    }

    matchesRef.current = [];
    currentIndexRef.current = -1;
    lastQueryRef.current = "";
    setMatchCount(0);
    setCurrentMatch(0);
  }, [renditionRef, clearMarksInDoc]);

  const searchInDocument = useCallback(
    (doc: Document, query: string, options: SearchOptions, sectionIndex: number, sectionHref: string): SearchMatch[] => {
      const matches: SearchMatch[] = [];

      // Walk all text nodes
      const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, {
        acceptNode: (node) => {
          const parent = node.parentElement;
          if (parent?.closest("mark.epub-search-match")) {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        },
      });

      const textNodes: { node: Text; start: number }[] = [];
      let totalText = "";

      let textNode: Text | null;
      while ((textNode = walker.nextNode() as Text | null)) {
        textNodes.push({ node: textNode, start: totalText.length });
        totalText += textNode.textContent || "";
      }

      const searchText = options.matchCase ? query : query.toLowerCase();
      const searchIn = options.matchCase ? totalText : totalText.toLowerCase();
      const offsets: number[] = [];

      let searchStart = 0;
      while (searchStart < searchIn.length) {
        const idx = searchIn.indexOf(searchText, searchStart);
        if (idx === -1) break;

        if (options.wholeWords) {
          const before = idx > 0 ? searchIn[idx - 1] : " ";
          const after = idx + searchText.length < searchIn.length ? searchIn[idx + searchText.length] : " ";
          if (/\w/.test(before) || /\w/.test(after)) {
            searchStart = idx + 1;
            continue;
          }
        }

        offsets.push(idx);
        searchStart = idx + 1;
        if (offsets.length >= 500) break;
      }

      // Create marks in reverse order
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
            const range = doc.createRange();
            range.setStart(textNodes[startNodeIdx].node, matchStart - textNodes[startNodeIdx].start);
            range.setEnd(textNodes[endNodeIdx].node, matchEnd - textNodes[endNodeIdx].start);

            const mark = doc.createElement("mark");
            mark.className = "epub-search-match";
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

              const partRange = doc.createRange();
              partRange.setStart(node, wrapStart);
              partRange.setEnd(node, wrapEnd);

              const mark = doc.createElement("mark");
              mark.className = "epub-search-match";
              try {
                partRange.surroundContents(mark);
                markElements.push(mark);
              } catch {
                continue;
              }
            }
          }

          if (markElements.length > 0) {
            matches.unshift({ markElements, sectionIndex, sectionHref });
          }
        } catch {
          continue;
        }
      }

      return matches;
    },
    []
  );

  const search = useCallback(
    (query: string, options: SearchOptions) => {
      clearSearch();
      lastQueryRef.current = query;
      lastOptionsRef.current = options;

      const rendition = renditionRef.current;
      if (!rendition || !query.trim()) return;

      // Search in the currently displayed section
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const contents = (rendition.getContents() as any) as any[];
      const allMatches: SearchMatch[] = [];

      for (const content of contents) {
        const doc = content.document as Document | undefined;
        const sectionHref = content.sectionIndex !== undefined
          ? String(content.sectionIndex)
          : "0";
        if (doc) {
          const sectionMatches = searchInDocument(doc, query, options, 0, sectionHref);
          allMatches.push(...sectionMatches);
        }
      }

      matchesRef.current = allMatches;
      setMatchCount(allMatches.length);

      if (allMatches.length > 0 && options.highlightAll) {
        currentIndexRef.current = 0;
        setCurrentMatch(1);
        highlightCurrentMatch(allMatches, 0);
      }
    },
    [renditionRef, clearSearch, searchInDocument]
  );

  const highlightCurrentMatch = useCallback(
    (matches: SearchMatch[], index: number) => {
      matches.forEach((m) =>
        m.markElements.forEach((el) => el.classList.remove("current"))
      );

      if (index >= 0 && index < matches.length) {
        matches[index].markElements.forEach((el) => el.classList.add("current"));
        matches[index].markElements[0]?.scrollIntoView({
          behavior: "smooth",
          block: "center",
        });
      }
    },
    []
  );

  const searchNext = useCallback(() => {
    const matches = matchesRef.current;
    if (matches.length === 0) return;

    const newIndex = (currentIndexRef.current + 1) % matches.length;
    currentIndexRef.current = newIndex;
    setCurrentMatch(newIndex + 1);
    highlightCurrentMatch(matches, newIndex);
  }, [highlightCurrentMatch]);

  const searchPrev = useCallback(() => {
    const matches = matchesRef.current;
    if (matches.length === 0) return;

    const newIndex = (currentIndexRef.current - 1 + matches.length) % matches.length;
    currentIndexRef.current = newIndex;
    setCurrentMatch(newIndex + 1);
    highlightCurrentMatch(matches, newIndex);
  }, [highlightCurrentMatch]);

  return {
    search,
    searchNext,
    searchPrev,
    clearSearch,
    matchCount,
    currentMatch,
  };
}
