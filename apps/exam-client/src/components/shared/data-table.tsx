"use client";

import * as React from "react";
import {
  type Column,
  type ColumnDef,
  type OnChangeFn,
  type PaginationState,
  type SortingState,
  type VisibilityState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import {
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ChevronsUpDown,
  CircleAlert,
  Download,
  Inbox,
  RotateCcw,
  Search,
  Settings2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export interface DataTableFilterProps {
  label: string;
  children: React.ReactNode;
  className?: string;
}

/**
 * DataTableFilter — standard wrapper for a toolbar facet dropdown.
 * Renders the label on top with the selector below, so every filter
 * in the toolbar shares the same stacked layout.
 */
export function DataTableFilter({ label, children, className }: DataTableFilterProps) {
  return (
    <div className={className ?? "min-w-[10rem]"}>
      <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      {children}
    </div>
  );
}

export interface DataTableProps<TData extends object, TValue> {
  title: string;
  description?: string;
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
  /** Shows skeleton rows inside the table body while data is being fetched. */
  loading?: boolean;
  /** Displays an error state inside the table body when data could not load. */
  error?: string | null;
  /** Optional callback rendered as a "Try again" button next to the error. */
  onRetry?: () => void;
  /** Message shown when the table has no rows. */
  emptyMessage?: string;
  exportLabel?: string;
  onExport?: () => void;
  searchPlaceholder?: string;
  /** Label rendered on top of the search bar. Defaults to "Search". */
  searchLabel?: string;
  filters?: React.ReactNode;
  /** Extra actions rendered in table header, left of Export (e.g. Re-entry Requests) */
  headerActions?: React.ReactNode;
  /** Server-side pagination + filtering flags/controls. */
  manualPagination?: boolean;
  manualFiltering?: boolean;
  pageCount?: number;
  rowCount?: number;
  pagination?: PaginationState;
  onPaginationChange?: OnChangeFn<PaginationState>;
  globalFilter?: string;
  onGlobalFilterChange?: OnChangeFn<string>;
}

function getColumnLabel<TData, TValue>(column: Column<TData, TValue>): string {
  const header = column.columnDef.header;
  if (typeof header === "string") return header;
  return column.id
    .replace(/[_-]/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function isEmptyCellContent(node: unknown): boolean {
  if (node == null || node === false) return true;
  if (typeof node === "string") {
    const t = node.trim();
    if (t === "") return true;
    const lower = t.toLowerCase();
    // Treat common placeholder strings as empty so they render as "--"
    if (
      lower === "n/a" ||
      lower === "na" ||
      lower === "n / a" ||
      lower === "not configured" ||
      lower === "-" ||
      lower === "--" ||
      lower === "—" ||
      lower === "–" ||
      lower === "nil" ||
      lower === "null" ||
      lower === "undefined" ||
      lower === "unknown"
    )
      return true;
    return false;
  }
  if (typeof node === "number") return Number.isNaN(node);
  if (Array.isArray(node)) {
    return node.length === 0 || node.every(isEmptyCellContent);
  }
  if (React.isValidElement(node)) {
    const element = node as React.ReactElement<{ children?: unknown }>;
    // Fragment is transparent — check its children
    if (element.type === React.Fragment) {
      return isEmptyCellContent(element.props.children);
    }
    // Only inspect native DOM elements; custom components (Badge, etc.) are treated as non-empty
    if (typeof element.type === "string") {
      return isEmptyCellContent(element.props.children);
    }
    return false;
  }
  return false;
}

function DataTableColumnHeader<TData, TValue>({
  column,
  title,
}: {
  column: Column<TData, TValue>;
  title: string;
}) {
  if (!column.getCanSort()) {
    return <span className="block w-full text-center font-semibold text-white text-sm tracking-wide">{title}</span>;
  }

  const sorted = column.getIsSorted();

  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-8 w-full justify-center gap-1.5 rounded-none border-0 px-2 text-sm font-semibold tracking-wide text-white hover:bg-white/10 hover:text-white"
      onClick={() => column.toggleSorting(sorted === "asc")}
    >
      <span className="text-center">{title}</span>
      {sorted === "asc" ? (
        <ArrowUp className="size-3.5" />
      ) : sorted === "desc" ? (
        <ArrowDown className="size-3.5" />
      ) : (
        <ChevronsUpDown className="size-3.5 opacity-60" />
      )}
    </Button>
  );
}

function createExportCsv<TData extends object, TValue>(
  title: string,
  columns: ColumnDef<TData, TValue>[],
  rows: TData[]
): void {
  const exportable = columns.filter(
    (column): column is ColumnDef<TData, TValue> & { accessorKey: string } =>
      typeof (column as { accessorKey?: unknown }).accessorKey === "string"
  );
  if (exportable.length === 0) return;

  const header = exportable
    .map((column) =>
      typeof column.header === "string" ? column.header : column.id
    )
    .join(",");
  const body = rows.map((row) =>
    exportable
      .map((column) => {
        const value = column.accessorKey
          .split(".")
          .reduce<unknown>(
            (acc, part) => (acc as Record<string, unknown> | null)?.[part],
            row
          );
        return `"${String(value ?? "").replace(/"/g, '""')}"`;
      })
      .join(",")
  );
  const csv = [header, ...body].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${title.toLowerCase().replace(/\s+/g, "-")}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function DataTable<TData extends object, TValue>({
  title,
  description,
  columns,
  data,
  loading = false,
  error = null,
  onRetry,
  emptyMessage = "No records found",
  exportLabel = "Export",
  onExport,
  searchPlaceholder = "Search...",
  searchLabel = "Search",
  filters,
  headerActions,
  manualPagination = false,
  manualFiltering = false,
  pageCount,
  rowCount,
  pagination: paginationProp,
  onPaginationChange: onPaginationChangeProp,
  globalFilter: globalFilterProp,
  onGlobalFilterChange: onGlobalFilterChangeProp,
}: DataTableProps<TData, TValue>) {
  const [sorting, setSorting] = React.useState<SortingState>([]);
  const [columnVisibility, setColumnVisibility] = React.useState<
    VisibilityState
  >({});
  const [internalPagination, setInternalPagination] =
    React.useState<PaginationState>({ pageIndex: 0, pageSize: 10 });
  const [internalGlobalFilter, setInternalGlobalFilter] = React.useState("");

  const pagination = paginationProp ?? internalPagination;
  const onPaginationChange = onPaginationChangeProp ?? setInternalPagination;
  const globalFilter = globalFilterProp ?? internalGlobalFilter;
  const onGlobalFilterChange =
    onGlobalFilterChangeProp ?? setInternalGlobalFilter;

  const table = useReactTable({
    data,
    columns,
    manualPagination,
    manualFiltering,
    pageCount: manualPagination ? pageCount : undefined,
    state: {
      sorting,
      columnVisibility,
      globalFilter,
      pagination,
    },
    onSortingChange: setSorting,
    onColumnVisibilityChange: setColumnVisibility,
    onGlobalFilterChange,
    onPaginationChange,
    getCoreRowModel: getCoreRowModel(),
    ...(manualFiltering ? {} : { getFilteredRowModel: getFilteredRowModel() }),
    ...(manualPagination
      ? {}
      : { getPaginationRowModel: getPaginationRowModel() }),
    getSortedRowModel: getSortedRowModel(),
  });

  const handleExport = () => {
    if (onExport) {
      onExport();
      return;
    }
    const rows = table.getFilteredRowModel().rows.map((row) => row.original);
    createExportCsv(title, columns, rows);
  };

  const { pageIndex, pageSize } = pagination;
  const totalRows = manualPagination
    ? rowCount ?? 0
    : table.getFilteredRowModel().rows.length;
  const pageCountValue = manualPagination
    ? Math.max(1, pageCount ?? 1)
    : table.getPageCount();
  const rangeStart = totalRows === 0 ? 0 : pageIndex * pageSize + 1;
  const rangeEnd = Math.min(totalRows, (pageIndex + 1) * pageSize);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
          <div>
            <CardTitle>{title}</CardTitle>
            {description ? <CardDescription>{description}</CardDescription> : null}
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-40 sm:w-56">
              {searchLabel ? (
                <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {searchLabel}
                </span>
              ) : null}
              <div className="relative">
                <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={globalFilter ?? ""}
                  onChange={(event) => table.setGlobalFilter(event.target.value)}
                  placeholder={searchPlaceholder}
                  className="pl-8"
                />
              </div>
            </div>
            {filters}
            <div className="flex items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button variant="outline" size="default">
                    <Settings2 />
                    View
                  </Button>
                }
              >
                <span className="sr-only">Toggle columns</span>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuGroup>
                  <DropdownMenuLabel>Columns</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {table
                    .getAllColumns()
                    .filter((column) => column.getCanHide())
                    .map((column) => (
                      <DropdownMenuCheckboxItem
                        key={column.id}
                        checked={column.getIsVisible()}
                        onCheckedChange={(value) =>
                          column.toggleVisibility(!!value)
                        }
                      >
                        {getColumnLabel(column)}
                      </DropdownMenuCheckboxItem>
                    ))}
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            {headerActions}
            <Button variant="outline" size="default" onClick={handleExport}>
              <Download />
              {exportLabel}
            </Button>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="px-0 pb-0">
        <div className="mx-(--card-spacing) overflow-x-auto overflow-hidden rounded-md border border-sky-100">
          <Table>
            <TableHeader className="bg-gradient-to-br from-indigo-950 via-slate-900 to-slate-950 [&_tr]:bg-transparent [&_tr]:border-b-0">
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow key={headerGroup.id} className="border-b-0 hover:bg-transparent">
                  {headerGroup.headers.map((header) => (
                    <TableHead key={header.id} className="h-11 border-l border-white/10 px-2 py-2 text-center align-middle first:border-l-0">
                      {header.isPlaceholder ? null : typeof header.column
                          .columnDef.header === "function" ? (
                        <div className="flex justify-center text-center text-white [&_span]:text-white [&_button]:text-white">
                          {flexRender(
                            header.column.columnDef.header,
                            header.getContext()
                          )}
                        </div>
                      ) : (
                        <DataTableColumnHeader
                          column={header.column}
                          title={getColumnLabel(header.column)}
                        />
                      )}
                    </TableHead>
                  ))}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 5 }).map((_, rowIndex) => (
                  <TableRow key={`loading-${rowIndex}`} className={rowIndex % 2 === 0 ? "bg-white hover:bg-white border-b border-sky-100/60" : "bg-sky-50/50 hover:bg-sky-50/70 border-b border-sky-100/60"}>
                    {columns.map((_, columnIndex) => (
                      <TableCell key={`loading-${rowIndex}-${columnIndex}`} className="border-l border-sky-100/60 px-2 py-2.5 text-center align-middle first:border-l-0">
                        <Skeleton className="mx-auto h-4 w-full max-w-32" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : error ? (
                <TableRow className="bg-white hover:bg-white border-b border-sky-100/60">
                  <TableCell colSpan={columns.length} className="h-32 border-l-0 px-2 py-2.5 text-center align-middle">
                    <div className="flex flex-col items-center justify-center gap-2">
                      <CircleAlert className="size-6 text-destructive" />
                      <p className="text-sm font-medium text-destructive">
                        {error}
                      </p>
                      {onRetry ? (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={onRetry}
                          className="mt-1"
                        >
                          <RotateCcw />
                          Try again
                        </Button>
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              ) : table.getRowModel().rows.length ? (
                table.getRowModel().rows.map((row, rowIndex) => (
                  <TableRow key={row.id} className={rowIndex % 2 === 0 ? "bg-white hover:bg-sky-50/80 border-b border-sky-100/60 transition-colors" : "bg-sky-50/50 hover:bg-sky-100/60 border-b border-sky-100/60 transition-colors"}>
                    {row.getVisibleCells().map((cell) => {
                      const rendered = flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext()
                      );
                      const isEmpty = isEmptyCellContent(rendered);
                      return (
                        <TableCell key={cell.id} className="border-l border-sky-100/60 px-2 py-2.5 text-center align-middle text-sm first:border-l-0 [&_div]:mx-auto [&_div]:text-center [&_span]:text-center">
                          <div className="flex w-full justify-center text-center">
                            {isEmpty ? <span className="text-muted-foreground">--</span> : rendered}
                          </div>
                        </TableCell>
                      );
                    })}
                  </TableRow>
                ))
              ) : (
                <TableRow className="bg-white hover:bg-white border-b border-sky-100/60">
                  <TableCell
                    colSpan={columns.length}
                    className="h-24 border-l-0 px-2 py-2.5 text-center align-middle text-muted-foreground"
                  >
                    <div className="flex flex-col items-center justify-center gap-2">
                      <Inbox className="size-6" />
                      {emptyMessage}
                    </div>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 px-(--card-spacing) pt-3">
          <div className="text-sm text-muted-foreground">
            Showing{" "}
            <span className="font-medium text-foreground">{rangeStart}</span>
            {"\u2013"}
            {rangeEnd} of{" "}
            <span className="font-medium text-foreground">{totalRows}</span>{" "}
            entries
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              Rows per page
              <Select
                value={`${pageSize}`}
                onValueChange={(value) => table.setPageSize(Number(value))}
              >
                <SelectTrigger className="w-16 px-2">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent side="top" align="end">
                  {[10, 20, 25, 30, 40, 50].map((size) => (
                    <SelectItem key={size} value={`${size}`}>
                      {size}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="icon"
                className="size-8"
                onClick={() => table.setPageIndex(0)}
                disabled={!table.getCanPreviousPage()}
              >
                <span className="sr-only">First page</span>
                <ChevronsLeft />
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="size-8"
                onClick={() => table.previousPage()}
                disabled={!table.getCanPreviousPage()}
              >
                <span className="sr-only">Previous page</span>
                <ChevronLeft />
              </Button>
              <span className="px-2 text-sm tabular-nums text-muted-foreground">
                Page {pageIndex + 1} of {pageCountValue}
              </span>
              <Button
                variant="outline"
                size="icon"
                className="size-8"
                onClick={() => table.nextPage()}
                disabled={!table.getCanNextPage()}
              >
                <span className="sr-only">Next page</span>
                <ChevronRight />
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="size-8"
                onClick={() => table.setPageIndex(pageCountValue - 1)}
                disabled={!table.getCanNextPage()}
              >
                <span className="sr-only">Last page</span>
                <ChevronsRight />
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default DataTable;
