import { useCallback, useEffect, useRef, useState } from 'react';
import { Html5Qrcode, Html5QrcodeScannerState } from 'html5-qrcode';
import {
  AlertCircle, CheckCircle2, QrCode,
  Package, Building2, X,
} from 'lucide-react';
import { api } from '@/lib/api';
import type { Petition } from '@/types/petition.types';
import { PETITION_STATUS_CONFIG } from '@/types/petition.types';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ICP_LADDA_LOGO_URL } from '@/lib/branding';
import { useAuth } from '@/hooks/useAuth';
import SubmitterPicker, { type SubmitterValues } from '@/components/petition/wizard/SubmitterPicker';
import { petitionDepartmentLabel } from '@/lib/petitionDepartment';
import { presetDelivererFor } from '@/lib/petitionSampler';
import { additionalSamplePayload, extractScannedCode, fetchPetitionByScannedCode, getScannedAdditionalSample, type AdditionalSampleRequest } from '@/lib/additionalSampleQr';
import { additionalSampleWeights } from '@/lib/additionalSamples';

const READER_ID = 'icp-qr-reader';
const ADDITIONAL_READER_ID = 'icp-additional-qr-reader';
const HARDWARE_SCAN_IDLE_MS = 250;
const MIN_HARDWARE_SCAN_LENGTH = 3;
type Phase = 'idle' | 'scanning' | 'confirming' | 'loading' | 'success' | 'error' | 'no-camera';
type AddItemPhase = 'idle' | 'scanning' | 'loading' | 'error' | 'no-camera';

type DeliveryItem = {
  petition: Petition;
  additionalRequest: AdditionalSampleRequest | null;
};

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tagName = target.tagName.toLowerCase();
  return target.isContentEditable || tagName === 'input' || tagName === 'textarea' || tagName === 'select';
}


async function deliverPetition(id: string, actor?: string, request?: AdditionalSampleRequest | null, deliveredBy?: SubmitterValues): Promise<Petition> {
  if (request) {
    const response = await api.patch<Petition>(`/petitions/${id}/deliver`, { actor, deliveredBy, ...additionalSamplePayload(request) });
    return response.data.data;
  }
  try {
    const res = await api.patch<Petition>(`/petitions/${id}/deliver`, { status: 'sampleSent', actor, deliveredBy });
    return res.data.data;
  } catch {
    const res = await api.patch<Petition>(`/petitions/${id}`, { status: 'sampleSent', actor, deliveredBy });
    return res.data.data;
  }
}

export default function ScannerPage() {
  const { user } = useAuth();
  const [phase, setPhase] = useState<Phase>('idle');
  const [petition, setPetition] = useState<Petition | null>(null);
  const [deliveryItems, setDeliveryItems] = useState<DeliveryItem[]>([]);
  const [additionalRequest, setAdditionalRequest] = useState<AdditionalSampleRequest | null>(null);
  const [deliverer, setDeliverer] = useState<SubmitterValues>({ employeeId: '', name: '' });
  const [addItemOpen, setAddItemOpen] = useState(false);
  const [addItemPhase, setAddItemPhase] = useState<AddItemPhase>('idle');
  const [addItemError, setAddItemError] = useState('');
  const [addItemManualCode, setAddItemManualCode] = useState('');
  const scanBusy = useRef(false);
  const deliveryBusy = useRef(false);
  const deliveredRounds = useRef(new Set<string>());
  const [errorMsg, setErrorMsg] = useState('');
  const [manualCode, setManualCode] = useState('');
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const hardwareScanBufferRef = useRef('');
  const hardwareScanTimerRef = useRef<number | null>(null);
  // ผู้นำส่ง = "สุ่มโดย" ที่ฝ่ายผลิตเลือกไว้ (อ่านอย่างเดียว); คำร้องเก่าที่ไม่มีชื่อนี้ต้องเลือกเองแบบเดิม
  const presetDeliverers = deliveryItems.map((item) => presetDelivererFor(item.petition));
  const needsManualDeliverer = presetDeliverers.some((preset) => !preset);
  const presetDelivererNames = Array.from(new Set(presetDeliverers.filter(Boolean).map((preset) => preset.name)));
  const delivererReady = !needsManualDeliverer || Boolean(deliverer.name.trim());

  useEffect(() => {
    if (phase !== 'scanning') return;
    let active = true;

    (async () => {
      const scanner = new Html5Qrcode(READER_ID);
      const config = { fps: 10, qrbox: { width: 250, height: 250 } };
      const onScan = (text: string) => {
        if (!active) return;
        fetchAndConfirm(text);
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
          const back = cameras.find((c) =>
            /back|environment|rear|หลัง|后|背面/i.test(c.label),
          );
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
    // The scanner only lives for the current phase; the callback is intentionally kept out
    // of this effect so queued items do not restart an active camera session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const fetchAndConfirm = useCallback(async (id: string, fromAddItemDialog = false) => {
    const code = extractScannedCode(id);
    if (!code || scanBusy.current) return;
    scanBusy.current = true;
    if (fromAddItemDialog) {
      setAddItemError('');
      setAddItemPhase('loading');
    } else {
      setPhase('loading');
    }
    try {
      const found = await fetchPetitionByScannedCode(code);
      const request = getScannedAdditionalSample(found, code);
      if (request && (request.status === 'sent' || deliveredRounds.current.has(request._id))) {
        throw new Error('ตัวอย่างเพิ่มรอบนี้นำส่งแล้ว ไม่สามารถนำส่งซ้ำได้');
      }
      if (deliveryItems.some((item) => item.petition._id === found._id && item.additionalRequest?._id === request?._id)) {
        throw new Error('รายการนี้อยู่ในคิวแล้ว');
      }
      const item = { petition: found, additionalRequest: request };
      setDeliveryItems((current) => [...current, item]);
      setAdditionalRequest(request ?? null);
      setPetition(found);
      if (fromAddItemDialog) {
        scanBusy.current = false;
        setAddItemManualCode('');
        setAddItemPhase('idle');
        setAddItemOpen(false);
      } else {
        setPhase('confirming');
      }
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data
          ?.message ?? (err instanceof Error ? err.message : 'ไม่พบข้อมูลคำร้อง กรุณาตรวจสอบรหัส');
      scanBusy.current = false;
      if (fromAddItemDialog) {
        setAddItemError(msg);
        setAddItemPhase('error');
      } else {
        setErrorMsg(msg);
        setPhase('error');
      }
    }
  }, [deliveryItems]);

  async function confirmDeliver() {
    if (!deliveryItems.length || !delivererReady || deliveryBusy.current || phase !== 'confirming') return;
    deliveryBusy.current = true;
    setPhase('loading');
    try {
      let lastDelivered: Petition | null = null;
      for (const item of deliveryItems) {
        const itemDeliverer = presetDelivererFor(item.petition) ?? deliverer;
        lastDelivered = await deliverPetition(item.petition._id, user?.name || user?.email, item.additionalRequest, itemDeliverer);
        if (item.additionalRequest) deliveredRounds.current.add(item.additionalRequest._id);
      }
      setPetition(lastDelivered);
      setPhase('success');
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data
          ?.message ?? (err instanceof Error ? err.message : 'เกิดข้อผิดพลาด กรุณาลองใหม่');
      scanBusy.current = false;
      deliveryBusy.current = false;
      setErrorMsg(msg);
      setPhase('error');
    }
  }

  function reset() {
    scanBusy.current = false;
    deliveryBusy.current = false;
    setAdditionalRequest(null);
    setDeliveryItems([]);
    setDeliverer({ employeeId: '', name: '' });
    setPetition(null);
    setErrorMsg('');
    setManualCode('');
    setAddItemOpen(false);
    setAddItemPhase('idle');
    setAddItemError('');
    setAddItemManualCode('');
    setPhase('idle');
  }

  function addAnotherDelivery() {
    scanBusy.current = false;
    setAddItemError('');
    setAddItemManualCode('');
    setAddItemPhase('idle');
    setAddItemOpen(true);
  }

  useEffect(() => {
    const acceptingScan = phase === 'idle' || phase === 'no-camera' || phase === 'error';

    const clearHardwareScanBuffer = () => {
      hardwareScanBufferRef.current = '';
      if (hardwareScanTimerRef.current) {
        window.clearTimeout(hardwareScanTimerRef.current);
        hardwareScanTimerRef.current = null;
      }
    };

    if (!acceptingScan) {
      clearHardwareScanBuffer();
      return undefined;
    }

    const scheduleBufferClear = () => {
      if (hardwareScanTimerRef.current) window.clearTimeout(hardwareScanTimerRef.current);
      hardwareScanTimerRef.current = window.setTimeout(clearHardwareScanBuffer, HARDWARE_SCAN_IDLE_MS);
    };

    const handleHardwareScannerKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isEditableTarget(event.target)) return;

      if (event.key === 'Enter') {
        const code = hardwareScanBufferRef.current.trim();
        clearHardwareScanBuffer();
        if (code.length >= MIN_HARDWARE_SCAN_LENGTH) {
          event.preventDefault();
          fetchAndConfirm(code);
        }
        return;
      }

      if (event.ctrlKey || event.altKey || event.metaKey || event.key.length !== 1) return;
      hardwareScanBufferRef.current += event.key;
      scheduleBufferClear();
    };

    window.addEventListener('keydown', handleHardwareScannerKeyDown);
    return () => {
      window.removeEventListener('keydown', handleHardwareScannerKeyDown);
      clearHardwareScanBuffer();
    };
  }, [phase, fetchAndConfirm]);

  useEffect(() => {
    if (!addItemOpen || addItemPhase !== 'scanning') return;
    let active = true;
    const scanner = new Html5Qrcode(ADDITIONAL_READER_ID);
    const config = { fps: 10, qrbox: { width: 250, height: 250 } };
    const onScan = (text: string) => {
      if (active) fetchAndConfirm(text, true);
    };
    const startWith = (source: MediaTrackConstraints | string) =>
      scanner.start(source, config, onScan, () => {});

    (async () => {
      try {
        try {
          await startWith({ facingMode: { exact: 'environment' } });
        } catch {
          const cameras = await Html5Qrcode.getCameras();
          if (cameras.length === 0) {
            if (active) setAddItemPhase('no-camera');
            return;
          }
          const back = cameras.find((camera) => /back|environment|rear|หลัง|后|背面/i.test(camera.label));
          await startWith((back ?? (cameras.length > 1 ? cameras[cameras.length - 1] : cameras[0])).id);
        }
        if (!active) {
          scanner.stop().catch(() => {});
        }
      } catch {
        if (active) {
          setAddItemError('เปิดกล้องไม่ได้ — กรอกเลขคำร้องเองได้เลย');
          setAddItemPhase('no-camera');
        }
      }
    })();

    return () => {
      active = false;
      try {
        const state = scanner.getState();
        if (state === Html5QrcodeScannerState.SCANNING || state === Html5QrcodeScannerState.PAUSED) {
          scanner.stop().catch(() => {});
        }
      } catch { /* ignore */ }
    };
  }, [addItemOpen, addItemPhase, fetchAndConfirm]);

  const targetStatusCfg = PETITION_STATUS_CONFIG.sampleSent;

  return (
    <div className="min-h-screen bg-grey-50 flex flex-col items-center py-8 px-4">
      <div className="mb-6 text-center">
        <img
          src={ICP_LADDA_LOGO_URL}
          alt="ICP Ladda"
          className="h-10 mx-auto mb-3"
        />
        <div className="flex items-center gap-2 justify-center">
          <QrCode className="w-5 h-5 text-primary-500" />
          <h1 className="text-lg font-bold text-black-500">ส่งตัวอย่าง</h1>
        </div>
        <p className="mt-2 text-xs text-grey-500">
          ยิง QR Code ด้วยเครื่องสแกนเนอร์ได้ทันทีโดยไม่ต้องคลิกช่องเลขคำร้อง หรือกดปุ่มเพื่อใช้กล้อง
        </p>
      </div>

      <div className={`w-full max-w-sm mb-4 ${phase === 'scanning' ? 'block' : 'hidden'}`}>
        <div id={READER_ID} className="w-full rounded-xl overflow-hidden border border-grey-200" />
        <button
          onClick={reset}
          className="mt-3 w-full flex items-center justify-center gap-1.5 text-sm text-grey-500 hover:text-grey-700 transition-colors"
        >
          <X className="w-4 h-4" />
          ยกเลิกการสแกน
        </button>
      </div>
      {phase !== 'scanning' && <div id={READER_ID} className="hidden" />}

      <div className="w-full max-w-sm space-y-4">

        {(phase === 'idle' || phase === 'no-camera') && (
          <>
            {phase === 'idle' && (
              <Button
                variant="primary"
                className="w-full flex items-center gap-2 justify-center"
                onClick={() => setPhase('scanning')}
              >
                <QrCode className="w-4 h-4" />
                สแกน QR Code
              </Button>
            )}

            {phase === 'no-camera' && (
              <p className="text-center text-xs text-grey-400">
                {errorMsg || 'ไม่พบกล้องในอุปกรณ์นี้'}
              </p>
            )}

            {/* กรอกเลขคำร้องเอง — ใช้เมื่อไม่มีกล้อง/ไม่อยากสแกน */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const code = manualCode.trim();
                if (!code) return;
                setManualCode('');
                fetchAndConfirm(code);
              }}
              className="space-y-2"
            >
              <div className="flex items-center gap-2 text-xs text-grey-400">
                <div className="h-px flex-1 bg-grey-200" />
                <span>หรือ</span>
                <div className="h-px flex-1 bg-grey-200" />
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={manualCode}
                  onChange={(e) => setManualCode(e.target.value)}
                  placeholder="พิมพ์เลขที่คำร้อง เช่น P-2506-0001"
                  className="flex-1 rounded-lg border border-grey-200 px-3 py-2 text-sm outline-none focus:border-primary-400"
                />
                <Button type="submit" variant="primary" disabled={!manualCode.trim()}>
                  ค้นหา
                </Button>
              </div>
            </form>
          </>
        )}

        {phase === 'scanning' && (
          <p className="text-center text-sm text-grey-500">
            วางกล้องให้เห็น QR Code บนหน้าจอ
          </p>
        )}

        {phase === 'loading' && (
          <p className="text-center text-sm text-grey-400 animate-pulse">
            กำลังดำเนินการ...
          </p>
        )}

        {phase === 'confirming' && petition && (
          <div className="rounded-xl border border-primary-200 bg-white shadow-sm overflow-hidden">
            <div className="bg-primary-500 px-4 py-3 flex items-center gap-2">
              <Package className="w-4 h-4 text-white" />
              <span className="text-white font-semibold text-sm">ตรวจสอบคำร้องก่อนยืนยัน</span>
            </div>

            <div className="p-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-base font-bold text-black-500">รายการที่จะส่ง</p>
                  <p className="text-xs text-grey-500">ทั้งหมด {deliveryItems.length} ตัวอย่าง</p>
                </div>
                <Badge variant={targetStatusCfg.variant}>{targetStatusCfg.label}</Badge>
              </div>

              <div className="border-t border-grey-100" />

              <div className="max-h-56 space-y-2 overflow-y-auto rounded-lg bg-grey-50 p-3">
                {deliveryItems.map(({ petition: queuedPetition, additionalRequest: queuedRequest }, index) => (
                  <div key={`${queuedPetition._id}-${queuedRequest?._id ?? 'base'}`} className="flex gap-2 text-sm">
                    <span className="font-semibold text-grey-500">{index + 1}.</span>
                    <div className="min-w-0">
                      <p className="font-medium text-black-500">{queuedPetition.petitionNo}</p>
                      <p className="truncate text-xs text-grey-500">{queuedPetition.submittedBy?.name ?? '-'}</p>
                      {queuedRequest && <p className="text-xs text-grey-500">ตัวอย่างเพิ่ม · {queuedRequest.side.toUpperCase()}</p>}
                    </div>
                  </div>
                ))}
              </div>

              {additionalRequest && deliveryItems.length === 1 && (
                <div className="rounded-lg border bg-card p-3 text-sm text-foreground space-y-1">
                  <p className="font-semibold">ตัวอย่างเพิ่ม · {additionalRequest.side.toUpperCase()} · รอบ {petition.additionalSampleRequests?.findIndex((request) => request._id === additionalRequest._id) + 1}</p>
                  <p className="whitespace-pre-wrap break-words">{additionalRequest.reason}</p>
                  {additionalRequest.items.map((item) => <p key={item.itemSeq}>{petition.items.find((entry) => entry.seq === item.itemSeq)?.sampleName || `รายการ ${item.itemSeq}`} · {additionalSampleWeights(item).length} ตัวอย่าง · น้ำหนัก {additionalSampleWeights(item).map((weight) => `${weight} กรัม`).join(', ')}</p>)}
                </div>
              )}

              {presetDelivererNames.length > 0 && (
                <div className="rounded-lg border bg-card p-3 text-sm">
                  <p className="text-xs text-muted-foreground">ผู้นำส่ง (สุ่มโดย จากฝ่ายผลิต)</p>
                  <p data-testid="scanner-preset-deliverer" className="font-semibold text-foreground">{presetDelivererNames.join(', ')}</p>
                </div>
              )}
              {needsManualDeliverer && <SubmitterPicker value={deliverer} onChange={setDeliverer} />}

              <div className="flex gap-2 text-sm">
                <Building2 className="w-4 h-4 text-grey-400 mt-0.5 shrink-0" />
                <span className="text-grey-600">{petitionDepartmentLabel(petition)}</span>
              </div>

              {!additionalRequest && petition.items.length > 0 && (
                <div className="bg-grey-50 rounded-lg p-3 space-y-1">
                  <p className="text-xs font-medium text-grey-500 mb-1.5">
                    รายการตัวอย่าง ({petition.items.length} รายการ)
                  </p>
                  {petition.items.slice(0, 3).map((item, i) => (
                    <p key={i} className="text-xs text-black-500">
                      {i + 1}. {item.sampleName}
                      {item.batchNo && (
                        <span className="text-grey-400 ml-1">Lot: {item.batchNo}</span>
                      )}
                    </p>
                  ))}
                  {petition.items.length > 3 && (
                    <p className="text-xs text-grey-400">+{petition.items.length - 3} รายการ</p>
                  )}
                </div>
              )}

              <div className="border-t border-grey-100" />

              <div className="flex gap-2 pt-1">
                <Button variant="danger" className="flex-1" onClick={reset}>
                  ยกเลิก
                </Button>
                <Button variant="outline" className="flex-1" onClick={addAnotherDelivery}>
                  เพิ่มรายการ
                </Button>
                <Button
                  variant="success"
                  className="flex-1 flex items-center gap-1.5 justify-center"
                  onClick={confirmDeliver}
                  disabled={!delivererReady}
                >
                  {deliveryItems.length === 1 ? 'ยืนยัน' : `ยืนยันส่ง ${deliveryItems.length} รายการ`}
                </Button>
              </div>
            </div>
          </div>
        )}

        <Dialog
          open={addItemOpen}
          onOpenChange={(open) => {
            setAddItemOpen(open);
            if (!open) {
              setAddItemPhase('idle');
              setAddItemError('');
              setAddItemManualCode('');
            }
          }}
        >
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <QrCode className="h-5 w-5 text-primary-500" />
                เพิ่มรายการส่งตัวอย่าง
              </DialogTitle>
              <DialogDescription>
                สแกน QR Code หรือกรอกเลขที่คำร้องเพื่อเพิ่มรายการเข้าคิว
              </DialogDescription>
            </DialogHeader>

            {addItemPhase === 'scanning' ? (
              <div className="space-y-3">
                <div id={ADDITIONAL_READER_ID} className="w-full overflow-hidden rounded-lg border border-border" />
                <p className="text-center text-sm text-muted-foreground">วางกล้องให้เห็น QR Code บนหน้าจอ</p>
                <Button variant="outline" className="w-full" onClick={() => setAddItemPhase('idle')}>
                  กรอกเลขที่คำร้องแทน
                </Button>
              </div>
            ) : (
              <form
                className="space-y-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  const code = addItemManualCode.trim();
                  if (!code) return;
                  fetchAndConfirm(code, true);
                }}
              >
                <Button
                  type="button"
                  variant="primary"
                  className="w-full flex items-center justify-center gap-2"
                  onClick={() => {
                    setAddItemError('');
                    setAddItemPhase('scanning');
                  }}
                  disabled={addItemPhase === 'loading'}
                >
                  <QrCode className="h-4 w-4" />
                  สแกน QR Code
                </Button>

                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <div className="h-px flex-1 bg-border" />
                  <span>หรือ</span>
                  <div className="h-px flex-1 bg-border" />
                </div>

                <div className="flex gap-2">
                  <input
                    autoFocus
                    value={addItemManualCode}
                    onChange={(event) => setAddItemManualCode(event.target.value)}
                    placeholder="พิมพ์เลขที่คำร้อง เช่น P-2506-0001"
                    className="min-w-0 flex-1 rounded-lg border border-border px-3 py-2 text-sm outline-none focus:border-primary-400"
                    disabled={addItemPhase === 'loading'}
                  />
                  <Button type="submit" variant="primary" disabled={!addItemManualCode.trim() || addItemPhase === 'loading'}>
                    {addItemPhase === 'loading' ? 'กำลังค้นหา...' : 'ค้นหา'}
                  </Button>
                </div>

                {(addItemPhase === 'error' || addItemPhase === 'no-camera') && (
                  <p className="text-sm text-destructive">{addItemError || 'ไม่พบกล้องในอุปกรณ์นี้'}</p>
                )}
              </form>
            )}
          </DialogContent>
        </Dialog>

        {phase === 'success' && petition && (
          <div className="rounded-xl border border-green-200 bg-green-50 p-6 text-center space-y-3">
            <CheckCircle2 className="w-16 h-16 text-green-500 mx-auto" />
            <p className="text-2xl font-bold text-green-700">ส่งตัวอย่างแล้ว</p>
            <div className="flex justify-center">
              <Badge variant={targetStatusCfg.variant}>{targetStatusCfg.label}</Badge>
            </div>
            <p className="text-sm text-grey-500">
              คำร้องเลขที่{' '}
              <span className="font-semibold text-black-500">{petition.petitionNo}</span>
            </p>
            <p className="text-xs text-grey-400">
              {petition.deliveredBy?.name || deliverer.name || '-'} · {petitionDepartmentLabel(petition)}
            </p>
            <Button variant="primary" className="mt-2 w-full" onClick={reset}>
              สแกนคำร้องถัดไป
            </Button>
          </div>
        )}

        {phase === 'error' && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center space-y-3">
            <AlertCircle className="w-12 h-12 text-red-400 mx-auto" />
            <p className="text-red-600 font-medium">{errorMsg || 'เกิดข้อผิดพลาด'}</p>
            <Button variant="primary" className="w-full" onClick={reset}>
              ลองใหม่
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
