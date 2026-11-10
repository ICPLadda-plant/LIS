import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { selectDensitySyncRow } from '@/lib/densitySync';

interface DensitySyncButtonProps {
  /** Petition item batch number to match against Result-Density. */
  batchNo: string;
  /** Called with every matched Result-Density row so the user can pick one. */
  onOptions?: (docs: Record<string, unknown>[]) => void;
  disabled?: boolean;
}

const EMPTY_DENSITY_DOCS: Record<string, unknown>[] = [];

/**
 * Pull DMA 501 density readings for `batchNo` from Result-Density and report
 * them as choices. Never writes a value by itself — the user picks the value
 * (or types one) so a saved hand-typed value is never overwritten on reload.
 */
export default function DensitySyncButton({
  batchNo, onOptions, disabled = false,
}: DensitySyncButtonProps) {
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
    if (isError) {
      toast.error('ตรวจค่า ถพ. จากฐานข้อมูลไม่ได้', {
        description: error instanceof Error ? error.message : undefined,
      });
    }
  }, [isError, error]);

  return null;
}
