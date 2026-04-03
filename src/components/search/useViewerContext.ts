import { useState, useEffect } from "react";
import {
  getEntriesPrimaryAttachmentType,
  getEntryAttachments,
} from "@/services/tauri";
import type { Tab } from "@/stores/tabStore";
import type { ViewerContext } from "./commands/types";

export function useTabTypeLabels(tabs: Tab[]): Record<string, string> {
  const [tabTypeLabels, setTabTypeLabels] = useState<Record<string, string>>({});
  useEffect(() => {
    const entryTabs = tabs.filter(t => t.type === "entry" && t.entryId);
    if (entryTabs.length === 0) return;
    let cancelled = false;
    const typeDisplayMap: Record<string, string> = {
      pdf: "PDF", epub: "EPUB", snapshot: "Web Snapshot", image: "Image",
      note: "Notes", weblink: "Weblink",
    };
    const entryIds = entryTabs.map(t => Number(t.entryId));
    getEntriesPrimaryAttachmentType(entryIds)
      .then((typeMap) => {
        if (cancelled) return;
        const labelMap: Record<string, string> = {};
        for (const tab of entryTabs) {
          const typeName = typeMap[Number(tab.entryId)];
          labelMap[tab.id] = typeName ? (typeDisplayMap[typeName] || "Entry") : "Entry";
        }
        setTabTypeLabels(labelMap);
      })
      .catch(() => {
        if (cancelled) return;
        const labelMap: Record<string, string> = {};
        for (const tab of entryTabs) { labelMap[tab.id] = "Entry"; }
        setTabTypeLabels(labelMap);
      });
    return () => { cancelled = true; };
  }, [tabs]);
  return tabTypeLabels;
}

export function useViewerContext(activeTab: Tab | undefined): { viewerContext: ViewerContext; contextAttachmentId: number | null } {
  const [viewerContext, setViewerContext] = useState<ViewerContext>("library");
  const [contextAttachmentId, setContextAttachmentId] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!activeTab) { setViewerContext("library"); setContextAttachmentId(null); return; }
    if (activeTab.type === "library") { setViewerContext("library"); setContextAttachmentId(null); return; }
    if (activeTab.type === "welcome") { setViewerContext("welcome"); setContextAttachmentId(null); return; }
    if (activeTab.type === "markdown") {
      setViewerContext("markdown");
      if (activeTab.entryId) {
        getEntryAttachments(Number(activeTab.entryId)).then(attachments => {
          if (cancelled) return;
          const target = activeTab.attachmentId
            ? attachments.find(a => String(a.id) === activeTab.attachmentId)
            : attachments.find(a => a.filePath);
          setContextAttachmentId(target?.id ?? null);
        }).catch(() => { if (!cancelled) setContextAttachmentId(null); });
      }
      return () => { cancelled = true; };
    }
    if (activeTab.type !== "entry" || !activeTab.entryId) { setViewerContext("none"); setContextAttachmentId(null); return; }
    getEntryAttachments(Number(activeTab.entryId)).then(attachments => {
      if (cancelled) return;
      let target = activeTab.attachmentId
        ? attachments.find(a => String(a.id) === activeTab.attachmentId)
        : undefined;
      if (!target) {
        for (const type of ["pdf", "epub", "snapshot", "image"]) {
          target = attachments.find(a => a.attachmentType === type);
          if (target) break;
        }
      }
      if (!target) target = attachments.find(a => a.filePath);
      const typeMap: Record<string, ViewerContext> = {
        pdf: "pdf", epub: "epub", snapshot: "html", image: "image",
        note: "note", weblink: "weblink",
      };
      setViewerContext(target ? (typeMap[target.attachmentType] || "none") : "none");
      setContextAttachmentId(target?.id ?? null);
    }).catch(() => { if (!cancelled) { setViewerContext("none"); setContextAttachmentId(null); } });
    return () => { cancelled = true; };
  }, [activeTab?.id, activeTab?.type, activeTab?.entryId, activeTab?.attachmentId]);

  return { viewerContext, contextAttachmentId };
}
