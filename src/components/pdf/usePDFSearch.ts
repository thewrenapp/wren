import { useState, useCallback, useRef, useEffect, type MutableRefObject } from "react";
import type { PdfHighlighterUtils } from "@/components/pdf/pdfjs";
import type { SearchOptions } from "./PDFToolbar";

interface UsePDFSearchOptions {
  pdfHighlighterUtilsRef: MutableRefObject<PdfHighlighterUtils | null>;
  viewerReady: boolean;
}

export function usePDFSearch({ pdfHighlighterUtilsRef, viewerReady }: UsePDFSearchOptions) {
  const [searchMatchCount, setSearchMatchCount] = useState(0);
  const [searchCurrentMatch, setSearchCurrentMatch] = useState(0);

  const searchStateRef = useRef<{ query: string; options: SearchOptions }>({
    query: "",
    options: { highlightAll: true, matchCase: false, wholeWords: false },
  });

  useEffect(() => {
    if (!viewerReady || !pdfHighlighterUtilsRef.current) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const eventBus = pdfHighlighterUtilsRef.current.getEventBus() as any;
    if (!eventBus) return;

    const handleUpdateFindMatchesCount = (evt: { matchesCount: { current: number; total: number } }) => {
      setSearchMatchCount(evt.matchesCount.total);
      setSearchCurrentMatch(evt.matchesCount.current);
    };

    const handleUpdateFindControlState = (evt: { matchesCount?: { current: number; total: number } }) => {
      if (evt.matchesCount) {
        setSearchMatchCount(evt.matchesCount.total);
        setSearchCurrentMatch(evt.matchesCount.current);
      }
    };

    eventBus.on("updatefindmatchescount", handleUpdateFindMatchesCount);
    eventBus.on("updatefindcontrolstate", handleUpdateFindControlState);

    return () => {
      eventBus.off("updatefindmatchescount", handleUpdateFindMatchesCount);
      eventBus.off("updatefindcontrolstate", handleUpdateFindControlState);
    };
  }, [viewerReady, pdfHighlighterUtilsRef]);

  const handleSearch = useCallback((query: string, options: SearchOptions) => {
    const findController = pdfHighlighterUtilsRef.current?.getFindController();
    if (!findController) {
      console.warn("FindController not initialized yet");
      return;
    }

    searchStateRef.current = { query, options };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const eventBus = pdfHighlighterUtilsRef.current?.getEventBus() as any;
    if (!eventBus) return;

    eventBus.dispatch("find", {
      source: window,
      type: "find",
      query,
      phraseSearch: true,
      caseSensitive: options.matchCase,
      entireWord: options.wholeWords,
      highlightAll: options.highlightAll,
      findPrevious: false,
    });
  }, [pdfHighlighterUtilsRef]);

  const handleSearchNext = useCallback(() => {
    const findController = pdfHighlighterUtilsRef.current?.getFindController();
    if (!findController) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const eventBus = pdfHighlighterUtilsRef.current?.getEventBus() as any;
    if (!eventBus) return;

    const { query, options } = searchStateRef.current;
    eventBus.dispatch("find", {
      source: window,
      type: "again",
      query,
      phraseSearch: true,
      caseSensitive: options.matchCase,
      entireWord: options.wholeWords,
      highlightAll: options.highlightAll,
      findPrevious: false,
    });
  }, [pdfHighlighterUtilsRef]);

  const handleSearchPrev = useCallback(() => {
    const findController = pdfHighlighterUtilsRef.current?.getFindController();
    if (!findController) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const eventBus = pdfHighlighterUtilsRef.current?.getEventBus() as any;
    if (!eventBus) return;

    const { query, options } = searchStateRef.current;
    eventBus.dispatch("find", {
      source: window,
      type: "again",
      query,
      phraseSearch: true,
      caseSensitive: options.matchCase,
      entireWord: options.wholeWords,
      highlightAll: options.highlightAll,
      findPrevious: true,
    });
  }, [pdfHighlighterUtilsRef]);

  const handleSearchClear = useCallback(() => {
    const findController = pdfHighlighterUtilsRef.current?.getFindController();
    if (!findController) {
      setSearchMatchCount(0);
      setSearchCurrentMatch(0);
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const eventBus = pdfHighlighterUtilsRef.current?.getEventBus() as any;
    if (!eventBus) return;

    searchStateRef.current = {
      query: "",
      options: { highlightAll: true, matchCase: false, wholeWords: false },
    };

    eventBus.dispatch("find", {
      source: window,
      type: "find",
      query: "",
      phraseSearch: true,
      caseSensitive: false,
      entireWord: false,
      highlightAll: false,
      findPrevious: false,
    });

    setSearchMatchCount(0);
    setSearchCurrentMatch(0);
  }, [pdfHighlighterUtilsRef]);

  return {
    searchMatchCount,
    searchCurrentMatch,
    handleSearch,
    handleSearchNext,
    handleSearchPrev,
    handleSearchClear,
  };
}
