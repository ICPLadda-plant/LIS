import { useState } from 'react';
import { Printer } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import PrintPreviewDialog from '@/components/lis/PrintPreviewDialog';
import { useAuth } from '@/hooks/useAuth';
import { canPrintAdditionalSamples } from '@/lib/additionalSampleQr';
import { formatDateTime } from '@/lib/dateTime';
import { additionalSampleWeights } from '@/lib/additionalSamples';
import { normalizeRoles } from '@/lib/roles';
import type { Petition, QCTestResult } from '@/types/petition.types';
import SampleLabelPrintTemplate from './SampleLabelPrintTemplate';

const statusLabels = { requested: 'รอนำส่ง', sent: 'นำส่งแล้ว รอรับ', received: 'รับแล้ว' };

function timestamp(value?: string) {
  return formatDateTime(value, 'ยังไม่มี');
}

function displayValue(value: unknown): string {
  if (value == null || value === '') return '-';
  if (Array.isArray(value)) return value.map(displayValue).join(', ');
  if (typeof value === 'object') return Object.entries(value).map(([label, entry]) => `${label}: ${displayValue(entry)}`).join(', ');
  return String(value);
}

export default function AdditionalSampleRequests({ petition }: { petition: Petition }) {
  const { user } = useAuth();
  const [printTarget, setPrintTarget] = useState<string | null>(null);
  const requests = petition.additionalSampleRequests ?? [];
  const canPrint = canPrintAdditionalSamples(petition, user);
  const canSeeResults = normalizeRoles(user).some((role) => ['admin', 'qc-head', 'qc-staff', 'lab-head', 'lab-analyze'].includes(role));
  const selected = requests.find((request) => request._id === printTarget);
  if (!requests.length) return null;

  return (
    <Card>
      <CardHeader><CardTitle className="text-base font-semibold text-foreground">ตัวอย่างเพิ่มและประวัติการนำส่ง</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        {requests.map((request, index) => (
          <section key={request._id} className="rounded-lg border bg-card p-4 space-y-3" aria-label={`ตัวอย่างเพิ่มรอบ ${index + 1}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-base font-semibold text-foreground">รอบ {index + 1} · {request.side.toUpperCase()}</h3>
              <Badge variant={request.status === 'received' ? 'secondary' : 'outline'}>{statusLabels[request.status]}</Badge>
            </div>
            <p className="text-sm whitespace-pre-wrap break-words">เหตุผล: {request.reason}</p>
            <ul className="space-y-1 text-sm">
              {request.items.map((selectedItem) => <li key={selectedItem.itemSeq} className="break-words">
                {petition.items.find((item) => item.seq === selectedItem.itemSeq)?.sampleName || `รายการ ${selectedItem.itemSeq}`} · {additionalSampleWeights(selectedItem).length} ตัวอย่าง · น้ำหนัก {additionalSampleWeights(selectedItem).map((weight) => `${weight} กรัม`).join(', ')}
              </li>)}
            </ul>
            <div className="grid gap-2 text-sm text-muted-foreground sm:grid-cols-3">
              <p>ขอเพิ่มเมื่อ: {timestamp(request.requestedAt)} · {request.requestedBy.name}</p>
              <p>นำส่งเมื่อ: {timestamp(request.sentAt)}</p>
              <p>รับเมื่อ: {timestamp(request.receivedAt)}{request.receivedBy?.name && ` · ${request.receivedBy.name}`}</p>
            </div>
            {request.status !== 'received' && <p className="text-sm text-muted-foreground">ใช้ QR บนฉลากตัวอย่างเพิ่มรอบนี้เท่านั้น ไม่ใช้ QR เดิมรับแทน</p>}
            {canPrint && request.qrCode && (
              <div className="flex flex-wrap gap-2">
                <Button variant="default" size="sm" onClick={() => setPrintTarget(request._id)}><Printer className="h-4 w-4" />พิมพ์ฉลากตัวอย่างเพิ่ม</Button>
              </div>
            )}
            {canSeeResults && !!request.previousResults?.length && (
              <details className="rounded-lg border p-3 text-sm">
                <summary className="cursor-pointer font-medium">ผลก่อนขอเพิ่ม (สำเนา)</summary>
                <p className="mt-2 text-muted-foreground">เพื่อดูประวัติเท่านั้น ไม่ใช้ยืนยันผลรอบใหม่</p>
                <div className="mt-3 space-y-3">
                  {(request.previousResults as QCTestResult[]).map((result, resultIndex) => (
                    <div key={result._id || resultIndex} className="space-y-1">
                      <p className="font-medium">{result.parameterName || result.parameterId}</p>
                      <p>{result.sampleName || petition.items.find((item) => item.seq === result.itemSeq)?.sampleName || `รายการ ${result.itemSeq}`}</p>
                      {[result.values, ...(result.entries ?? []), ...(result.valuesPhase2 ? [result.valuesPhase2] : [])].map((values, valueIndex) => (
                        <dl key={valueIndex} className="grid grid-cols-2 gap-x-3 gap-y-1">
                          {Object.entries(values ?? {}).map(([field, value]) => <div key={field} className="contents"><dt className="break-words text-muted-foreground">{field}</dt><dd className="break-words">{displayValue(value)}</dd></div>)}
                        </dl>
                      ))}
                      <p className="text-muted-foreground">บันทึกเมื่อ: {timestamp(result.enteredAt)}{result.enteredBy?.name && ` · ${result.enteredBy.name}`}</p>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </section>
        ))}
      </CardContent>
      {canPrint && selected && <PrintPreviewDialog open onOpenChange={(open) => { if (!open) setPrintTarget(null); }} docType="sample-label">
        <SampleLabelPrintTemplate petition={petition} additionalSampleRequest={selected} />
      </PrintPreviewDialog>}
    </Card>
  );
}
