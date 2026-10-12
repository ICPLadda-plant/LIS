import { describe, expect, it } from 'vitest';
import type { Petition } from '@/types/petition.types';
import { canPrintAdditionalSamples, extractScannedCode, getScannedAdditionalSample } from './additionalSampleQr';

const request = {
  _id: 'round-1', qrCode: 'LIS-EXTRA-11111111-1111-4111-8111-111111111111', side: 'qc',
  reason: 'ตรวจซ้ำ', items: [{ itemSeq: 1, quantity: 2 }], status: 'requested',
  requestedAt: '2026-09-19T01:00:00Z', requestedBy: { name: 'QC' },
};
const petition = {
  _id: 'petition-1', submittedBy: { employeeId: 'EMP-1', name: 'Same name' },
  additionalSampleRequests: [request], scannedAdditionalSampleId: request._id,
  scannedAdditionalSampleCode: request.qrCode,
} as Petition;

describe('additional sample QR boundaries', () => {
  it('keeps plain round code and prioritizes round codes over legacy petition IDs', () => {
    expect(extractScannedCode(request.qrCode)).toBe(request.qrCode);
    expect(extractScannedCode(JSON.stringify({ id: petition._id, additionalSampleCode: request.qrCode }))).toBe(request.qrCode);
    expect(extractScannedCode('https://example.test/LIS/petition/old-id')).toBe('old-id');
  });

  it('resolves only matching server round metadata', () => {
    expect(getScannedAdditionalSample(petition, request.qrCode, 'qc')).toEqual(request);
    expect(() => getScannedAdditionalSample({ ...petition, scannedAdditionalSampleCode: 'other' }, request.qrCode, 'qc')).toThrow(/ไม่ตรง/);
    expect(() => getScannedAdditionalSample({ ...petition, scannedAdditionalSampleId: undefined }, request.qrCode, 'qc')).toThrow(/ไม่ตรง/);
  });

  it('rejects wrong side, received rounds, and original QR while an extra round is pending', () => {
    expect(() => getScannedAdditionalSample(petition, request.qrCode, 'lab')).toThrow(/QC/);
    expect(() => getScannedAdditionalSample({ ...petition, additionalSampleRequests: [{ ...request, status: 'received' }] } as Petition, request.qrCode, 'qc')).toThrow(/รับ.*แล้ว/);
    const oldScan = { ...petition, scannedAdditionalSampleId: undefined, scannedAdditionalSampleCode: undefined };
    expect(() => getScannedAdditionalSample(oldScan, petition._id, 'qc')).toThrow(/QR รอบเพิ่ม/);
    expect(getScannedAdditionalSample(oldScan, petition._id, 'lab')).toBeUndefined();
    expect(() => getScannedAdditionalSample(oldScan, petition._id)).toThrow(/QR รอบเพิ่ม/);
  });

  it('allows print by employee ID, workflow email or admin, never by matching name alone', () => {
    expect(canPrintAdditionalSamples(petition, { name: 'Same name', email: 'other@test' })).toBe(false);
    expect(canPrintAdditionalSamples(petition, { employeeId: 'EMP-1' })).toBe(true);
    expect(canPrintAdditionalSamples(petition, { roles: ['admin'] })).toBe(true);
    expect(canPrintAdditionalSamples({ ...petition, productionWorkflow: { requesterEmail: 'Owner@Test' } }, { email: 'owner@test' })).toBe(true);
    expect(canPrintAdditionalSamples(petition, undefined)).toBe(false);
  });
});
