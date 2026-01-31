import { Fragment } from "react";
import { ChevronDown, ChevronRight, ArrowUp, ArrowDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SortField, SortDirection } from "@/stores/uiStore";

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
  selectedIds?: string[];
  expandedIds?: string[];
  sortField?: SortField;
  sortDirection?: SortDirection;
  onSort?: (field: SortField) => void;
  onRowClick?: (row: TData, event: React.MouseEvent) => void;
  onRowDoubleClick?: (row: TData) => void;
  onRowContextMenu?: (row: TData, event: React.MouseEvent) => void;
  onToggleExpand?: (id: string) => void;
  getRowId: (row: TData) => string;
  renderSubRow?: (row: TData) => React.ReactNode;
  hasExpandableRows?: (row: TData) => boolean;
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
}: DataTableProps<TData>) {
  return (
    <div className="h-full overflow-auto">
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

            return (
              <Fragment key={rowId}>
                <tr
                  data-state={isSelected ? "selected" : undefined}
                  className={cn(
                    "cursor-pointer transition-colors border-b h-8 select-none",
                    "hover:bg-accent/50",
                    isSelected && "bg-accent"
                  )}
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
                </tr>
                {isExpanded && renderSubRow?.(row)}
              </Fragment>
            );
          })}
        </tbody>
      </table>

      {data.length === 0 && (
        <div className="flex items-center justify-center h-24 text-muted-foreground text-sm">
          No results.
        </div>
      )}
    </div>
  );
}
