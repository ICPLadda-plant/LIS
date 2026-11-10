import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Html5Qrcode, Html5QrcodeScannerState } from 'html5-qrcode';
import { AlertCircle, CheckCircle2, Keyboard, QrCode, X } from 'lucide-react';
import { api } from '@/lib/api';
import type { Petition } from '@/types/petition.types';
import { PETITION_STATUS_CONFIG } from '@/types/petition.types';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { useAuth } from '@/hooks/useAuth';
import { petitionDepartmentLabel } from '@/lib/petitionDepartment';
import { normalizeRoles } from '@/lib/roles';
import { additionalSamplePayload, extractScannedCode, extractScannedItemSeq, fetchPetitionByScannedCode, getScannedAdditionalSample, type AdditionalSampleRequest } from '@/lib/additionalSampleQr';
import { labelReceiptStatus, pickScannedLabels, type SideLabel } from '@/lib/labelReceipt';
import PendingPetitionSelect from '@/components/petition/PendingPetitionSelect';
import LabelReceiptPicker from '@/components/petition/LabelReceiptPicker';

const READER_ID = 'qc-receive-qr-reader';
type Phase = 'scanning' | 'confirming' | 'loading' | 'success' | 'error' | 'no-camera';

interface ReceivedRow {
  scanKey: string;
  _id: string;
  petitionNo: string;
  dept: Petition['dept'];
  submittedBy?: Petition['submittedBy'];
  itemCount: number;
  /** เลขป้ายที่รับรอบนี้ (คำขอที่รับทีละป้าย) */
  labels?: string;
  /** QC รับครบทั้งคำขอแล้ว */
  complete: boolean;
}


async function receivePetition(id: string, actor?: string, request?: AdditionalSampleRequest | null, labelKeys?: string[]): Promise<Petition> {
  const res = await api.patch<Petition>(`/petitions/${id}/receive`, { actor, side: 'qc', ...additionalSamplePayload(request), ...(labelKeys?.length ? { labelKeys } : {}) });
  return res.data.data;
}

function apiErrorMessage(err: unknown, fallback: string): string {
  const data = (err as { response?: { data?: unknown } })?.response?.data;
  if (data && typeof data === 'object') {
    const direct = (data as { message?: unknown }).message;
    if (typeof direct === 'string' && direct.trim()) return direct;
    const nested = (data as { error?: { message?: unknown } }).error?.message;
    if (typeof nested === 'string' && nested.trim()) return nested;
  }
  const message = (err as { message?: unknown })?.message;
  return typeof message === 'string' && message.trim() ? message : fallback;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onReceived: () => void;
  /** โหมดกรอกเลขคำร้องอย่างเดียว (ไม่เปิดกล้อง) — ใช้กับปุ่ม "กรอกเลขรับตัวอย่าง" */
  manualOnly?: boolean;
  /** คำร้องที่รอรับ — ถ้าส่งมาจะแสดง Dropdown ให้เลือกแทนการพิมพ์/สแกน */
  pendingPetitions?: Petition[];
}

export default function QrReceiveModal({ open, onClose, onReceived, manualOnly = false, pendingPetitions }: Props) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [phase, setPhase] = useState<Phase>('scanning');
  const [petition, setPetition] = useState<Petition | null>(null);
  const [pendingId, setPendingId] = useState('');
  const [additionalRequest, setAdditionalRequest] = useState<AdditionalSampleRequest | null>(null);
  const [labelChoices, setLabelChoices] = useState<SideLabel[] | null>(null);
  const [labelKeys, setLabelKeys] = useState<string[]>([]);
  const [receiptText, setReceiptText] = useState('');
  const scanBusy = useRef(false);
  const receiveBusy = useRef(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [continuousMode, setContinuousMode] = useState(true);
  const [receivedList, setReceivedList] = useState<ReceivedRow[]>([]);
  const [flashMsg, setFlashMsg] = useState<string | null>(null);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const flashTimer = useRef<number | null>(null);
  const [manualCode, setManualCode] = useState('');

  // Reset state when modal opens
  useEffect(() => {
    if (open) {
      scanBusy.current = false;
      receiveBusy.current = false;
      setAdditionalRequest(null);
      setLabelChoices(null);
      setLabelKeys([]);
      setReceiptText('');
      setPhase('scanning');
      setPetition(null);
      setPendingId('');
      setErrorMsg('');
      setReceivedList([]);
      setFlashMsg(null);
      setManualCode('');
    }
  }, [open]);

  // Clear pending flash timer on unmount / close
  useEffect(() => {
    return () => {
      if (flashTimer.current) {
        window.clearTimeout(flashTimer.current);
        flashTimer.current = null;
      }
    };
  }, []);

  // Start camera when in scanning phase (ไม่เปิดกล้องในโหมด manualOnly)
  useEffect(() => {
    if (!open || phase !== 'scanning' || manualOnly) return;
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
  }, [open, phase, manualOnly]);

  async function fetchAndConfirm(rawCode: string) {
    const code = extractScannedCode(rawCode);
    if (!code || scanBusy.current) return;
    scanBusy.current = true;
    setPendingId(code);
    setPhase('loading');
    try {
      const found = await fetchPetitionByScannedCode(code);
      const request = getScannedAdditionalSample(found, code, 'qc');
      if (request && !normalizeRoles(user).some((role) => ['admin', 'qc-head', 'qc-staff'].includes(role))) {
        throw new Error('คุณไม่มีสิทธิ์รับตัวอย่างฝั่ง QC');
      }
      setAdditionalRequest(request ?? null);
      setLabelChoices(null);
      setLabelKeys([]);
      const labelPick = request ? null : pickScannedLabels(found, 'qc', extractScannedItemSeq(rawCode));
      if (labelPick && 'error' in labelPick) {
        setPetition(found);
        setErrorMsg(`${found.petitionNo}: ${labelPick.error}`);
        setPhase('error');
        return;
      }
      // Dedup: skip if already received in this session
      if (!labelPick && receivedList.some((row) => row.scanKey === (request?._id || found._id))) {
        setPetition(found);
        setErrorMsg(`คำร้อง ${found.petitionNo} รับไปแล้วใน session นี้`);
        setPhase('error');
        return;
      }
      setPetition(found);
      setPendingId(found._id);
      // QC รับไปแล้ว → กันรับซ้ำ (status อาจ pendingReview จากฝั่ง Lab รับก่อน จึงเช็คที่ qcReceivedAt)
      if (!request && found.qcReceivedAt) {
        setErrorMsg(`คำร้องนี้รับฝั่ง QC ไปแล้ว — ไม่สามารถรับซ้ำได้`);
        setPhase('error');
        return;
      }
      // ปิดงานแล้ว → รับไม่ได้
      if (!request && ['success', 'approved', 'rejected'].includes(found.status)) {
        setErrorMsg(`คำร้องนี้สถานะ "${PETITION_STATUS_CONFIG[found.status]?.label ?? found.status}" — ไม่สามารถรับตัวอย่างได้`);
        setPhase('error');
        return;
      }
      if (labelPick && 'labels' in labelPick) {
        setLabelChoices(labelPick.labels);
        setLabelKeys(labelPick.keys);
      }
      setPhase('confirming');
    } catch (err: unknown) {
      setErrorMsg(apiErrorMessage(err, 'ไม่พบข้อมูลคำร้อง'));
      setPhase('error');
    }
  }

  function showFlash(msg: string) {
    setFlashMsg(msg);
    if (flashTimer.current) window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => {
      setFlashMsg(null);
      flashTimer.current = null;
    }, 1500);
  }

  async function confirmReceive() {
    const id = petition?._id || pendingId;
    if (!id || receiveBusy.current || phase !== 'confirming' || (labelChoices && !labelKeys.length)) return;
    receiveBusy.current = true;
    setPhase('loading');
    try {
      const received = await receivePetition(id, user?.name || user?.email, additionalRequest, labelChoices ? labelKeys : undefined);
      const pickedLabels = labelChoices?.filter((label) => labelKeys.includes(label.key)).map((label) => label.label).join(', ');
      const status = labelChoices ? labelReceiptStatus(labelChoices, labelKeys) : null;
      onReceived();
      if (continuousMode) {
        setReceivedList((prev) => [
          {
            scanKey: additionalRequest?._id || (labelChoices ? `${received._id}:${labelKeys.join(',')}` : received._id),
            _id: received._id,
            petitionNo: received.petitionNo,
            dept: received.dept,
            submittedBy: received.submittedBy,
            itemCount: received.items?.length ?? 0,
            labels: pickedLabels,
            complete: !!received.qcReceivedAt,
          },
          ...prev,
        ]);
        showFlash(`รับแล้ว: ${received.petitionNo}${pickedLabels ? ` · ${pickedLabels}` : ''}${status && !status.complete ? ` (${status.text})` : ''}`);
        // Reset back to scanning so camera re-engages
        setPetition(null);
        setPendingId('');
        setErrorMsg('');
        scanBusy.current = false;
        receiveBusy.current = false;
        setAdditionalRequest(null);
        setLabelChoices(null);
        setLabelKeys([]);
        setPhase('scanning');
      } else {
        setPetition(received);
        setReceiptText(status ? `${pickedLabels} · ${status.text}` : '');
        setPhase('success');
        // Navigate to detail page so QC can start entering values (รับครบทุกป้ายแล้วเท่านั้น)
        if (received.qcReceivedAt) navigate(`/qc-testing/${received._id}`);
      }
    } catch (err: unknown) {
      setErrorMsg(apiErrorMessage(err, 'เกิดข้อผิดพลาด กรุณาลองใหม่'));
      setPhase('error');
    }
  }

  function rescan() {
    scanBusy.current = false;
    receiveBusy.current = false;
    setAdditionalRequest(null);
    setLabelChoices(null);
    setLabelKeys([]);
    setReceiptText('');
    setPetition(null);
    setPendingId('');
    setErrorMsg('');
    setPhase('scanning');
  }

  if (!open) return null;

  const targetStatusCfg = PETITION_STATUS_CONFIG.pendingReview;
  const receivedKeys = new Set(receivedList.filter((row) => row.complete).map((row) => row._id));
  const selectablePetitions = pendingPetitions?.filter((p) => !receivedKeys.has(p._id));
  const labelStatus = labelChoices ? labelReceiptStatus(labelChoices, labelKeys) : null;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl w-full max-w-md max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-3 border-b">
          <div className="flex items-center gap-2">
            {manualOnly ? (
              <Keyboard className="h-5 w-5 text-primary-500" />
            ) : (
              <QrCode className="h-5 w-5 text-primary-500" />
            )}
            <h2 className="text-base font-bold">
              {manualOnly ? 'กรอกเลขรับตัวอย่าง' : 'สแกน QR รับตัวอย่าง'}
            </h2>
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-xs text-grey-600 cursor-pointer">
              <span>{manualOnly ? 'รับต่อเนื่อง' : 'สแกนต่อเนื่อง'}</span>
              <Switch checked={continuousMode} onCheckedChange={setContinuousMode} />
            </label>
            <button onClick={onClose} className="text-grey-400 hover:text-grey-700">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {flashMsg && (
          <div className="bg-green-100 border-b border-green-200 px-5 py-2 text-sm text-green-700 flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4" />
            {flashMsg}
          </div>
        )}

        <div className="p-5 space-y-4">
          {/* Camera reader element — must stay mounted while scanning (ไม่ใช้ในโหมด manualOnly) */}
          <div className={phase === 'scanning' && !manualOnly ? 'block' : 'hidden'}>
            <div id={READER_ID} className="w-full rounded-lg overflow-hidden border" />
            <p className="mt-2 text-center text-sm text-grey-500">
              เล็งกล้องไปที่ QR Code บนใบคำร้องเพื่อรับตัวอย่าง
            </p>
          </div>
          {phase !== 'scanning' && <div id={READER_ID} className="hidden" />}

          {phase === 'loading' && (
            <p className="text-center text-sm text-grey-400 animate-pulse">
              กำลังดำเนินการ...
            </p>
          )}

          {phase === 'no-camera' && (
            <p className="text-center text-sm text-grey-500">{errorMsg || 'ไม่พบกล้องในอุปกรณ์นี้'}</p>
          )}

          {(phase === 'scanning' || phase === 'no-camera') && (
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
              {selectablePetitions && (
                <PendingPetitionSelect petitions={selectablePetitions} onPick={(code) => { void fetchAndConfirm(code); }} />
              )}
              {!manualOnly && (
                <div className="flex items-center gap-2 text-xs text-grey-400">
                  <div className="h-px flex-1 bg-grey-200" />
                  <span>หรือ</span>
                  <div className="h-px flex-1 bg-grey-200" />
                </div>
              )}
              <div className="flex gap-2">
                <input
                  type="text"
                  value={manualCode}
                  onChange={(e) => setManualCode(e.target.value)}
                  placeholder="พิมพ์เลขที่คำร้อง เช่น P-2506-0001"
                  autoFocus={manualOnly}
                  className="flex-1 rounded-lg border border-grey-200 px-3 py-2 text-sm outline-none focus:border-primary-400"
                />
                <Button type="submit" variant="primary" disabled={!manualCode.trim()}>
                  รับตัวอย่าง
                </Button>
              </div>
            </form>
          )}

          {phase === 'confirming' && petition && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-lg font-bold">{petition.petitionNo}</span>
                {labelStatus && !labelStatus.complete
                  ? <Badge variant="yellow-soft">{labelStatus.text}</Badge>
                  : <Badge variant={targetStatusCfg.variant}>→ {targetStatusCfg.label}</Badge>}
              </div>
              <div className="text-sm space-y-1 text-grey-600">
                {additionalRequest && <p className="font-semibold text-foreground">ตัวอย่างเพิ่ม · QC · {additionalRequest.reason}</p>}
                <p>ผู้นำส่ง: <span className="text-black-500">{petition.submittedBy?.name ?? '-'}</span></p>
                <p>แผนก: <span className="text-black-500">{petitionDepartmentLabel(petition)}</span></p>
                <p>จำนวน: <span className="text-black-500">{petition.items.length} รายการ</span></p>
              </div>
              {labelChoices && <LabelReceiptPicker labels={labelChoices} selected={labelKeys} onChange={setLabelKeys} />}
              <div className="flex gap-2 pt-2">
                <Button variant="ghost" className="flex-1" onClick={rescan}>
                  {manualOnly ? 'กรอกใหม่' : 'สแกนใหม่'}
                </Button>
                <Button variant="primary" className="flex-1" onClick={confirmReceive} disabled={!!labelChoices && !labelKeys.length}>
                  ยืนยันรับตัวอย่าง
                </Button>
              </div>
            </div>
          )}

          {phase === 'success' && petition && (
            <div className="rounded-lg border border-green-200 bg-green-50 p-5 text-center space-y-3">
              <CheckCircle2 className="w-12 h-12 text-green-500 mx-auto" />
              <p className="text-lg font-bold text-green-700">รับตัวอย่างแล้ว</p>
              <p className="text-sm text-grey-600">
                <span className="font-semibold">{petition.petitionNo}</span>
              </p>
              {receiptText && <p className="text-sm text-grey-600">{receiptText}</p>}
              <div className="flex gap-2 pt-1">
                <Button variant="ghost" className="flex-1" onClick={rescan}>
                  {manualOnly ? 'รับต่อ' : 'สแกนต่อ'}
                </Button>
                <Button variant="primary" className="flex-1" onClick={onClose}>
                  เสร็จสิ้น
                </Button>
              </div>
            </div>
          )}

          {phase === 'error' && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-5 text-center space-y-3">
              <AlertCircle className="w-10 h-10 text-red-400 mx-auto" />
              <p className="text-red-600 text-sm">{errorMsg || 'เกิดข้อผิดพลาด'}</p>
              <Button variant="primary" className="w-full" onClick={rescan}>
                ลองใหม่
              </Button>
            </div>
          )}

          {receivedList.length > 0 && (
            <div className="border-t pt-4 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-grey-500 uppercase tracking-wide">
                  รับแล้วใน session นี้
                </p>
                <Badge variant="blue-soft">{receivedList.length}</Badge>
              </div>
              <ul className="space-y-1 max-h-40 overflow-y-auto">
                {receivedList.map((r) => (
                  <li
                    key={r.scanKey}
                    className="flex items-center justify-between gap-2 rounded-md bg-grey-50 px-3 py-2 text-sm"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
                      <span className="font-semibold text-primary-500">{r.petitionNo}</span>
                      {r.labels && <span className="text-xs font-semibold">{r.labels}</span>}
                      <span className="text-xs text-grey-500 truncate">
                        {petitionDepartmentLabel(r)} · {r.itemCount} รายการ
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
              <Button variant="primary" className="w-full mt-2" onClick={onClose}>
                เสร็จสิ้น ({receivedList.length})
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
