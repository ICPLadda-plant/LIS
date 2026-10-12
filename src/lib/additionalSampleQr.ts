import { api } from '@/lib/api';
import { normalizeRoles, type RoleHolder } from '@/lib/roles';
import type { AdditionalSampleRequest, Petition } from '@/types/petition.types';

export type { AdditionalSampleRequest } from '@/types/petition.types';

export function extractScannedCode(raw: string): string {
  const text = raw.trim();
  if (!text || text.startsWith('LIS-EXTRA-')) return text;
  try {
    const payload = JSON.parse(text);
    const value = payload?.additionalSampleCode ?? payload?.qrCode ?? payload?.id ?? payload?.petitionId ?? payload?.petitionNo ?? payload?.sampleId;
    if (typeof value === 'string' && value.trim()) return value.trim();
  } catch {
    if (text.startsWith('{')) return text;
  }
  try {
    const url = new URL(text);
    const parts = url.pathname.split('/').filter(Boolean);
    return decodeURIComponent(parts[parts.length - 1] || text).trim();
  } catch {
    return text;
  }
}

export async function fetchPetitionByScannedCode(code: string): Promise<Petition> {
  try {
    const response = await api.get<Petition>(`/petitions/scan/${encodeURIComponent(code)}`);
    return response.data.data;
  } catch (error) {
    if (code.startsWith('LIS-EXTRA-')) throw error;
    const response = await api.get<Petition>(`/petitions/${encodeURIComponent(code)}`);
    return response.data.data;
  }
}

export function getScannedAdditionalSample(petition: Petition, code: string, side?: 'qc' | 'lab'): AdditionalSampleRequest | undefined {
  const requests = petition.additionalSampleRequests ?? [];
  if (!code.startsWith('LIS-EXTRA-') && !petition.scannedAdditionalSampleId && !petition.scannedAdditionalSampleCode) {
    const pending = requests.find((request) => request.status !== 'received' && (!side || request.side === side));
    if (pending) throw new Error('มีตัวอย่างเพิ่มรอรับ กรุณาสแกน QR รอบเพิ่ม');
    return undefined;
  }
  const request = requests.find((entry) => entry._id === petition.scannedAdditionalSampleId);
  if (!request || !code.startsWith('LIS-EXTRA-') || request.qrCode !== code || petition.scannedAdditionalSampleCode !== code) {
    throw new Error('QR ไม่ตรงกับรอบตัวอย่างเพิ่ม กรุณาสแกนใบนำส่งใหม่');
  }
  if (side && request.side !== side) throw new Error(`QR นี้สำหรับฝั่ง ${request.side.toUpperCase()} ไม่สามารถรับต่างฝั่งได้`);
  if (request.status === 'received' || request.receivedAt) throw new Error('ตัวอย่างเพิ่มรอบนี้รับแล้ว ไม่สามารถรับซ้ำได้');
  if (request.status !== 'requested' && request.status !== 'sent') throw new Error('รอบตัวอย่างเพิ่มไม่อยู่ในสถานะรอรับ');
  return request;
}

export function additionalSamplePayload(request?: AdditionalSampleRequest | null) {
  return request ? { additionalSampleId: request._id, additionalSampleCode: request.qrCode, side: request.side } : {};
}

export function canPrintAdditionalSamples(
  petition: Petition,
  user?: (RoleHolder & { employeeId?: string; email?: string; name?: string }) | null,
): boolean {
  if (normalizeRoles(user).includes('admin')) return true;
  const employeeId = user?.employeeId?.trim();
  const email = user?.email?.trim().toLowerCase();
  return Boolean(
    (employeeId && employeeId === petition.submittedBy?.employeeId?.trim()) ||
    (email && email === petition.productionWorkflow?.requesterEmail?.trim().toLowerCase()),
  );
}
