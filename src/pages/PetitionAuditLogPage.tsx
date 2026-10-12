import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight, History, Search, X } from 'lucide-react';
import AppLayout from '@/components/lis/AppLayout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { usePetitionAuditLogList } from '@/hooks/usePetition';
import { formatDateTime } from '@/lib/dateTime';
import {
  PETITION_AUDIT_EVENT_LABELS,
  PETITION_STATUSES,
  PETITION_STATUS_CONFIG,
  type PetitionAuditEvent,
  type PetitionStatus,
} from '@/types/petition.types';

const PAGE_SIZE = 20;

const EVENT_VARIANT: Record<PetitionAuditEvent, 'gray-soft' | 'primary-soft' | 'yellow-soft' | 'blue-soft' | 'green-soft' | 'red-soft'> = {
  created: 'primary-soft',
  statusChanged: 'blue-soft',
  assigned: 'yellow-soft',
  reviewed: 'green-soft',
  updated: 'gray-soft',
  deleted: 'red-soft',
  received: 'primary-soft',
  resultEntered: 'green-soft',
  resultUpdated: 'yellow-soft',
};

function statusLabel(status?: string) {
  if (!status) return null;
  return PETITION_STATUS_CONFIG[status as PetitionStatus]?.label ?? status;
}

function updateSearchParams(
  current: URLSearchParams,
  setSearchParams: ReturnType<typeof useSearchParams>[1],
  next: Record<string, string | undefined>,
) {
  const sp = new URLSearchParams(current);
  for (const [key, value] of Object.entries(next)) {
    if (value) sp.set(key, value);
    else sp.delete(key);
  }
  setSearchParams(sp, { replace: false });
}

export default function PetitionAuditLogPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const search = searchParams.get('search') ?? '';
  const event = searchParams.get('event') ?? '';
  const status = searchParams.get('status') ?? '';
  const from = searchParams.get('from') ?? '';
  const to = searchParams.get('to') ?? '';
  const page = Math.max(1, Number(searchParams.get('page')) || 1);

  const [searchInput, setSearchInput] = useState(search);
  useEffect(() => setSearchInput(search), [search]);

  const params = useMemo(
    () => ({
      page,
      limit: PAGE_SIZE,
      search: search || undefined,
      event: event || undefined,
      status: status || undefined,
      from: from || undefined,
      to: to || undefined,
    }),
    [event, from, page, search, status, to],
  );
  const { data, loading, error, refresh } = usePetitionAuditLogList(params);
  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;
  const hasFilters = !!search || !!event || !!status || !!from || !!to;

  function setFilters(next: Record<string, string | undefined>) {
    updateSearchParams(searchParams, setSearchParams, { ...next, page: undefined });
  }

  function applySearch(e: React.FormEvent) {
    e.preventDefault();
    setFilters({ search: searchInput.trim() || undefined });
  }

  function clearFilters() {
    setSearchInput('');
    setSearchParams(new URLSearchParams(), { replace: false });
  }

  return (
    <AppLayout>
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="flex items-center gap-2 text-xl md:text-2xl font-bold text-black-500">
                <History className="h-6 w-6 text-primary-500" />
                ประวัติการเปลี่ยนสถานะ (Audit Log)
              </h1>
              <p className="text-sm text-grey-500">
                ค้นหาและกรองประวัติการทำรายการของคำร้องทั้งหมด
              </p>
            </div>
          </div>

          {error && (
            <div className="rounded-[10px] border border-red-500 bg-red-50 p-3 text-sm text-red-500 flex items-center justify-between gap-3">
              <span>โหลด audit log ไม่สำเร็จ: {error}</span>
              <Button variant="danger-outline" size="sm" onClick={refresh}>
                ลองใหม่
              </Button>
            </div>
          )}

          <form
            onSubmit={applySearch}
            className="grid gap-3 rounded-[10px] border border-black-50 bg-white p-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-[minmax(240px,1fr)_180px_180px_150px_150px_auto_auto]"
          >
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-grey-500" />
              <Input
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="ค้นหาเลขที่คำร้อง / ผู้ทำรายการ / หมายเหตุ..."
                className="pl-9"
              />
            </div>
            <NativeSelect
              value={event}
              onChange={(e) => setFilters({ event: e.target.value || undefined })}
            >
              <option value="">ทุกเหตุการณ์</option>
              {Object.entries(PETITION_AUDIT_EVENT_LABELS).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </NativeSelect>
            <NativeSelect
              value={status}
              onChange={(e) => setFilters({ status: e.target.value || undefined })}
            >
              <option value="">ทุกสถานะปลายทาง</option>
              {PETITION_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {PETITION_STATUS_CONFIG[s].label}
                </option>
              ))}
            </NativeSelect>
            <Input
              type="date"
              value={from}
              onChange={(e) => setFilters({ from: e.target.value || undefined })}
              aria-label="วันที่เริ่มต้น"
            />
            <Input
              type="date"
              value={to}
              onChange={(e) => setFilters({ to: e.target.value || undefined })}
              aria-label="วันที่สิ้นสุด"
            />
            <Button type="submit" variant="primary">
              ค้นหา
            </Button>
            {hasFilters && (
              <Button type="button" variant="ghost" onClick={clearFilters}>
                <X className="h-4 w-4" />
                ล้าง
              </Button>
            )}
          </form>

          <div className="rounded-[10px] border border-black-50 bg-white overflow-x-auto -mx-3 sm:mx-0 px-3 sm:px-0">
            <Table className="min-w-[600px]">
              <TableHeader>
                <TableRow>
                  <TableHead>วันที่</TableHead>
                  <TableHead>เลขที่คำร้อง</TableHead>
                  <TableHead>เหตุการณ์</TableHead>
                  <TableHead>สถานะ</TableHead>
                  <TableHead>ผู้ทำรายการ</TableHead>
                  <TableHead>หมายเหตุ</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-grey-500 py-8">
                      กำลังโหลด audit log...
                    </TableCell>
                  </TableRow>
                )}
                {!loading && data && data.items.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-grey-500 py-8">
                      {hasFilters ? 'ไม่พบ audit log ตามเงื่อนไขที่ค้นหา' : 'ยังไม่มีรายการ audit log'}
                    </TableCell>
                  </TableRow>
                )}
                {!loading && data?.items.map((entry) => {
                  const fromStatus = statusLabel(entry.fromStatus);
                  const toStatus = statusLabel(entry.toStatus);
                  return (
                    <TableRow
                      key={entry._id}
                      className="cursor-pointer"
                      onClick={() => navigate(`/petition/${entry.petitionId}`)}
                    >
                      <TableCell className="text-grey-500 whitespace-nowrap">
                        {formatDateTime(entry.createdAt)}
                      </TableCell>
                      <TableCell className="font-medium text-primary-500">{entry.petitionNo}</TableCell>
                      <TableCell>
                        <Badge variant={EVENT_VARIANT[entry.event]}>
                          {PETITION_AUDIT_EVENT_LABELS[entry.event]}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {toStatus ? (
                          <span className="text-sm">
                            {fromStatus && fromStatus !== toStatus ? (
                              <>
                                <span className="text-grey-500">{fromStatus}</span>
                                <span className="mx-1 text-grey-400">→</span>
                                <span className="font-medium text-black-500">{toStatus}</span>
                              </>
                            ) : (
                              <span className="font-medium text-black-500">{toStatus}</span>
                            )}
                          </span>
                        ) : (
                          <span className="text-grey-400">-</span>
                        )}
                      </TableCell>
                      <TableCell>{entry.actor || 'system'}</TableCell>
                      <TableCell className="max-w-[360px] truncate text-grey-500">{entry.note || '-'}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          {data && data.total > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
              <span className="text-grey-500">
                แสดง {(page - 1) * PAGE_SIZE + 1}-{Math.min(page * PAGE_SIZE, data.total)} จาก {data.total} รายการ
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="primary-outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => updateSearchParams(searchParams, setSearchParams, { page: String(page - 1) })}
                >
                  <ChevronLeft className="h-4 w-4" />
                  ก่อนหน้า
                </Button>
                <span className="font-medium text-black-500">
                  หน้า {page} / {totalPages}
                </span>
                <Button
                  variant="primary-outline"
                  size="sm"
                  disabled={page >= totalPages}
                  onClick={() => updateSearchParams(searchParams, setSearchParams, { page: String(page + 1) })}
                >
                  ถัดไป
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </div>
    </AppLayout>
  );
}
