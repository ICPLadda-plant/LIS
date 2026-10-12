import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { buildOverrideMap, normalizeCommonName } from '@/lib/commonNameOverride';
import type { CommonNameOverrideRow } from '@/lib/commonNameOverride';
import {
  appendMfDateNote,
  mergeMfItemRows,
  MF_CURRENT_API_URL,
  MF_HISTORICAL_API_URL,
  normalizeMfDate,
} from '@/lib/mfItemDates';
export const MF_LOT_API_URLS = [
  { source: 'Historical', url: MF_HISTORICAL_API_URL },
  { source: 'Current', url: MF_CURRENT_API_URL },
] as const;

export const EMPLOYEE_API_URL = 'https://n8n-plant.icpladda.com/webhook/api/employee';

export interface MfLotOption {
  id: string;
  source: string;
  label: string;
  sampleName: string;
  batchNo: string;
  itemNo: string;
  productionDate: string | null;
  MF_Before: string | null;
  MF_Lasted: string | null;
  packageUnit: string;
  commonName: string;
  note: string;
}

export interface EmployeeOption {
  id: string;
  label: string;
  name: string;
  email: string;
  department: string;
  position: string;
  employeeType: string;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (Array.isArray(value)) {
    return Object.fromEntries(value.map((entry, index) => [String(index), entry]));
  }
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function rowsFromPayload(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) return payload.map(asRecord);
  const obj = asRecord(payload);
  for (const key of ['value', 'data', 'items', 'rows', 'result']) {
    if (Array.isArray(obj[key])) return (obj[key] as unknown[]).map(asRecord);
  }
  return Object.keys(obj).length ? [obj] : [];
}

function pickString(row: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = row[key];
    if (value !== null && value !== undefined && String(value).trim()) {
      return String(value).trim();
    }
  }
  return '';
}

function positionalBatch(row: Record<string, unknown>): string {
  const values = Array.isArray(row.values)
    ? row.values
    : Object.keys(row).every((key) => /^\d+$/.test(key))
      ? Object.keys(row).sort((a, b) => Number(a) - Number(b)).map((key) => row[key])
      : [];
  const productName = pickString(row, ['prod_descript', 'product_name', 'item_name', 'trade_name', 'name', 'description']);
  const productIndex = productName ? values.findIndex((value) => String(value ?? '').trim() === productName) : -1;
  const dateIndex = values.findIndex((value, index) => index > productIndex && /^\d{4}[-/]\d{1,2}[-/]\d{1,2}(?:[T\s]|$)/.test(String(value ?? '').trim()));
  if (dateIndex < 1) return '';
  const candidateIndex = productIndex >= 0 ? productIndex + 1 : dateIndex - 1;
  const candidate = String(values[candidateIndex] ?? '').trim();
  if (!candidate || candidateIndex >= dateIndex || /^MF[A-Z0-9-]+$/i.test(candidate)) return '';
  if (/^\d+(?:\.\d+)?$/.test(candidate) && !/^0\d{2,}$/.test(candidate)) return '';
  return candidate;
}

function normalizeDate(value: string): string | null {
  return normalizeMfDate(value);
}

function normalizeLotOptions(payload: unknown, source: string, cnMap: Map<string, string>): MfLotOption[] {
  return rowsFromPayload(payload)
    .map((row, idx) => {
      const productName = pickString(row, [
        'prod_descript',
        'product_name',
        'item_name',
        'trade_name',
        'name',
        'description',
        'prod_descript2',
      ]);
      const packsize = pickString(row, ['packsize', 'packageUnit', 'package_unit', 'uom_code']);
      const rawCommonName = pickString(row, ['common_name', 'commonName', 'active_ingredient']);
      const commonName = normalizeCommonName(rawCommonName, cnMap);
      const sampleName = [productName, packsize, commonName].filter(Boolean).join(' · ');
      const batchNo = pickString(row, [
        'batch_no',
        'batchNo',
        'batch',
        'batch_number',
        'batchNumber',
        'lot_no',
        'lotNo',
        'lot',
        'LOT_NO',
      ]) || positionalBatch(row);
      const rowProductionDate = normalizeDate(
        pickString(row, ['productionDate', 'production_date', 'mfg_date', 'manufacture_date', 'create_date']),
      );
      const mfBefore = normalizeDate(pickString(row, ['MF_Before']));
      const mfLasted = normalizeDate(pickString(row, ['MF_Lasted'])) ?? rowProductionDate;
      const itemNo = pickString(row, ['item_no', 'itemNo', 'code', 'short_dm1_code']);
      const labelParts = [sampleName, batchNo ? `Lot ${batchNo}` : '', itemNo ? `Item ${itemNo}` : ''];
      const note = appendMfDateNote(itemNo ? `${source}: ${itemNo}` : source, {
        MF_Before: mfBefore,
        MF_Lasted: mfLasted,
      });
      return {
        id: `${source}-${batchNo || itemNo || idx}`,
        source,
        label: `[${source}] ${labelParts.filter(Boolean).join(' | ')}`,
        sampleName,
        batchNo,
        itemNo,
        productionDate: mfLasted,
        MF_Before: mfBefore,
        MF_Lasted: mfLasted,
        packageUnit: packsize,
        commonName,
        note,
      };
    })
    .filter((option) => option.sampleName);
}

function normalizeEmployeeOptions(payload: unknown): EmployeeOption[] {
  return rowsFromPayload(payload)
    .map((row, idx) => {
      const employeeId = pickString(row, ['employee_id', 'employeeId', 'code', 'id']);
      const name = pickString(row, ['name', 'employee_name', 'fullName']);
      const email = pickString(row, ['email', 'mail', 'email_address']).toLowerCase();
      const department = pickString(row, ['department', 'department_name', 'Department', 'DEPARTMENT']);
      const position = pickString(row, ['position', 'position_name', 'job_title']);
      const employeeType = pickString(row, ['emp_type', 'empType', 'employee_type', 'employment_type']);
      const detail = [employeeId, department, position].filter(Boolean).join(' | ');
      return {
        id: employeeId || String(idx),
        label: detail ? `${name} (${detail})` : name,
        name,
        email,
        department,
        position,
        employeeType,
      };
    })
    .filter((option) => option.name);
}

function isInactiveEmployee(row: Record<string, unknown>): boolean {
  const active = row.is_active ?? row.active ?? row.status;
  if (active !== undefined && active !== null) {
    const normalized = String(active).trim().toLowerCase();
    if (normalized === '0' || normalized === 'false' || normalized === 'inactive') return true;
  }
  return Boolean(pickString(row, ['deleted_at', 'deletedAt', 'delete_after', 'deleted_by']));
}

export function normalizeEmployeeDepartments(payload: unknown): string[] {
  return Array.from(new Set(
    rowsFromPayload(payload)
      .filter((row) => !isInactiveEmployee(row))
      .map((row) => pickString(row, ['department', 'department_name', 'Department', 'DEPARTMENT']))
      .filter((department) => Boolean(department && department !== 'Unassigned')),
  )).sort((a, b) => a.localeCompare(b, 'th'));
}

async function fetchMfPayload(source: string, url: string): Promise<unknown> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${source} HTTP ${res.status}`);
  return res.json();
}

export function useLotOptions() {
  const [options, setOptions] = useState<MfLotOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    (async () => {
      let cnMap = new Map<string, string>();
      try {
        const res = await api.get<CommonNameOverrideRow[]>('/common-name-overrides');
        cnMap = buildOverrideMap(res.data.data);
      } catch {
        // overrides are optional — fall back to raw names
      }
      const results = await Promise.allSettled(
        MF_LOT_API_URLS.map(({ source, url }) => fetchMfPayload(source, url)),
      );
      if (!alive) return;
      const historicalPayload = results[0]?.status === 'fulfilled' ? results[0].value : [];
      const currentPayload = results[1]?.status === 'fulfilled' ? results[1].value : [];
      const opts = normalizeLotOptions(mergeMfItemRows(historicalPayload, currentPayload), 'MF', cnMap);
      const failed = results.filter((r) => r.status === 'rejected').length;
      setOptions(opts);
      setError(failed === results.length ? 'โหลดข้อมูล MF จาก API ไม่สำเร็จ' : failed ? 'โหลดข้อมูล MF บางส่วนไม่สำเร็จ' : null);
      setLoading(false);
    })().catch((e: Error) => {
      if (alive) {
        setError(e.message);
        setLoading(false);
      }
    });
    return () => {
      alive = false;
    };
  }, []);

  const optionMap = useMemo(() => {
    const map = new Map<string, MfLotOption>();
    for (const opt of options) {
      map.set(opt.label, opt);
      map.set(opt.sampleName, opt);
    }
    return map;
  }, [options]);

  return { options, loading, error, optionMap };
}

export function useEmployeeOptions() {
  const [options, setOptions] = useState<EmployeeOption[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetch(EMPLOYEE_API_URL)
      .then((res) => {
        if (!res.ok) throw new Error(`Employee HTTP ${res.status}`);
        return res.json();
      })
      .then((payload) => {
        if (alive) setOptions(normalizeEmployeeOptions(payload));
      })
      .catch(() => {
        if (alive) setOptions([]);
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  const optionMap = useMemo(() => {
    const map = new Map<string, EmployeeOption>();
    for (const opt of options) {
      map.set(opt.label, opt);
      map.set(opt.name, opt);
    }
    return map;
  }, [options]);

  return { options, loading, optionMap };
}

export function useEmployeeDepartmentOptions() {
  const [departments, setDepartments] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetch(EMPLOYEE_API_URL)
      .then((res) => {
        if (!res.ok) throw new Error(`Employee HTTP ${res.status}`);
        return res.json();
      })
      .then((payload) => {
        if (alive) setDepartments(normalizeEmployeeDepartments(payload));
      })
      .catch(() => {
        if (alive) setDepartments([]);
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  return { departments, loading };
}
