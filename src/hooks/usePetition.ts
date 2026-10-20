import { useEffect, useState, useCallback, useRef } from 'react';
import type {
  Petition,
  PetitionAuditLogEntry,
  PetitionDept,
} from '@/types/petition.types';
import type {
  ProductionPetitionFormValues,
  RmPetitionFormValues,
  FgPetitionFormValues,
  LabRequestFormValues,
} from '@/lib/validations';
import type { LabRequest, LabAgreementReview } from '@/types/labRequest.types';

const BASE = import.meta.env.BASE_URL + 'api';
const DEFAULT_PETITION_POLL_MS = 30_000;

interface ApiError extends Error {
  response?: { data?: { error?: { message?: string } } };
}

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: { message: res.statusText } }));
    const err = new Error(body?.error?.message || res.statusText) as ApiError;
    err.response = { data: body };
    throw err;
  }
  return res.json();
}

interface PetitionRefreshOptions {
  refetchOnFocus?: boolean;
  pollMs?: number;
}

function usePetitionAutoRefresh(
  refresh: () => void,
  { refetchOnFocus = true, pollMs = DEFAULT_PETITION_POLL_MS }: PetitionRefreshOptions = {},
) {
  useEffect(() => {
    if (!refetchOnFocus || typeof window === 'undefined' || typeof document === 'undefined') return;
    const onFocus = () => refresh();
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refetchOnFocus, refresh]);

  useEffect(() => {
    if (!pollMs || pollMs <= 0 || typeof window === 'undefined' || typeof document === 'undefined') return;
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') refresh();
    }, pollMs);
    return () => window.clearInterval(id);
  }, [pollMs, refresh]);
}

// ===== Single petition =====
export function usePetition(id: string | undefined, options: PetitionRefreshOptions = {}) {
  const [data, setData] = useState<Petition | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const hasDataRef = useRef(false);
  const lastIdRef = useRef<string | undefined>();

  const refresh = useCallback(() => setReloadKey((k) => k + 1), []);
  usePetitionAutoRefresh(refresh, options);

  useEffect(() => {
    if (!id) {
      hasDataRef.current = false;
      lastIdRef.current = undefined;
      setData(null);
      setLoading(false);
      setError('ไม่พบ id');
      return;
    }
    if (lastIdRef.current !== id) {
      hasDataRef.current = false;
      lastIdRef.current = id;
      setData(null);
    }
    let alive = true;
    if (!hasDataRef.current) setLoading(true);
    setError(null);
    apiFetch<Petition>(`/petitions/${id}`)
      .then((p) => {
        if (!alive) return;
        hasDataRef.current = true;
        setData(p);
      })
      .catch((e: Error) => {
        if (!alive) return;
        setError(e.message);
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [id, reloadKey]);

  const isCurrentPetition = lastIdRef.current === id;
  return {
    data: isCurrentPetition ? data : null,
    loading: !isCurrentPetition || loading,
    error: isCurrentPetition ? error : null,
    refresh,
  };
}

// ===== Petition list =====
interface PetitionListParams {
  page?: number;
  limit?: number;
  status?: string;
  search?: string;
  dept?: PetitionDept;
  assignedToEmployeeId?: string;
  assignedToName?: string;
  assignedToNames?: string[];
  awaitingQcApproval?: boolean;
  awaitingLabApproval?: boolean;
  labApproved?: boolean;
  labRecheckPending?: boolean;
}
interface PetitionListResponse {
  items: Petition[];
  total: number;
  page: number;
  limit: number;
  summaryTotal?: number;
  statusCounts?: Partial<Record<Petition['status'], number>>;
}

export function usePetitionList(params: PetitionListParams, options: PetitionRefreshOptions = {}) {
  const [data, setData] = useState<PetitionListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const refresh = useCallback(() => setReloadKey((k) => k + 1), []);
  usePetitionAutoRefresh(refresh, options);

  const queryString = (() => {
    const sp = new URLSearchParams();
    if (params.page) sp.set('page', String(params.page));
    if (params.limit) sp.set('limit', String(params.limit));
    if (params.status) sp.set('status', params.status);
    if (params.search) sp.set('search', params.search);
    if (params.dept) sp.set('dept', params.dept);
    if (params.assignedToEmployeeId) sp.set('assignedToEmployeeId', params.assignedToEmployeeId);
    if (params.assignedToName) sp.set('assignedToName', params.assignedToName);
    params.assignedToNames?.filter(Boolean).forEach((name) => sp.append('assignedToName', name));
    if (params.awaitingQcApproval) sp.set('awaitingQcApproval', 'true');
    if (params.awaitingLabApproval) sp.set('awaitingLabApproval', 'true');
    if (params.labApproved) sp.set('labApproved', 'true');
    if (params.labRecheckPending) sp.set('labRecheckPending', 'true');
    return sp.toString();
  })();

  useEffect(() => {
    let alive = true;
    if (!data) setLoading(true);
    setError(null);
    apiFetch<PetitionListResponse>(`/petitions?${queryString}`)
      .then((res) => {
        if (!alive) return;
        setData(res);
      })
      .catch((e: Error) => {
        if (!alive) return;
        setError(e.message);
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [queryString, reloadKey]);

  return { data, loading, error, refresh };
}

// ===== Audit log list =====
interface PetitionAuditLogListParams {
  page?: number;
  limit?: number;
  search?: string;
  event?: string;
  status?: string;
  from?: string;
  to?: string;
}

interface PetitionAuditLogListResponse {
  items: PetitionAuditLogEntry[];
  total: number;
  page: number;
  limit: number;
}

export function usePetitionAuditLogList(params: PetitionAuditLogListParams, pollMs = 10000) {
  const [data, setData] = useState<PetitionAuditLogListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const refresh = useCallback(() => setReloadKey((k) => k + 1), []);

  const queryString = (() => {
    const sp = new URLSearchParams();
    if (params.page) sp.set('page', String(params.page));
    if (params.limit) sp.set('limit', String(params.limit));
    if (params.search) sp.set('search', params.search);
    if (params.event) sp.set('event', params.event);
    if (params.status) sp.set('status', params.status);
    if (params.from) sp.set('from', params.from);
    if (params.to) sp.set('to', params.to);
    return sp.toString();
  })();

  useEffect(() => {
    let alive = true;
    if (!data) setLoading(true);
    setError(null);
    apiFetch<PetitionAuditLogListResponse>(`/petitions/audit-logs?${queryString}`)
      .then((res) => {
        if (!alive) return;
        setData(res);
      })
      .catch((e: Error) => {
        if (!alive) return;
        setError(e.message);
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [queryString, reloadKey]);

  // polling เบื้องหลัง — fetch เงียบตาม filter/หน้าปัจจุบัน, ข้าม error, หยุดเมื่อสลับแท็บ
  useEffect(() => {
    if (!pollMs) return;
    let alive = true;
    const tick = () => {
      if (typeof document !== 'undefined' && document.hidden) return;
      apiFetch<PetitionAuditLogListResponse>(`/petitions/audit-logs?${queryString}`)
        .then((res) => {
          if (alive) setData(res);
        })
        .catch(() => {});
    };
    const handle = setInterval(tick, pollMs);
    return () => {
      alive = false;
      clearInterval(handle);
    };
  }, [queryString, pollMs]);

  return { data, loading, error, refresh };
}

// ===== Petition mutations =====
type CreatePetitionPayload =
  | (ProductionPetitionFormValues & { prodOrderNos?: string[]; productionWorkflow?: { requestNo?: string; requesterEmail?: string } })
  | (RmPetitionFormValues & { prodOrderNos?: string[] })
  | (FgPetitionFormValues & { prodOrderNos?: string[] });

export async function createPetition(payload: CreatePetitionPayload): Promise<Petition> {
  return apiFetch<Petition>('/petitions', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function updatePetition(
  id: string,
  values: Partial<CreatePetitionPayload>,
  actor?: string,
): Promise<Petition> {
  return apiFetch<Petition>(`/petitions/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ ...values, actor }),
  });
}

export async function deletePetition(id: string, actor?: string): Promise<void> {
  const qs = actor ? `?actor=${encodeURIComponent(actor)}` : '';
  await apiFetch<{ success: true }>(`/petitions/${id}${qs}`, { method: 'DELETE' });
}

export async function getSubmittedOrderNos(): Promise<Set<string>> {
  const list = await apiFetch<string[]>('/petitions/submitted-orders');
  return new Set(list);
}

// ===== Lab request mutations =====
export type CreateLabRequestPayload = LabRequestFormValues & {
  petitionId: string;
};

export async function createLabRequest(payload: CreateLabRequestPayload): Promise<LabRequest> {
  return apiFetch<LabRequest>('/lab-requests', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function updateLabRequest(
  id: string,
  values: Partial<LabRequestFormValues>,
): Promise<LabRequest> {
  return apiFetch<LabRequest>(`/lab-requests/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(values),
  });
}

export async function deleteLabRequest(id: string): Promise<void> {
  await apiFetch<{ success: true }>(`/lab-requests/${id}`, { method: 'DELETE' });
}

export async function saveLabAgreementReview(
  petitionId: string,
  review: Omit<LabAgreementReview, 'reviewedAt' | 'reviewedBy'>,
  actor: string,
): Promise<{ updated: number; review: LabAgreementReview }> {
  return apiFetch<{ updated: number; review: LabAgreementReview }>(
    `/petitions/${petitionId}/lab-agreement-review`,
    {
      method: 'POST',
      body: JSON.stringify({ review, actor }),
    },
  );
}

interface LabRequestListResponse {
  items: LabRequest[];
  total: number;
  page: number;
  limit: number;
}

export function useLabRequestsByPetition(petitionId: string | undefined) {
  const [data, setData] = useState<LabRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const refresh = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    if (!petitionId) {
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    setError(null);
    apiFetch<LabRequestListResponse>(`/lab-requests?petitionId=${encodeURIComponent(petitionId)}&limit=100`)
      .then((res) => {
        if (!alive) return;
        setData(res.items ?? []);
      })
      .catch((e: Error) => {
        if (!alive) return;
        setError(e.message);
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [petitionId, reloadKey]);

  return { data, loading, error, refresh };
}

// ===== Audit log =====
// pollMs > 0 = auto-refresh timeline แบบเงียบ (ดูเหมือน realtime); 0 = ปิด polling
export function usePetitionAuditLog(id: string | undefined, pollMs = 5000) {
  const [data, setData] = useState<PetitionAuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const refresh = useCallback(() => setReloadKey((k) => k + 1), []);

  // โหลดครั้งแรก / เมื่อ id หรือ refresh เปลี่ยน — โชว์ spinner
  useEffect(() => {
    if (!id) {
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    setError(null);
    apiFetch<{ items: PetitionAuditLogEntry[] }>(`/petitions/${id}/audit-logs`)
      .then((res) => {
        if (!alive) return;
        setData(res.items ?? []);
      })
      .catch((e: Error) => {
        if (!alive) return;
        setError(e.message);
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [id, reloadKey]);

  // polling เบื้องหลัง — fetch เงียบ ไม่ toggle loading, ข้าม error, หยุดเมื่อสลับแท็บ
  useEffect(() => {
    if (!id || !pollMs) return;
    let alive = true;
    const tick = () => {
      if (typeof document !== 'undefined' && document.hidden) return;
      apiFetch<{ items: PetitionAuditLogEntry[] }>(`/petitions/${id}/audit-logs`)
        .then((res) => {
          if (alive) setData(res.items ?? []);
        })
        .catch(() => {});
    };
    const handle = setInterval(tick, pollMs);
    return () => {
      alive = false;
      clearInterval(handle);
    };
  }, [id, pollMs]);

  return { data, loading, error, refresh };
}
