import { Fragment, useRef, useEffect, useCallback } from "react";
import { ChevronDown, ChevronRight, ArrowUp, ArrowDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SortField, SortDirection } from "@/stores/uiStore";
import { DraggableTableRow } from "@/components/dnd/DraggableTableRow";

export interface Column<TData> {
  id: string;
  header: string;
  width: number;
  cell: (row: TData) => React.ReactNode;
  sortable?: boolean;
}

interface DataTableProps<TData> {
  columns: Column<TData>[];
  data: TData[];
  selectedIds?: number[];
  expandedIds?: number[];
  sortField?: SortField;
  sortDirection?: SortDirection;
  onSort?: (field: SortField) => void;
  onRowClick?: (row: TData, event: React.MouseEvent) => void;
  onRowDoubleClick?: (row: TData) => void;
  onRowContextMenu?: (row: TData, event: React.MouseEvent) => void;
  onToggleExpand?: (id: number) => void;
  getRowId: (row: TData) => number;
  renderSubRow?: (row: TData) => React.ReactNode;
  hasExpandableRows?: (row: TData) => boolean;
  /** Callback when keyboard navigation selects a row */
  onKeyboardSelect?: (row: TData) => void;
  /** Enable drag and drop functionality */
  isDragEnabled?: boolean;
  /** Get drag data for a row. Receives the row and selected rows if dragging a selected row */
  getDragData?: (row: TData, selectedRows: TData[]) => Record<string, unknown>;
  /** Called when scrolling near the end of the list */
  onEndReached?: () => void;
  endReachedThreshold?: number;
  hasMore?: boolean;
  isLoadingMore?: boolean;
  /** Forces a fill-viewport check when this value changes */
  autoLoadKey?: string;
}

export function DataTable<TData>({
  columns,
  data,
  selectedIds = [],
  expandedIds = [],
  sortField,
  sortDirection,
  onSort,
  onRowClick,
  onRowDoubleClick,
  onRowContextMenu,
  onToggleExpand,
  getRowId,
  renderSubRow,
  hasExpandableRows,
  onKeyboardSelect,
  isDragEnabled = false,
  getDragData,
  onEndReached,
  endReachedThreshold = 200,
  hasMore = false,
  isLoadingMore = false,
  autoLoadKey,
}: DataTableProps<TData>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef<Map<number, HTMLTableRowElement>>(new Map());

  const handleScroll = useCallback(
    (event: React.UIEvent<HTMLDivElement>) => {
      if (!onEndReached || !hasMore || isLoadingMore) return;
      const el = event.currentTarget;
      if (el.scrollTop + el.clientHeight >= el.scrollHeight - endReachedThreshold) {
        onEndReached();
      }
    },
    [onEndReached, hasMore, isLoadingMore, endReachedThreshold],
  );

  const maybeLoadMore = useCallback(() => {
    if (!onEndReached || !hasMore || isLoadingMore) return;
    const el = containerRef.current;
    if (!el) return;
    if (el.scrollHeight <= el.clientHeight + endReachedThreshold) {
      onEndReached();
    }
  }, [onEndReached, hasMore, isLoadingMore, endReachedThreshold]);

  // Find current focused row index based on selection
  const getFocusedIndex = useCallback(() => {
    if (selectedIds.length === 0) return -1;
    const lastSelectedId = selectedIds[selectedIds.length - 1];
    return data.findIndex((row) => getRowId(row) === lastSelectedId);
  }, [selectedIds, data, getRowId]);

  // Scroll row into view
  const scrollRowIntoView = useCallback((rowId: number) => {
    const rowElement = rowRefs.current.get(rowId);
    if (rowElement) {
      rowElement.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, []);

  // Handle keyboard navigation
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (data.length === 0) return;

      const currentIndex = getFocusedIndex();

      switch (event.key) {
        case "ArrowDown": {
          event.preventDefault();
          const nextIndex = currentIndex < data.length - 1 ? currentIndex + 1 : currentIndex;
          if (nextIndex !== currentIndex || currentIndex === -1) {
            const targetIndex = currentIndex === -1 ? 0 : nextIndex;
            const row = data[targetIndex];
            if (row) {
              onKeyboardSelect?.(row);
              scrollRowIntoView(getRowId(row));
            }
          }
          break;
        }
        case "ArrowUp": {
          event.preventDefault();
          const prevIndex = currentIndex > 0 ? currentIndex - 1 : 0;
          if (prevIndex !== currentIndex || currentIndex === -1) {
            const targetIndex = currentIndex === -1 ? 0 : prevIndex;
            const row = data[targetIndex];
            if (row) {
              onKeyboardSelect?.(row);
              scrollRowIntoView(getRowId(row));
            }
          }
          break;
        }
        case "Enter": {
          event.preventDefault();
          if (currentIndex >= 0) {
            const row = data[currentIndex];
            if (row) {
              onRowDoubleClick?.(row);
            }
          }
          break;
        }
        case " ": {
          // Space toggles expand/collapse
          event.preventDefault();
          if (currentIndex >= 0 && onToggleExpand) {
            const row = data[currentIndex];
            if (row) {
              const canExpand = hasExpandableRows ? hasExpandableRows(row) : !!renderSubRow;
              if (canExpand) {
                onToggleExpand(getRowId(row));
              }
            }
          }
          break;
        }
        case "Home": {
          event.preventDefault();
          if (data.length > 0) {
            const row = data[0];
            if (row) {
              onKeyboardSelect?.(row);
              scrollRowIntoView(getRowId(row));
            }
          }
          break;
        }
        case "End": {
          event.preventDefault();
          if (data.length > 0) {
            const row = data[data.length - 1];
            if (row) {
              onKeyboardSelect?.(row);
              scrollRowIntoView(getRowId(row));
            }
          }
          break;
        }
      }
    },
    [data, getFocusedIndex, getRowId, onKeyboardSelect, onRowDoubleClick, onToggleExpand, hasExpandableRows, renderSubRow, scrollRowIntoView]
  );

  // Auto-focus container when selection changes via click
  useEffect(() => {
    if (selectedIds.length > 0 && containerRef.current) {
      // Focus only if not already focused within
      if (!containerRef.current.contains(document.activeElement)) {
        containerRef.current.focus();
      }
    }
  }, [selectedIds]);

  useEffect(() => {
    maybeLoadMore();
  }, [data.length, maybeLoadMore]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      maybeLoadMore();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [maybeLoadMore]);

  useEffect(() => {
    maybeLoadMore();
  }, [sortField, sortDirection, data.length, autoLoadKey, maybeLoadMore]);

  return (
    <div
      ref={containerRef}
      className="h-full overflow-auto focus:outline-none"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onScroll={handleScroll}
    >
      <table className="w-full border-collapse table-fixed min-w-full">
        {/* Column sizing */}
        <colgroup>
          {onToggleExpand && <col style={{ width: 32 }} />}
          {columns.map((column) => (
            <col key={column.id} style={{ width: column.width }} />
          ))}
        </colgroup>

        {/* Header */}
        <thead className="sticky top-0 z-10 bg-muted/80 backdrop-blur-sm border-b">
          <tr>
            {onToggleExpand && <th className="w-8 px-2 h-8" />}
            {columns.map((column) => {
              const isSorted = sortField === column.id;
              const canSort = column.sortable !== false && onSort;

              return (
                <th
                  key={column.id}
                  className={cn(
                    "h-8 px-2 text-left text-xs font-medium text-muted-foreground truncate",
                    canSort && "cursor-pointer hover:text-foreground select-none"
                  )}
                  onClick={() => canSort && onSort(column.id as SortField)}
                >
                  <div className="flex items-center gap-1">
                    <span className="truncate">{column.header}</span>
                    {isSorted && (
                      sortDirection === "asc" ? (
                        <ArrowUp className="h-3 w-3 flex-shrink-0" />
                      ) : (
                        <ArrowDown className="h-3 w-3 flex-shrink-0" />
                      )
                    )}
                  </div>
                </th>
              );
            })}
          </tr>
        </thead>

        {/* Body */}
        <tbody>
          {data.map((row) => {
            const rowId = getRowId(row);
            const isSelected = selectedIds.includes(rowId);
            const isExpanded = expandedIds.includes(rowId);
            const canExpand = hasExpandableRows ? hasExpandableRows(row) : !!renderSubRow;

            // Determine which rows to include in drag
            // If this row is selected, drag all selected rows; otherwise just this row
            const selectedRows = isSelected
              ? data.filter((r) => selectedIds.includes(getRowId(r)))
              : [row];

            const rowClassName = cn(
              "cursor-pointer transition-colors border-b h-8 select-none",
              "hover:bg-accent/50",
              isSelected && "bg-accent"
            );

            const rowContent = (
              <>
                {/* Expand toggle */}
                {onToggleExpand && (
                  <td
                    className="w-8 px-2 text-center"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (canExpand) onToggleExpand(rowId);
                    }}
                  >
                    {canExpand && (
                      isExpanded ? (
                        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground inline" />
                      ) : (
                        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground inline" />
                      )
                    )}
                  </td>
                )}
                {columns.map((column) => (
                  <td
                    key={column.id}
                    className="py-1.5 px-2 truncate text-sm"
                    style={{ maxWidth: column.width }}
                  >
                    {column.cell(row)}
                  </td>
                ))}
              </>
            );

            const handleRowRef = (el: HTMLTableRowElement | null) => {
              if (el) {
                rowRefs.current.set(rowId, el);
              } else {
                rowRefs.current.delete(rowId);
              }
            };

            return (
              <Fragment key={rowId}>
                {isDragEnabled && getDragData ? (
                  <DraggableTableRow
                    dragId={`entry-${rowId}`}
                    dragData={getDragData(row, selectedRows)}
                    disabled={false}
                    className={rowClassName}
                    dataState={isSelected ? "selected" : undefined}
                    rowRef={handleRowRef}
                    onClick={(e) => onRowClick?.(row, e)}
                    onDoubleClick={(e) => {
                      e.preventDefault();
                      onRowDoubleClick?.(row);
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      onRowContextMenu?.(row, e);
                    }}
                  >
                    {rowContent}
                  </DraggableTableRow>
                ) : (
                  <tr
                    ref={handleRowRef}
                    data-state={isSelected ? "selected" : undefined}
                    className={rowClassName}
                    onClick={(e) => onRowClick?.(row, e)}
                    onDoubleClick={(e) => {
                      e.preventDefault();
                      onRowDoubleClick?.(row);
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      onRowContextMenu?.(row, e);
                    }}
                  >
                    {rowContent}
                  </tr>
                )}
                {isExpanded && renderSubRow?.(row)}
              </Fragment>
            );
          })}
        </tbody>
      </table>

      {data.length === 0 && (
        <div className="flex items-center justify-center h-24 text-muted-foreground text-sm">
          No items to display
        </div>
      )}
    </div>
  );
}
