import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import {
  buildCommonNameToSlots,
  type MasterItemRaw,
  type SimpleMethodEntry,
} from '@/lib/labSubstanceGroups';

/** ข้อมูล method ต่อสาร (simple method + master item + method registry) ใช้ทั้งบอร์ด Assign และ dialog เริ่มงาน */
export function useLabMethodSlots() {
  const { data: registryMethods = [] } = useQuery({
    queryKey: ['methods'],
    queryFn: () => api.getMethods(),
    staleTime: 5 * 60_000,
  });

  const { data: masterItems = [] } = useQuery<MasterItemRaw[]>({
    queryKey: ['master-items-for-petition-assign'],
    queryFn: async () => {
      const res = await api.get<unknown>('/master-items');
      const payload = res.data.data;
      if (Array.isArray(payload)) return payload as MasterItemRaw[];
      if (payload && typeof payload === 'object') {
        const arr =
          (payload as { data?: unknown }).data ??
          (payload as { items?: unknown }).items;
        if (Array.isArray(arr)) return arr as MasterItemRaw[];
      }
      return [];
    },
    staleTime: 5 * 60_000,
  });

  const { data: simpleMethods = [] } = useQuery<SimpleMethodEntry[]>({
    queryKey: ['simple-methods'],
    queryFn: async () => {
      const res = await api.get<SimpleMethodEntry[]>('/simple-methods');
      // Keep raw entries — readSlotMethods normalises new `methods` and legacy `instruments`.
      return (res.data.data ?? []).map((entry) => ({
        itemNo: entry.itemNo,
        methods: entry.methods,
        instruments: entry.instruments,
      }));
    },
    staleTime: 5 * 60_000,
  });

  const methodByCode = useMemo(
    () => new Map(registryMethods.map((m) => [m.code, m])),
    [registryMethods],
  );
  const commonNameToSlots = useMemo(
    () => buildCommonNameToSlots(masterItems, simpleMethods),
    [masterItems, simpleMethods],
  );

  return { registryMethods, methodByCode, commonNameToSlots };
}

