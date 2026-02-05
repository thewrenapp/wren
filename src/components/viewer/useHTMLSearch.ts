import { useState, useCallback, useRef } from "react";

export interface SearchOptions {
  highlightAll: boolean;
  matchCase: boolean;
  wholeWords: boolean;
}

interface SearchMatch {
  range: Range;
  markElements: HTMLElement[];
}

export interface UseHTMLSearchReturn {
  search: (query: string, options: SearchOptions) => void;
  searchNext: () => void;
  searchPrev: () => void;
  clearSearch: () => void;
  matchCount: number;
  currentMatch: number;
}

export function useHTMLSearch(
  iframeRef: React.RefObject<HTMLIFrameElement | null>
): UseHTMLSearchReturn {
  const [matchCount, setMatchCount] = useState(0);
  const [currentMatch, setCurrentMatch] = useState(0);
  const matchesRef = useRef<SearchMatch[]>([]);
  const currentIndexRef = useRef(-1);

  const clearSearch = useCallback(() => {
    const iframeDoc = iframeRef.current?.contentDocument;
    if (!iframeDoc) return;

    // Remove all search marks
    const marks = iframeDoc.querySelectorAll("mark.html-search-match");
    marks.forEach((mark) => {
      const parent = mark.parentNode;
      if (parent) {
        // Replace mark with its text content
        const text = iframeDoc.createTextNode(mark.textContent || "");
        parent.replaceChild(text, mark);
        parent.normalize(); // Merge adjacent text nodes
      }
    });

    matchesRef.current = [];
    currentIndexRef.current = -1;
    setMatchCount(0);
    setCurrentMatch(0);
  }, [iframeRef]);

  const search = useCallback(
    (query: string, options: SearchOptions) => {
      clearSearch();

      const iframeDoc = iframeRef.current?.contentDocument;
      if (!iframeDoc || !query.trim()) return;

      const matches: SearchMatch[] = [];

      // Walk all text nodes
      const walker = iframeDoc.createTreeWalker(
        iframeDoc.body,
        NodeFilter.SHOW_TEXT,
        {
          acceptNode: (node) => {
            // Skip nodes inside search marks or annotation marks
            const parent = node.parentElement;
            if (parent?.closest("mark.html-search-match")) {
              return NodeFilter.FILTER_REJECT;
            }
            return NodeFilter.FILTER_ACCEPT;
          },
        }
      );

      // Build concatenated text with node tracking
      const textNodes: { node: Text; start: number }[] = [];
      let totalText = "";

      let textNode: Text | null;
      while ((textNode = walker.nextNode() as Text | null)) {
        textNodes.push({ node: textNode, start: totalText.length });
        totalText += textNode.textContent || "";
      }

      // Find all occurrences
      const searchText = options.matchCase ? query : query.toLowerCase();
      const searchIn = options.matchCase ? totalText : totalText.toLowerCase();
      const offsets: number[] = [];

      let searchStart = 0;
      while (searchStart < searchIn.length) {
        const idx = searchIn.indexOf(searchText, searchStart);
        if (idx === -1) break;

        // Whole word check
        if (options.wholeWords) {
          const before = idx > 0 ? searchIn[idx - 1] : " ";
          const after =
            idx + searchText.length < searchIn.length
              ? searchIn[idx + searchText.length]
              : " ";
          if (/\w/.test(before) || /\w/.test(after)) {
            searchStart = idx + 1;
            continue;
          }
        }

        offsets.push(idx);
        searchStart = idx + 1;

        // Safety limit
        if (offsets.length >= 1000) break;
      }

      // Create marks for each match
      // Process in reverse order to avoid offset shifting
      for (let i = offsets.length - 1; i >= 0; i--) {
        const matchStart = offsets[i];
        const matchEnd = matchStart + searchText.length;

        // Find the text nodes containing this match
        let startNodeIdx = -1;
        let endNodeIdx = -1;

        for (let j = 0; j < textNodes.length; j++) {
          const nodeStart = textNodes[j].start;
          const nodeEnd =
            nodeStart + (textNodes[j].node.textContent?.length || 0);

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
          const range = iframeDoc.createRange();
          range.setStart(
            textNodes[startNodeIdx].node,
            matchStart - textNodes[startNodeIdx].start
          );
          range.setEnd(
            textNodes[endNodeIdx].node,
            matchEnd - textNodes[endNodeIdx].start
          );

          // Wrap in mark element
          const markElements: HTMLElement[] = [];

          if (startNodeIdx === endNodeIdx) {
            // Single text node — use surroundContents
            const mark = iframeDoc.createElement("mark");
            mark.className = "html-search-match";
            try {
              range.surroundContents(mark);
              markElements.push(mark);
            } catch {
              // surroundContents fails for cross-element ranges
              continue;
            }
          } else {
            // Multi-node: wrap each text node portion separately
            for (let j = startNodeIdx; j <= endNodeIdx; j++) {
              const node = textNodes[j].node;
              const nodeStart = textNodes[j].start;
              const nodeText = node.textContent || "";

              const wrapStart =
                j === startNodeIdx ? matchStart - nodeStart : 0;
              const wrapEnd =
                j === endNodeIdx ? matchEnd - nodeStart : nodeText.length;

              if (wrapStart >= wrapEnd) continue;

              const partRange = iframeDoc.createRange();
              partRange.setStart(node, wrapStart);
              partRange.setEnd(node, wrapEnd);

              const mark = iframeDoc.createElement("mark");
              mark.className = "html-search-match";
              try {
                partRange.surroundContents(mark);
                markElements.push(mark);
              } catch {
                continue;
              }
            }
          }

          if (markElements.length > 0) {
            matches.unshift({ range, markElements }); // unshift because we process in reverse
          }
        } catch {
          continue;
        }
      }

      matchesRef.current = matches;
      setMatchCount(matches.length);

      if (matches.length > 0 && options.highlightAll) {
        // Navigate to first match
        currentIndexRef.current = 0;
        setCurrentMatch(1);
        highlightCurrentMatch(matches, 0);
      }
    },
    [iframeRef, clearSearch]
  );

  const highlightCurrentMatch = useCallback(
    (matches: SearchMatch[], index: number) => {
      // Remove current class from all
      matches.forEach((m) =>
        m.markElements.forEach((el) => el.classList.remove("current"))
      );

      // Add current class to active match
      if (index >= 0 && index < matches.length) {
        matches[index].markElements.forEach((el) =>
          el.classList.add("current")
        );
        // Scroll into view
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

    const newIndex =
      (currentIndexRef.current - 1 + matches.length) % matches.length;
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
