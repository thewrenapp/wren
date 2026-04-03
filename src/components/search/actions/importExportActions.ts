import { open, save } from "@tauri-apps/plugin-dialog";
import { writeTextFile, readTextFile } from "@tauri-apps/plugin-fs";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import {
  exportToBibtex,
  exportToCslJson,
  exportAllToBibtex,
  exportAllToCslJson,
  previewBiblatexImport,
  importBibtex,
  importCslJson,
  getEntries,
  type BiblatexPreviewResult,
} from "@/services/tauri";
import { toast } from "@/stores/toastStore";
import type { SearchState } from "../CommandPaletteSearch";

interface ImportExportDeps {
  searchState: SearchState;
  setCommandPaletteOpen: (open: boolean) => void;
  selectedEntryIds: number[];
  invalidateAttachments: () => void;
  refreshLibrary: () => Promise<void>;
  importFiles: (files: string[]) => Promise<unknown>;
  importFolder: (path: string) => Promise<unknown>;
  setSubMenu: (menu: null) => void;
  setExportMode: (mode: "selected" | "all") => void;
  setShowExportDialog: (open: boolean) => void;
  setExportContext: (ctx: { type: "collection" | "tag"; id: number; name: string } | null) => void;
  setShowImportPreview: (open: boolean) => void;
  setImportPreviewData: (data: BiblatexPreviewResult | null) => void;
  setImportFolderPath: (path: string | null) => void;
}

export function createImportExportActions(deps: ImportExportDeps) {
  const {
    searchState, setCommandPaletteOpen, selectedEntryIds,
    invalidateAttachments, refreshLibrary, importFiles, importFolder,
    setSubMenu, setExportMode, setShowExportDialog, setExportContext,
    setShowImportPreview, setImportPreviewData, setImportFolderPath,
  } = deps;

  const handleImportPdf = async () => {
    setCommandPaletteOpen(false);
    searchState.setSearch("");
    try {
      const selected = await open({ multiple: true, filters: [{ name: "PDF", extensions: ["pdf"] }] });
      if (selected && Array.isArray(selected) && selected.length > 0) await importFiles(selected);
    } catch (err) { console.error("Import error:", err); }
  };

  const handleImportFolder = async () => {
    setCommandPaletteOpen(false);
    searchState.setSearch("");
    try {
      const selected = await open({ directory: true, multiple: false });
      if (selected && typeof selected === "string") await importFolder(selected);
    } catch (err) { console.error("Import folder error:", err); }
  };

  const handleImportBibtex = async () => {
    setCommandPaletteOpen(false);
    searchState.setSearch("");
    try {
      const selected = await open({ multiple: false, filters: [{ name: "BibTeX", extensions: ["bib", "bibtex"] }] });
      if (selected && typeof selected === "string") {
        const content = await readTextFile(selected);
        const result = await importBibtex(content);
        if (result.imported > 0) { toast.success(`Imported ${result.imported} entries from BibTeX`); invalidateAttachments(); await refreshLibrary(); }
        else if (result.skipped > 0) { toast.info(`${result.skipped} entries skipped (duplicates)`); }
        if (result.errors.length > 0) console.error("BibTeX import errors:", result.errors);
      }
    } catch (err) { console.error("Import BibTeX error:", err); toast.error("Failed to import BibTeX file"); }
  };

  const handleImportCslJson = async () => {
    setCommandPaletteOpen(false);
    searchState.setSearch("");
    try {
      const selected = await open({ multiple: false, filters: [{ name: "CSL JSON", extensions: ["json"] }] });
      if (selected && typeof selected === "string") {
        const content = await readTextFile(selected);
        const result = await importCslJson(content);
        if (result.imported > 0) { toast.success(`Imported ${result.imported} entries from CSL JSON`); invalidateAttachments(); await refreshLibrary(); }
        else if (result.skipped > 0) { toast.info(`${result.skipped} entries skipped (duplicates)`); }
        if (result.errors.length > 0) console.error("CSL JSON import errors:", result.errors);
      }
    } catch (err) { console.error("Import CSL JSON error:", err); toast.error("Failed to import CSL JSON file"); }
  };

  const handleImportBiblatexWithFiles = async () => {
    setCommandPaletteOpen(false);
    searchState.setSearch("");
    try {
      const selected = await open({ directory: true, title: "Select Zotero Export Folder" });
      if (selected && typeof selected === "string") {
        const preview = await previewBiblatexImport(selected);
        setImportPreviewData(preview);
        setImportFolderPath(selected);
        setShowImportPreview(true);
      }
    } catch (err) { console.error("Import BibLaTeX error:", err); toast.error("Failed to preview BibLaTeX folder"); }
  };

  const handleExportSelectedBibtex = async () => {
    if (selectedEntryIds.length === 0) { toast.warning("No entries selected"); return; }
    try {
      const bibtex = await exportToBibtex(selectedEntryIds);
      const filePath = await save({ filters: [{ name: "BibTeX", extensions: ["bib"] }], defaultPath: "export.bib" });
      if (filePath) { await writeTextFile(filePath, bibtex); toast.success(`Exported ${selectedEntryIds.length} entries to BibTeX`); }
    } catch (err) { console.error("Export error:", err); toast.error("Failed to export"); }
    setCommandPaletteOpen(false);
  };

  const handleExportSelectedCsl = async () => {
    if (selectedEntryIds.length === 0) { toast.warning("No entries selected"); return; }
    try {
      const csl = await exportToCslJson(selectedEntryIds);
      const filePath = await save({ filters: [{ name: "CSL JSON", extensions: ["json"] }], defaultPath: "export.json" });
      if (filePath) { await writeTextFile(filePath, csl); toast.success(`Exported ${selectedEntryIds.length} entries to CSL JSON`); }
    } catch (err) { console.error("Export error:", err); toast.error("Failed to export"); }
    setCommandPaletteOpen(false);
  };

  const handleExportAllBibtex = async () => {
    try {
      const bibtex = await exportAllToBibtex();
      const filePath = await save({ filters: [{ name: "BibTeX", extensions: ["bib"] }], defaultPath: "library.bib" });
      if (filePath) { await writeTextFile(filePath, bibtex); toast.success("Exported entire library to BibTeX"); }
    } catch (err) { console.error("Export error:", err); toast.error("Failed to export"); }
    setCommandPaletteOpen(false);
  };

  const handleExportAllCsl = async () => {
    try {
      const csl = await exportAllToCslJson();
      const filePath = await save({ filters: [{ name: "CSL JSON", extensions: ["json"] }], defaultPath: "library.json" });
      if (filePath) { await writeTextFile(filePath, csl); toast.success("Exported entire library to CSL JSON"); }
    } catch (err) { console.error("Export error:", err); toast.error("Failed to export"); }
    setCommandPaletteOpen(false);
  };

  const handleCopyBibtex = async () => {
    if (selectedEntryIds.length === 0) { toast.warning("No entries selected"); return; }
    try { const bibtex = await exportToBibtex(selectedEntryIds); await writeText(bibtex); toast.success("Copied BibTeX to clipboard"); }
    catch (err) { console.error("Copy error:", err); toast.error("Failed to copy"); }
    setCommandPaletteOpen(false);
  };

  const handleCopyCsl = async () => {
    if (selectedEntryIds.length === 0) { toast.warning("No entries selected"); return; }
    try { const csl = await exportToCslJson(selectedEntryIds); await writeText(csl); toast.success("Copied CSL JSON to clipboard"); }
    catch (err) { console.error("Copy error:", err); toast.error("Failed to copy"); }
    setCommandPaletteOpen(false);
  };

  const handleExportCollection = async (collectionId: number, collectionName: string, format: "bibtex" | "csl") => {
    try {
      const collectionEntries = await getEntries({ collectionId });
      const entryIds = collectionEntries.map((e) => e.id);
      if (entryIds.length === 0) { toast.warning("No entries in this collection"); return; }
      const content = format === "bibtex" ? await exportToBibtex(entryIds) : await exportToCslJson(entryIds);
      const ext = format === "bibtex" ? "bib" : "json";
      const filterName = format === "bibtex" ? "BibTeX" : "CSL JSON";
      const filePath = await save({ defaultPath: `${collectionName}.${ext}`, filters: [{ name: filterName, extensions: [ext] }] });
      if (filePath) { await writeTextFile(filePath, content); toast.success(`Exported collection "${collectionName}"`); }
    } catch (err) { console.error("Export collection error:", err); toast.error("Failed to export collection"); }
    setCommandPaletteOpen(false);
    setSubMenu(null);
  };

  const handleExportTag = async (tagId: number, tagName: string, format: "bibtex" | "csl") => {
    try {
      const tagEntries = await getEntries({ tagIds: [tagId] });
      const entryIds = tagEntries.map((e) => e.id);
      if (entryIds.length === 0) { toast.warning("No entries with this tag"); return; }
      const content = format === "bibtex" ? await exportToBibtex(entryIds) : await exportToCslJson(entryIds);
      const ext = format === "bibtex" ? "bib" : "json";
      const filterName = format === "bibtex" ? "BibTeX" : "CSL JSON";
      const filePath = await save({ defaultPath: `${tagName}.${ext}`, filters: [{ name: filterName, extensions: [ext] }] });
      if (filePath) { await writeTextFile(filePath, content); toast.success(`Exported tag "${tagName}"`); }
    } catch (err) { console.error("Export tag error:", err); toast.error("Failed to export tag"); }
    setCommandPaletteOpen(false);
    setSubMenu(null);
  };

  const handleExportCollectionWithFiles = (collectionId: number, collectionName: string) => {
    setExportContext({ type: "collection", id: collectionId, name: collectionName });
    setShowExportDialog(true);
    setSubMenu(null);
  };

  const handleExportTagWithFiles = (tagId: number, tagName: string) => {
    setExportContext({ type: "tag", id: tagId, name: tagName });
    setShowExportDialog(true);
    setSubMenu(null);
  };

  const openExportDialog = (mode: "selected" | "all") => {
    setExportMode(mode);
    setShowExportDialog(true);
  };

  return {
    handleImportPdf, handleImportFolder, handleImportBibtex,
    handleImportCslJson, handleImportBiblatexWithFiles,
    handleExportSelectedBibtex, handleExportSelectedCsl,
    handleExportAllBibtex, handleExportAllCsl,
    handleCopyBibtex, handleCopyCsl,
    handleExportCollection, handleExportTag,
    handleExportCollectionWithFiles, handleExportTagWithFiles,
    openExportDialog,
  };
}
