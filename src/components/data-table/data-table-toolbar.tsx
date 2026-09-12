import type { Table } from "@tanstack/react-table";
import { X } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { DataTableViewOptions } from "./data-table-view-options";

interface DataTableToolbarProps<TData> {
  table: Table<TData>;
  searchColumnId?: string;
  searchPlaceholder?: string;
  viewOptionsLabel?: string;
  /** Use table-wide search instead of a single column. */
  globalSearch?: boolean;
  children?: ReactNode;
}

export function DataTableToolbar<TData>({
  table,
  searchColumnId,
  searchPlaceholder = "搜索…",
  globalSearch = false,
  viewOptionsLabel,
  children,
}: DataTableToolbarProps<TData>) {
  const searchColumn = !globalSearch && searchColumnId ? table.getColumn(searchColumnId) : undefined;
  const isFiltered = table.getState().columnFilters.length > 0 || Boolean(table.getState().globalFilter);

  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex flex-1 flex-wrap items-center gap-2">
        {globalSearch ? (
          <Input
            value={String(table.getState().globalFilter ?? "")}
            onChange={(event) => table.setGlobalFilter(event.target.value)}
            placeholder={searchPlaceholder}
            className="h-8 w-full max-w-64"
          />
        ) : searchColumn ? (
          <Input
            value={(searchColumn.getFilterValue() as string) ?? ""}
            onChange={(event) => searchColumn.setFilterValue(event.target.value)}
            placeholder={searchPlaceholder}
            className="h-8 w-full max-w-56"
          />
        ) : null}
        {children}
        {isFiltered ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-1 px-2 text-xs"
            onClick={() => {
              table.resetColumnFilters();
              table.setGlobalFilter("");
            }}
          >
            清除筛选
            <X className="size-3.5" />
          </Button>
        ) : null}
      </div>
      <DataTableViewOptions table={table} label={viewOptionsLabel} />
    </div>
  );
}
