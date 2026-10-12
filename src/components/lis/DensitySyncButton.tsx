import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { selectDensitySyncRow } from '@/lib/densitySync';

interface DensitySyncButtonProps {
  /** Petition item batch number to match against Result-Density. */
  batchNo: string;
  /** Called with the selected matched rows. */
  onRows: (docs: Record<string, unknown>[]) => void;
  onOptions?: (docs: Record<string, unknown>[]) => void;
  disabled?: boolean;
}

const EMPTY_DENSITY_DOCS: Record<string, unknown>[] = [];

/**
 * Pull DMA 501 density readings for `batchNo` from Result-Density. A single
 * valid row is used immediately; multiple rows use the repeat-selection rule.
 */
export default function DensitySyncButton({
  batchNo, onRows, onOptions, disabled = false,
}: DensitySyncButtonProps) {
  const appliedKeyRef = useRef('');
  const onOptionsRef = useRef(onOptions);
  onOptionsRef.current = onOptions;

  const { data, isError, error } = useQuery({
    queryKey: ['density-by-batch', batchNo],
    queryFn: () => api.getResultDensitiesByBatch(batchNo),
    enabled: !disabled && !!batchNo,
    refetchInterval: (q) => (selectDensitySyncRow(q.state.data?.docs ?? EMPTY_DENSITY_DOCS) ? false : 30_000),
  });

  const docs = data?.docs ?? EMPTY_DENSITY_DOCS;

  useEffect(() => {
    onOptionsRef.current?.(docs);
  }, [docs]);

  useEffect(() => {
    appliedKeyRef.current = '';
  }, [batchNo]);

  useEffect(() => {
    const selected = selectDensitySyncRow(docs);
    if (selected) {
      const selectedIndex = Math.max(docs.indexOf(selected), 0);
      const selectedKey = `${batchNo}::${String(selected._id ?? selectedIndex)}`;
      if (appliedKeyRef.current === selectedKey) return;
      appliedKeyRef.current = selectedKey;
      onRows([selected]);
      toast.success('ใช้ค่า ถพ. จากเครื่องแล้ว (1 รายการ)');
    }
  }, [batchNo, docs, onRows]);

  useEffect(() => {
    if (isError) {
      toast.error('ตรวจค่า ถพ. จากฐานข้อมูลไม่ได้', {
        description: error instanceof Error ? error.message : undefined,
      });
    }
  }, [isError, error]);

  return null;
}
