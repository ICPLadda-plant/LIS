import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '@/lib/api';
import { formatDensity3 } from '@/lib/densitySync';
import { formatDateTime } from '@/lib/dateTime';
import { Gauge, RefreshCw, ChevronLeft, ChevronRight, Search, X } from 'lucide-react';
import AppLayout from '@/components/lis/AppLayout';

const LIMIT = 100;

function statusBadge(status: string) {
  if (!status) return null;
  const isValid = String(status).toLowerCase() === 'valid';
  return (
    <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${
      isValid
        ? 'border-green-200 bg-green-50 text-green-700 dark:border-green-500/30 dark:bg-green-500/15 dark:text-green-300'
        : 'border-red-200 bg-red-50 text-red-700 dark:border-red-500/30 dark:bg-red-500/15 dark:text-red-300'
    }`}>
      {status}
    </span>
  );
}

export default function DensityResultPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [product, setProduct] = useState('');
  const [date, setDate] = useState('');
  const [status, setStatus] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [appliedProduct, setAppliedProduct] = useState('');
  const [appliedDate, setAppliedDate] = useState('');
  const [appliedStatus, setAppliedStatus] = useState('');

  const { data, isFetching } = useQuery({
    queryKey: ['result-densities', page, appliedSearch, appliedProduct, appliedDate, appliedStatus],
    queryFn: () => api.getResultDensities({
      page,
      limit: LIMIT,
      search: appliedSearch || undefined,
      product: appliedProduct || undefined,
      date: appliedDate || undefined,
      status: appliedStatus || undefined,
    }),
    refetchInterval: 30_000,
    placeholderData: (prev) => prev,
  });

  const { data: products = [] } = useQuery({
    queryKey: ['result-density-products'],
    queryFn: () => api.getResultDensityProducts(),
    staleTime: 5 * 60_000,
  });

  const docs = data?.docs ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / LIMIT));

  function applyFilters() {
    setPage(1);
    setAppliedSearch(search);
    setAppliedProduct(product);
    setAppliedDate(date);
    setAppliedStatus(status);
  }

  function handleSearchChange(value: string) {
    setSearch(value);
    setPage(1);
    setAppliedSearch(value);
  }

  function clearFilters() {
    setSearch('');
    setProduct('');
    setDate('');
    setStatus('');
    setPage(1);
    setAppliedSearch('');
    setAppliedProduct('');
    setAppliedDate('');
    setAppliedStatus('');
  }

  const hasActiveFilter = appliedSearch || appliedProduct || appliedDate || appliedStatus;

  return (
    <AppLayout>
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Gauge className="h-5 w-5 text-primary" />
          <h1 className="text-xl font-semibold text-foreground">ผล Density</h1>
          {isFetching && <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" />}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">
            {total.toLocaleString()} รายการ • รีเฟรชทุก 30 วิ
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
              className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground disabled:opacity-30"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-xs text-muted-foreground">{page}/{totalPages}</span>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
              className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground disabled:opacity-30"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-card p-3 text-card-foreground shadow-sm">
        {/* Search */}
        <div className="flex min-w-[200px] flex-1 flex-col gap-1">
          <label className="text-xs text-muted-foreground">ค้นหา (Sample ID / ชื่อ)</label>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={search}
              onChange={(e) => handleSearchChange(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && applyFilters()}
              placeholder="พิมพ์แล้วกด Enter..."
              className="w-full rounded-md border border-input bg-background py-1.5 pl-8 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
        </div>

        {/* Product filter */}
        <div className="flex min-w-[160px] flex-col gap-1">
          <label className="text-xs text-muted-foreground">Product</label>
          <select
            value={product}
            onChange={(e) => setProduct(e.target.value)}
            className="rounded-md border border-input bg-background px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="">ทั้งหมด</option>
            {products.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </div>

        {/* Date filter */}
        <div className="flex min-w-[160px] flex-col gap-1">
          <label className="text-xs text-muted-foreground">วันที่</label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="rounded-md border border-input bg-background px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        {/* Status filter */}
        <div className="flex min-w-[140px] flex-col gap-1">
          <label className="text-xs text-muted-foreground">Status</label>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="rounded-md border border-input bg-background px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="">All</option>
            <option value="Valid">Valid</option>
            <option value="Error">Error</option>
          </select>
        </div>

        {/* Buttons */}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={applyFilters}
            className="rounded-md bg-primary px-4 py-1.5 text-sm text-primary-foreground hover:bg-primary/90"
          >
            ค้นหา
          </button>
          {hasActiveFilter && (
            <button
              type="button"
              onClick={clearFilters}
              className="inline-flex items-center gap-1 rounded-md border border-input bg-background px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            >
              <X className="h-3.5 w-3.5" />
              ล้าง
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border bg-card text-card-foreground shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-muted text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-4 py-3 text-left">#</th>
              <th className="px-4 py-3 text-left">Sample ID</th>
              <th className="px-4 py-3 text-left">Batch</th>
              <th className="px-4 py-3 text-left">Product</th>
              <th className="px-4 py-3 text-right">Density [g/cm³]</th>
              <th className="px-4 py-3 text-right">Density (3 ตำแหน่ง)</th>
              <th className="px-4 py-3 text-right">T(block) [°C]</th>
              <th className="px-4 py-3 text-right">T(set) [°C]</th>
              <th className="px-4 py-3 text-left">วันเวลา</th>
              <th className="px-4 py-3 text-center">สถานะ</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {docs.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-4 py-8 text-center text-muted-foreground">
                  {isFetching ? 'กำลังโหลด...' : 'ไม่พบข้อมูล'}
                </td>
              </tr>
            ) : (
              docs.map((row, idx) => (
                <tr key={String(row._id)} className="hover:bg-accent/60">
                  <td className="px-4 py-2.5 text-muted-foreground">{(page - 1) * LIMIT + idx + 1}</td>
                  <td className="px-4 py-2.5 font-mono text-xs text-foreground">{String(row['Sample ID'] ?? '')}</td>
                  <td className="px-4 py-2.5 text-foreground">{String(row.Batch ?? row['Sample name'] ?? '')}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{String(row['Product name'] ?? '')}</td>
                  <td className="px-4 py-2.5 text-right font-mono font-semibold text-primary">
                    {String(row['Density [g/cm³]'] ?? '')}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono font-semibold text-emerald-700 dark:text-emerald-300">
                    {formatDensity3(row)}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-muted-foreground">{String(row['T (block) [°C]'] ?? '')}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-muted-foreground">{String(row['T (set) [°C]'] ?? '')}</td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">{formatDateTime(String(row['Date & time'] ?? ''))}</td>
                  <td className="px-4 py-2.5 text-center">{statusBadge(String(row['Measurement status'] ?? ''))}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
    </AppLayout>
  );
}
