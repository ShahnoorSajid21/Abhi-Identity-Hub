import { useMemo, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, ChevronsUpDown, Download } from 'lucide-react';
import type { EmptyStateCopy } from '../copy/strings.ts';
import { ACTIONS } from '../copy/strings.ts';
import { EmptyState } from './EmptyState.tsx';
import { SkeletonRows } from './LoadingSkeleton.tsx';

/**
 * The table.
 *
 * Dense 44px rows, sticky header, 1px dividers rather than zebra striping,
 * sortable columns, click-through to a detail screen, and CSV export in the
 * header. This is the component that most establishes "this is real software",
 * so its behaviour has to be unremarkable in the way real software is.
 */

export interface Column<Row> {
  key: string;
  header: string;
  /** What the cell shows. */
  render: (row: Row) => ReactNode;
  /** Sort key and CSV value. Omit to make the column unsortable and unexported. */
  value?: (row: Row) => string | number | null;
  align?: 'left' | 'right';
  width?: string;
}

export interface DataTableProps<Row> {
  rows: Row[];
  columns: Column<Row>[];
  rowKey: (row: Row) => string;
  loading?: boolean;
  /** Shown when there are no rows at all. */
  empty: EmptyStateCopy;
  onEmptyAction?: () => void;
  onRowClick?: (row: Row) => void;
  /** Filename stem for the CSV export. Omit to hide the export control. */
  exportName?: string;
  caption?: ReactNode;
  pageSizes?: number[];
}

function toCsvCell(value: string | number | null): string {
  if (value === null) return '';
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function DataTable<Row>({
  rows,
  columns,
  rowKey,
  loading = false,
  empty,
  onEmptyAction,
  onRowClick,
  exportName,
  caption,
  pageSizes = [25, 50, 100],
}: DataTableProps<Row>) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [pageSize, setPageSize] = useState(pageSizes[0] ?? 25);
  const [page, setPage] = useState(0);

  const sorted = useMemo(() => {
    if (sortKey === null) return rows;
    const column = columns.find((c) => c.key === sortKey);
    if (column?.value === undefined) return rows;
    const read = column.value;

    return [...rows].sort((a, b) => {
      const av = read(a);
      const bv = read(b);
      if (av === null && bv === null) return 0;
      // Unknown values sort last regardless of direction — a blank is not
      // "smallest", it is absent, and burying it keeps the top of the table
      // meaningful.
      if (av === null) return 1;
      if (bv === null) return -1;
      const result =
        typeof av === 'number' && typeof bv === 'number'
          ? av - bv
          : String(av).localeCompare(String(bv), 'en-GB');
      return sortDir === 'asc' ? result : -result;
    });
  }, [rows, columns, sortKey, sortDir]);

  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize));
  const currentPage = Math.min(page, pageCount - 1);
  const visible = sorted.slice(currentPage * pageSize, currentPage * pageSize + pageSize);

  function toggleSort(key: string) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
    setPage(0);
  }

  function exportCsv() {
    const exportable = columns.filter((c) => c.value !== undefined);
    const header = exportable.map((c) => toCsvCell(c.header)).join(',');
    const body = sorted
      .map((row) => exportable.map((c) => toCsvCell(c.value!(row))).join(','))
      .join('\n');

    const blob = new Blob([`${header}\n${body}\n`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${exportName}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="card overflow-hidden">
      {(caption !== undefined || exportName !== undefined) && (
        <div className="flex items-center justify-between gap-4 border-b border-ink-200 px-4 py-3">
          <div className="text-cell text-ink-500">{caption}</div>
          {exportName !== undefined && rows.length > 0 && (
            <button
              type="button"
              onClick={exportCsv}
              className="inline-flex items-center gap-2 rounded-control border border-ink-200 px-3 py-1.5 text-cell font-medium text-ink-700 transition-colors duration-fast hover:bg-ink-100"
            >
              <Download size={14} />
              {ACTIONS.exportCsv}
            </button>
          )}
        </div>
      )}

      {loading ? (
        <SkeletonRows rows={8} columns={columns.length} />
      ) : rows.length === 0 ? (
        <EmptyState copy={empty} onAction={onEmptyAction} />
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead className="sticky top-topbar z-10 bg-ink-50">
                <tr>
                  {columns.map((column) => (
                    <th
                      key={column.key}
                      scope="col"
                      style={column.width !== undefined ? { width: column.width } : undefined}
                      className={`border-b border-ink-200 px-4 py-2.5 text-caption font-semibold uppercase tracking-wide text-ink-500 ${
                        column.align === 'right' ? 'text-right' : 'text-left'
                      }`}
                    >
                      {column.value === undefined ? (
                        column.header
                      ) : (
                        <button
                          type="button"
                          onClick={() => toggleSort(column.key)}
                          className={`inline-flex items-center gap-1 transition-colors duration-fast hover:text-ink-900 ${
                            column.align === 'right' ? 'flex-row-reverse' : ''
                          }`}
                        >
                          {column.header}
                          {sortKey === column.key ? (
                            sortDir === 'asc' ? (
                              <ArrowUp size={12} />
                            ) : (
                              <ArrowDown size={12} />
                            )
                          ) : (
                            <ChevronsUpDown size={12} className="opacity-40" />
                          )}
                        </button>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => (
                  <tr
                    key={rowKey(row)}
                    onClick={onRowClick === undefined ? undefined : () => onRowClick(row)}
                    className={`border-b border-ink-100 transition-colors duration-fast ${
                      onRowClick === undefined ? '' : 'cursor-pointer hover:bg-ink-50'
                    }`}
                  >
                    {columns.map((column) => (
                      <td
                        key={column.key}
                        className={`h-11 px-4 text-cell text-ink-900 ${
                          column.align === 'right' ? 'text-right' : 'text-left'
                        }`}
                      >
                        {column.render(row)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-4 border-t border-ink-200 px-4 py-3">
            <span className="tabular text-cell text-ink-500">
              {currentPage * pageSize + 1}–{Math.min(sorted.length, (currentPage + 1) * pageSize)} of{' '}
              {sorted.length.toLocaleString('en-PK')}
            </span>

            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 text-cell text-ink-500">
                Rows
                <select
                  value={pageSize}
                  onChange={(e) => {
                    setPageSize(Number(e.target.value));
                    setPage(0);
                  }}
                  className="rounded-control border border-ink-200 bg-white px-2 py-1 text-cell text-ink-900"
                >
                  {pageSizes.map((size) => (
                    <option key={size} value={size}>
                      {size}
                    </option>
                  ))}
                </select>
              </label>

              <div className="flex items-center gap-1">
                <button
                  type="button"
                  disabled={currentPage === 0}
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  className="rounded-control border border-ink-200 px-3 py-1 text-cell text-ink-700 transition-colors duration-fast hover:bg-ink-100 disabled:opacity-40 disabled:hover:bg-transparent"
                >
                  Previous
                </button>
                <button
                  type="button"
                  disabled={currentPage >= pageCount - 1}
                  onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                  className="rounded-control border border-ink-200 px-3 py-1 text-cell text-ink-700 transition-colors duration-fast hover:bg-ink-100 disabled:opacity-40 disabled:hover:bg-transparent"
                >
                  Next
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
