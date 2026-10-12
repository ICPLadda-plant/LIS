import { useCallback, useEffect, useRef, useState } from 'react';
import { Html5Qrcode, Html5QrcodeScannerState } from 'html5-qrcode';
import { AlertCircle, CheckCircle2, Keyboard, QrCode, X } from 'lucide-react';
import { api } from '@/lib/api';
import type { Petition } from '@/types/petition.types';
import { PETITION_STATUS_CONFIG } from '@/types/petition.types';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/hooks/useAuth';
import { normalizeRoles } from '@/lib/roles';
import { isAssignedTo } from '@/lib/assignment';
import { isResearchAndDevelopmentPetition, shouldSendItemToLab } from '@/lib/petitionRouting';
import { petitionDepartmentLabel } from '@/lib/petitionDepartment';
import { additionalSamplePayload, extractScannedCode, fetchPetitionByScannedCode, getScannedAdditionalSample, type AdditionalSampleRequest } from '@/lib/additionalSampleQr';

const READER_ID = 'lab-accept-qr-reader';
const FULL_ACCESS_ROLES = new Set(['admin', 'lab-head']);

const labReceivableItems = (petition: Petition) =>
  isResearchAndDevelopmentPetition(petition)
    ? (petition.items ?? [])
    : (petition.items ?? []).filter((it) => shouldSendItemToLab(it));

type Phase = 'scanning' | 'confirming' | 'loading' | 'success' | 'error' | 'no-camera';


interface Props {
  open: boolean;
  onClose: () => void;
  onAccepted: () => void;
  /** โหมดกรอกเลขคำร้องอย่างเดียว (ไม่เปิดกล้อง) — ใช้กับปุ่ม "กรอกเลขรับงาน" */
  manualOnly?: boolean;
}

export default function LabScanAcceptModal({ open, onClose, onAccepted, manualOnly = false }: Props) {
  const { user } = useAuth();
  const isFullAccess = normalizeRoles(user).some((r) => FULL_ACCESS_ROLES.has(r));

  const [phase, setPhase] = useState<Phase>('scanning');
  const [petition, setPetition] = useState<Petition | null>(null);
  const [pendingId, setPendingId] = useState('');
  const [additionalRequest, setAdditionalRequest] = useState<AdditionalSampleRequest | null>(null);
  const scanBusy = useRef(false);
  const receiveBusy = useRef(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [manualCode, setManualCode] = useState('');
  const scannerRef = useRef<Html5Qrcode | null>(null);

  useEffect(() => {
    if (open) {
      scanBusy.current = false;
      receiveBusy.current = false;
      setAdditionalRequest(null);
      setPhase('scanning');
      setPetition(null);
      setPendingId('');
      setErrorMsg('');
      setManualCode('');
    }
  }, [open]);

  const fetchAndCheck = useCallback(async (rawCode: string) => {
    const code = extractScannedCode(rawCode);
    if (!code || scanBusy.current) return;
    scanBusy.current = true;
    setPendingId(code);
    setPhase('loading');
    try {
      const found = await fetchPetitionByScannedCode(code);
      const request = getScannedAdditionalSample(found, code, 'lab');
      if (request && !normalizeRoles(user).some((role) => ['admin', 'lab-head', 'lab-analyze'].includes(role))) {
        throw new Error('คุณไม่มีสิทธิ์รับตัวอย่างฝั่ง LAB');
      }
      setAdditionalRequest(request ?? null);

      // Must have at least one lab item
      if (labReceivableItems(found).length === 0) {
        setErrorMsg('คำร้องนี้ไม่มีรายการ Lab');
        setPhase('error');
        return;
      }

      // Assignment is intentionally performed after Lab receives the sample.
      if (found.assignedTo && !isFullAccess && !isAssignedTo(found.assignedTo, user)) {
        setErrorMsg(`คุณไม่ได้ถูก assign งานนี้ (มอบหมายให้: ${found.assignedTo.name})`);
        setPhase('error');
        return;
      }

      // Already completed
      if (!request && found.status === 'success') {
        setErrorMsg(`คำร้องนี้ทดสอบเสร็จสิ้นแล้ว`);
        setPhase('error');
        return;
      }

      // Already received by Lab
      if (!request && found.labReceivedAt) {
        onAccepted();
        return;
      }

      setPetition(found);
      setPendingId(found._id);
      setPhase('confirming');
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? (err instanceof Error ? err.message : 'ไม่พบข้อมูลคำร้อง');
      setErrorMsg(msg);
      setPhase('error');
    }
  }, [isFullAccess, onAccepted, user]);

  useEffect(() => {
    if (!open || phase !== 'scanning' || manualOnly) return;
    let active = true;

    (async () => {
      const scanner = new Html5Qrcode(READER_ID);
      const config = { fps: 10, qrbox: { width: 250, height: 250 } };
      const onScan = (text: string) => {
        if (!active) return;
        fetchAndCheck(text);
      };

      const startWith = (source: MediaTrackConstraints | string) =>
        scanner.start(source, config, onScan, () => {});

      try {
        try {
          await startWith({ facingMode: { exact: 'environment' } });
        } catch {
          const cameras = await Html5Qrcode.getCameras();
          if (cameras.length === 0) {
            if (active) setPhase('no-camera');
            return;
          }
          const back = cameras.find((c) => /back|environment|rear|หลัง|后|背面/i.test(c.label));
          const cam = back ?? (cameras.length > 1 ? cameras[cameras.length - 1] : cameras[0]);
          await startWith(cam.id);
        }
        if (!active) { scanner.stop().catch(() => {}); return; }
        scannerRef.current = scanner;
      } catch {
        // เปิดกล้องไม่ได้ (PC ไม่มีกล้อง / permission โดน block / enumerate ล้ม)
        // → fallback ไปกรอกเลขเอง แทนที่จะค้างหน้า error ทางตัน
        if (active) {
          setErrorMsg('เปิดกล้องไม่ได้ — กรอกเลขคำร้องเองได้เลย');
          setPhase('no-camera');
        }
      }
    })();

    return () => {
      active = false;
      const s = scannerRef.current;
      scannerRef.current = null;
      if (s) {
        try {
          const state = s.getState();
          if (state === Html5QrcodeScannerState.SCANNING || state === Html5QrcodeScannerState.PAUSED) {
            s.stop().catch(() => {});
          }
        } catch { /* ignore */ }
      }
    };
  }, [open, phase, manualOnly, fetchAndCheck]);

  async function confirmAccept() {
    const id = petition?._id || pendingId;
    if (!id || receiveBusy.current || phase !== 'confirming') return;
    receiveBusy.current = true;
    setPhase('loading');
    try {
      const received = await api.patch<Petition>(`/petitions/${id}/receive`, {
        actor: user?.name || user?.email,
        side: 'lab',
        ...additionalSamplePayload(additionalRequest),
      });
      const updated = received.data.data;
      setPetition(updated);
      setPhase('success');
      onAccepted();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'เกิดข้อผิดพลาด กรุณาลองใหม่';
      setErrorMsg(msg);
      setPhase('error');
    }
  }

  function rescan() {
    scanBusy.current = false;
    receiveBusy.current = false;
    setAdditionalRequest(null);
    setPetition(null);
    setPendingId('');
    setErrorMsg('');
    setPhase('scanning');
  }

  if (!open) return null;

  const labItemCount = petition ? labReceivableItems(petition).length : 0;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
      <div className="w-full max-w-md max-h-[92vh] overflow-y-auto rounded-xl border border-border bg-card text-card-foreground shadow-lg">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <div className="flex items-center gap-2">
            {manualOnly ? (
              <Keyboard className="h-5 w-5 text-primary" />
            ) : (
              <QrCode className="h-5 w-5 text-primary" />
            )}
            <h2 className="text-base font-bold">
              {manualOnly ? 'กรอกเลขรับงาน Lab' : 'สแกน QR รับงาน Lab'}
            </h2>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Camera reader — keep mounted during scanning (ไม่ใช้ในโหมด manualOnly) */}
          <div className={phase === 'scanning' && !manualOnly ? 'block' : 'hidden'}>
            <div id={READER_ID} className="w-full rounded-lg overflow-hidden border" />
            <p className="mt-2 text-center text-sm text-muted-foreground">
              เล็งกล้องไปที่ QR Code บนใบคำร้องเพื่อรับงาน
            </p>
          </div>
          {phase !== 'scanning' && <div id={READER_ID} className="hidden" />}

          {phase === 'loading' && (
            <p className="text-center text-sm text-muted-foreground animate-pulse">
              กำลังดำเนินการ...
            </p>
          )}

          {phase === 'no-camera' && (
            <p className="text-center text-sm text-muted-foreground">{errorMsg || 'ไม่พบกล้องในอุปกรณ์นี้'}</p>
          )}

          {(phase === 'scanning' || phase === 'no-camera') && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const code = manualCode.trim();
                if (!code) return;
                setManualCode('');
                fetchAndCheck(code);
              }}
              className="space-y-2"
            >
              {!manualOnly && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <div className="h-px flex-1 bg-border" />
                  <span>หรือ</span>
                  <div className="h-px flex-1 bg-border" />
                </div>
              )}
              <div className="flex gap-2">
                <input
                  type="text"
                  value={manualCode}
                  onChange={(e) => setManualCode(e.target.value)}
                  placeholder="พิมพ์เลขที่คำร้อง เช่น P-2506-0001"
                  autoFocus={manualOnly}
                  className="flex-1 rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring"
                />
                <Button type="submit" variant="primary" disabled={!manualCode.trim()}>
                  รับงาน
                </Button>
              </div>
            </form>
          )}

          {phase === 'confirming' && petition && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-lg font-bold text-primary">{petition.petitionNo}</span>
                <Badge variant={PETITION_STATUS_CONFIG.pendingReview.variant}>
                  → {PETITION_STATUS_CONFIG.pendingReview.label}
                </Badge>
              </div>
              <div className="text-sm space-y-1 text-muted-foreground">
                {additionalRequest && <p className="font-semibold text-foreground">ตัวอย่างเพิ่ม · LAB · {additionalRequest.reason}</p>}
                <p>แผนก: <span className="text-foreground">{petitionDepartmentLabel(petition)}</span></p>
                <p>รายการ Lab: <span className="text-foreground">{labItemCount} รายการ</span></p>
                {petition.assignedTo && (
                  <p>มอบหมายให้: <span className="font-medium text-primary">{petition.assignedTo.name}</span></p>
                )}
              </div>
              <div className="flex gap-2 pt-2">
                <Button variant="ghost" className="flex-1" onClick={rescan}>
                  {manualOnly ? 'กรอกใหม่' : 'สแกนใหม่'}
                </Button>
                <Button variant="primary" className="flex-1" onClick={confirmAccept}>
                  รับงาน
                </Button>
              </div>
            </div>
          )}

          {phase === 'success' && petition && (
            <div className="rounded-lg border border-green-500/30 bg-green-500/10 p-5 text-center space-y-2">
              <CheckCircle2 className="w-10 h-10 text-green-500 mx-auto" />
              <p className="text-base font-bold text-green-700 dark:text-green-300">รับงานแล้ว</p>
              <p className="text-sm text-muted-foreground">{petition.petitionNo}</p>
            </div>
          )}

          {phase === 'error' && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-5 text-center space-y-3">
              <AlertCircle className="w-10 h-10 text-red-400 mx-auto" />
              <p className="text-destructive text-sm">{errorMsg || 'เกิดข้อผิดพลาด'}</p>
              <div className="flex gap-2">
                <Button variant="ghost" className="flex-1" onClick={onClose}>
                  ปิด
                </Button>
                <Button variant="primary" className="flex-1" onClick={rescan}>
                  {manualOnly ? 'กรอกใหม่' : 'สแกนใหม่'}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
