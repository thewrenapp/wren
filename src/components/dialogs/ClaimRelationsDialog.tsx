import { useState, useEffect, useMemo } from 'react';
import { Loader2, ExternalLink, ChevronDown, ChevronRight, Scale, Zap, Check, ArrowUpRight } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useUIStore } from '@/stores/uiStore';
import { useTabStore } from '@/stores/tabStore';
import { graphGetClaimRelations, graphAutoRelate, type ClaimRelationInfo } from '@/services/tauri/commands';
import { toast } from '@/stores/toastStore';
import { cn } from '@/lib/utils';

type RelationFilter = 'all' | 'contradicts' | 'supports' | 'refines';

const RELATION_STYLES: Record<string, { icon: typeof Zap; color: string; label: string }> = {
  contradicts: { icon: Zap, color: 'text-destructive', label: 'Contradicts' },
  supports: { icon: Check, color: 'text-green-600 dark:text-green-400', label: 'Supports' },
  refines: { icon: ArrowUpRight, color: 'text-amber-600 dark:text-amber-400', label: 'Refines' },
};

export function ClaimRelationsDialog() {
  const { claimRelationsDialog, hideClaimRelations } = useUIStore();
  const { open, entryId, entryTitle } = claimRelationsDialog;
  const { openTab } = useTabStore();

  const [relations, setRelations] = useState<ClaimRelationInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<RelationFilter>('all');
  const [expandedReasoning, setExpandedReasoning] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (!open || entryId == null) return;
    setLoading(true);
    setFilter('all');
    setExpandedReasoning(new Set());
    graphGetClaimRelations(entryId)
      .then(setRelations)
      .catch((err) => {
        console.error('Failed to load claim relations:', err);
        toast.error('Failed to load claim relations');
        setRelations([]);
      })
      .finally(() => setLoading(false));
  }, [open, entryId]);

  const counts = useMemo(() => {
    const c = { all: relations.length, contradicts: 0, supports: 0, refines: 0 };
    for (const r of relations) {
      const t = r.relationType as keyof typeof c;
      if (t in c) c[t]++;
    }
    return c;
  }, [relations]);

  const filtered = useMemo(() => {
    if (filter === 'all') return relations;
    return relations.filter((r) => r.relationType === filter);
  }, [relations, filter]);

  const toggleReasoning = (relationId: number) => {
    setExpandedReasoning((prev) => {
      const next = new Set(prev);
      if (next.has(relationId)) next.delete(relationId);
      else next.add(relationId);
      return next;
    });
  };

  const handleOpenPaper = (paperEntryId: number, title: string) => {
    openTab({ type: 'entry', title, entryId: String(paperEntryId) });
  };

  const handleFindRelated = async () => {
    if (entryId == null) return;
    try {
      await graphAutoRelate([entryId]);
      toast.info('Finding related papers in background');
    } catch (err) {
      toast.error(`Failed: ${err}`);
    }
  };

  const filterButtons: { key: RelationFilter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'contradicts', label: 'Contradicts' },
    { key: 'supports', label: 'Supports' },
    { key: 'refines', label: 'Refines' },
  ];

  return (
    <Dialog open={open} onOpenChange={(o) => !o && hideClaimRelations()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <Scale className="h-5 w-5" />
            Claim Relations
          </DialogTitle>
          <DialogDescription className="truncate">
            {entryTitle}
          </DialogDescription>
        </DialogHeader>

        {/* Filter tabs */}
        {!loading && relations.length > 0 && (
          <div className="flex gap-1 flex-shrink-0">
            {filterButtons.map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setFilter(key)}
                className={cn(
                  'px-2.5 py-1 rounded-md text-xs font-medium transition-colors',
                  filter === key
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground hover:bg-muted/80'
                )}
              >
                {label} {counts[key] > 0 && <span className="ml-1 opacity-70">{counts[key]}</span>}
              </button>
            ))}
          </div>
        )}

        {/* Content */}
        <div className="min-h-[120px] max-h-[60vh] overflow-y-auto space-y-3">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm">Loading claim relations...</span>
            </div>
          ) : relations.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <Scale className="h-8 w-8 text-muted-foreground/40" />
              <div>
                <p className="text-sm text-muted-foreground">No claim relations found.</p>
                <p className="text-xs text-muted-foreground/60 mt-1">
                  Run "Find Related Papers" to discover claim connections.
                </p>
              </div>
              <Button variant="outline" size="sm" className="gap-2" onClick={handleFindRelated}>
                Find Related Papers
              </Button>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex items-center justify-center py-12">
              <p className="text-sm text-muted-foreground">No {filter} relations for this paper.</p>
            </div>
          ) : (
            filtered.map((rel) => {
              const style = RELATION_STYLES[rel.relationType] ?? RELATION_STYLES.supports;
              const Icon = style.icon;
              // Determine which side is "this paper" and which is "other"
              const isSource = entryId === rel.sourceEntryId;
              const thisClaim = isSource ? rel.sourceStatement : rel.targetStatement;
              const otherClaim = isSource ? rel.targetStatement : rel.sourceStatement;
              const otherTitle = isSource ? rel.targetEntryTitle : rel.sourceEntryTitle;
              const otherEntryId = isSource ? rel.targetEntryId : rel.sourceEntryId;
              const hasReasoning = !!rel.reasoning;
              const isExpanded = expandedReasoning.has(rel.relationId);

              return (
                <div
                  key={rel.relationId}
                  className="rounded-lg border bg-card p-3 space-y-2"
                >
                  {/* Header: type badge + confidence */}
                  <div className="flex items-center gap-2">
                    <Icon className={cn('h-3.5 w-3.5', style.color)} />
                    <span className={cn('text-xs font-semibold uppercase', style.color)}>
                      {style.label}
                    </span>
                    <span className="text-[10px] text-muted-foreground/60">
                      {(rel.confidence * 100).toFixed(0)}%
                    </span>
                  </div>

                  {/* This paper's claim */}
                  <p className="text-sm leading-relaxed">
                    "{thisClaim}"
                  </p>

                  {/* Separator */}
                  <div className="flex items-center gap-2 text-muted-foreground/40">
                    <div className="flex-1 border-t" />
                    <span className="text-[10px]">vs</span>
                    <div className="flex-1 border-t" />
                  </div>

                  {/* Other paper's claim */}
                  <p className="text-sm leading-relaxed">
                    "{otherClaim}"
                  </p>

                  {/* Other paper link */}
                  <div className="flex items-center justify-between">
                    <button
                      className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1 min-w-0"
                      onClick={() => handleOpenPaper(otherEntryId, otherTitle)}
                      title={otherTitle}
                    >
                      <ExternalLink className="h-3 w-3 flex-shrink-0" />
                      <span className="truncate max-w-[350px]">{otherTitle}</span>
                    </button>

                    {/* Reasoning toggle */}
                    {hasReasoning && (
                      <button
                        className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-0.5 flex-shrink-0"
                        onClick={() => toggleReasoning(rel.relationId)}
                      >
                        {isExpanded ? (
                          <ChevronDown className="h-3 w-3" />
                        ) : (
                          <ChevronRight className="h-3 w-3" />
                        )}
                        Reasoning
                      </button>
                    )}
                  </div>

                  {/* Expanded reasoning */}
                  {hasReasoning && isExpanded && (
                    <p className="text-xs text-muted-foreground bg-muted/50 rounded p-2 leading-relaxed">
                      {rel.reasoning}
                    </p>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        {!loading && relations.length > 0 && (
          <div className="flex-shrink-0 pt-2 border-t">
            <p className="text-xs text-muted-foreground">
              {relations.length} relation{relations.length !== 1 ? 's' : ''}
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
