import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Calculator, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import {
  computeLimits,
  formatControlNumber,
  formatSd,
  validateBalanceControlInput,
  type BalanceControlConfig,
  type BalanceControlConfigInput,
  type BalanceScale,
} from "@/lib/balanceControlChart";

// ตั้งค่าค่า Control (Mean / STD) ของเครื่องชั่ง 1 เครื่อง แล้วแสดงเส้น UWL/LWL/UCL/LCL ที่จะได้ทันที

interface FormState {
  mean: string;
  sd: string;
  nominal: string;
  mpe: string;
  weightCode: string;
  updatedDate: string;
  brand: string;
  model: string;
}

const numText = (value: number | null | undefined) => (value == null ? "" : String(value));

const toForm = (config: BalanceControlConfig): FormState => ({
  mean: numText(config.mean),
  sd: numText(config.sd),
  nominal: numText(config.nominal),
  mpe: numText(config.mpe),
  weightCode: config.weightCode,
  updatedDate: config.updatedDate,
  brand: config.brand,
  model: config.model,
});

/** "" → null, ข้อความที่ไม่ใช่ตัวเลข → NaN (ให้ validate แจ้งเตือน) */
const parseOptional = (text: string) => (text.trim() === "" ? null : Number(text));
const parseRequired = (text: string) => (text.trim() === "" ? Number.NaN : Number(text));

export interface BalanceControlSuggestion {
  n: number;
  mean: number;
  sd: number;
  monthLabel: string;
}

interface BalanceControlConfigDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scale: BalanceScale;
  config: BalanceControlConfig;
  digits: number;
  suggestion?: BalanceControlSuggestion | null;
}

export default function BalanceControlConfigDialog({
  open,
  onOpenChange,
  scale,
  config,
  digits,
  suggestion,
}: BalanceControlConfigDialogProps) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState>(() => toForm(config));

  useEffect(() => {
    if (open) setForm(toForm(config));
  }, [open, config]);

  const input: BalanceControlConfigInput = {
    mean: parseRequired(form.mean),
    sd: parseRequired(form.sd),
    nominal: parseOptional(form.nominal),
    mpe: parseOptional(form.mpe),
    weightCode: form.weightCode.trim(),
    updatedDate: form.updatedDate,
    brand: form.brand.trim(),
    model: form.model.trim(),
  };
  const preview = useMemo(() => computeLimits(input.mean, input.sd), [input.mean, input.sd]);

  const mutation = useMutation({
    mutationFn: (body: BalanceControlConfigInput) => api.updateBalanceControlConfig(scale.id, body),
    onSuccess: () => {
      toast.success(`บันทึกค่า Control ของ ${scale.code} แล้ว`);
      queryClient.invalidateQueries({ queryKey: ["balance-control-config"] });
      onOpenChange(false);
    },
    onError: (err: Error) => toast.error(err.message || "บันทึกค่า Control ไม่สำเร็จ"),
  });

  const setField = (field: keyof FormState) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setForm((prev) => ({ ...prev, [field]: event.target.value }));

  const handleSave = () => {
    const error = validateBalanceControlInput(input);
    if (error) {
      toast.error(error);
      return;
    }
    mutation.mutate(input);
  };

  const applySuggestion = () => {
    if (!suggestion) return;
    setForm((prev) => ({
      ...prev,
      mean: suggestion.mean.toFixed(Math.max(digits + 2, 6)),
      sd: formatSd(suggestion.sd),
    }));
  };

  const previewItems = [
    { label: "UCL (+3SD)", value: preview?.ucl },
    { label: "UWL (+2SD)", value: preview?.uwl },
    { label: "Mean", value: preview?.mean },
    { label: "LWL (−2SD)", value: preview?.lwl },
    { label: "LCL (−3SD)", value: preview?.lcl },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>ตั้งค่าค่า Control — {scale.code}</DialogTitle>
          <DialogDescription>
            กรอก Mean และ STD จากการประเมินเครื่องชั่ง ระบบจะคำนวณเส้นเฝ้าระวัง (±2SD) และเส้นควบคุม (±3SD) ให้อัตโนมัติ
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {suggestion ? (
            <div className="flex flex-col gap-2 rounded-lg border bg-muted/40 p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
              <p className="text-muted-foreground">
                ข้อมูล {suggestion.monthLabel}: {suggestion.n} วัน · Mean {formatControlNumber(suggestion.mean, digits)} · STD{" "}
                {formatSd(suggestion.sd)}
              </p>
              <Button type="button" variant="outline" size="sm" className="gap-2" onClick={applySuggestion}>
                <Calculator className="h-4 w-4" /> ใช้ค่าจากข้อมูลเดือนนี้
              </Button>
            </div>
          ) : null}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="bcc-mean">Mean (g) *</Label>
              <Input id="bcc-mean" inputMode="decimal" value={form.mean} onChange={setField("mean")} placeholder="เช่น 99.99972" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bcc-sd">STD (g) *</Label>
              <Input id="bcc-sd" inputMode="decimal" value={form.sd} onChange={setField("sd")} placeholder="เช่น 0.0000476" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bcc-nominal">น้ำหนักตุ้ม Daily check (g)</Label>
              <Input id="bcc-nominal" inputMode="decimal" value={form.nominal} onChange={setField("nominal")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bcc-mpe">MPE (g)</Label>
              <Input id="bcc-mpe" inputMode="decimal" value={form.mpe} onChange={setField("mpe")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bcc-weight">รหัสตุ้มน้ำหนัก</Label>
              <Input id="bcc-weight" value={form.weightCode} onChange={setField("weightCode")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bcc-updated">วันที่ปรับปรุงค่า Control</Label>
              <Input id="bcc-updated" type="date" value={form.updatedDate} onChange={setField("updatedDate")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bcc-brand">ยี่ห้อ</Label>
              <Input id="bcc-brand" value={form.brand} onChange={setField("brand")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bcc-model">รุ่น</Label>
              <Input id="bcc-model" value={form.model} onChange={setField("model")} />
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium text-foreground">เส้นที่จะได้</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              {previewItems.map((item) => (
                <div key={item.label} className="rounded-lg border bg-card p-2">
                  <p className="text-xs text-muted-foreground">{item.label}</p>
                  <p className="text-sm font-semibold tabular-nums text-foreground">{formatControlNumber(item.value, digits)}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>
            ยกเลิก
          </Button>
          <Button type="button" className="gap-2" onClick={handleSave} disabled={mutation.isPending}>
            <Save className="h-4 w-4" />
            {mutation.isPending ? "กำลังบันทึก..." : "บันทึกค่า Control"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
