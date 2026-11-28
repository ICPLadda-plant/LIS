import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Save, Trash2 } from "lucide-react";
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
import { todayStr } from "@/lib/chemicalRequisition";
import {
  computeLimits,
  formatControlNumber,
  limitDecimalPlaces,
  monthlyStats,
  validateBalanceControlInput,
  type BalanceControlConfig,
  type BalanceControlConfigInput,
  type BalanceScale,
} from "@/lib/balanceControlChart";

// ตั้งค่าค่า Control (Mean / STD) ของเครื่องชั่ง 1 เครื่อง แล้วแสดงเส้น UWL/LWL/UCL/LCL ที่จะได้ทันที

interface FormState {
  baselineValues: string[];
  nominal: string;
  updatedDate: string;
  brand: string;
  model: string;
}

const numText = (value: number | null | undefined, digits: number) => (value == null ? "" : value.toFixed(digits));
const normalizedNumberText = (value: string, digits: number) => value.trim() !== "" && Number.isFinite(Number(value))
  ? Number(value).toFixed(digits)
  : value;

const toForm = (config: BalanceControlConfig, digits: number): FormState => ({
  baselineValues: Array.from({ length: 20 }, (_, index) => numText(config.baselineValues?.[index], digits)),
  nominal: numText(config.nominal, digits),
  updatedDate: config.updatedDate,
  brand: config.brand,
  model: config.model,
});
/** "" → null, ข้อความที่ไม่ใช่ตัวเลข → NaN (ให้ validate แจ้งเตือน) */
const parseOptional = (text: string) => (text.trim() === "" ? null : Number(text));

/** draft ค่า Control ที่ยังไม่กดบันทึก — กันกดออก/รีเฟรชแล้วค่าที่กรอกไว้หาย */
const draftStorageKey = (scaleId: string, nominal: number) => `balance-control-draft:${scaleId}:${nominal}`;

interface BalanceControlConfigDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scale: BalanceScale;
  config: BalanceControlConfig;
  digits: number;
}

export default function BalanceControlConfigDialog({
  open,
  onOpenChange,
  scale,
  config,
  digits,
}: BalanceControlConfigDialogProps) {
  const queryClient = useQueryClient();
  const storageKey = draftStorageKey(scale.id, config.nominal);
  const controlDecimals = config.nominal === scale.primaryCalibrationWeight
    ? scale.weights100Decimals ?? scale.decimals
    : scale.decimals;
  const [form, setForm] = useState<FormState>(() => toForm(config, controlDecimals));

  useEffect(() => {
    if (!open) return;
    const saved = localStorage.getItem(storageKey);
    if (saved) {
      try {
        const savedForm = JSON.parse(saved) as FormState;
        setForm({
          ...savedForm,
          baselineValues: savedForm.baselineValues.map((value) => normalizedNumberText(value, controlDecimals)),
          nominal: normalizedNumberText(savedForm.nominal, controlDecimals),
        });
        return;
      } catch {
        localStorage.removeItem(storageKey);
      }
    }
    setForm(toForm(config, controlDecimals));
  }, [open, config, controlDecimals, storageKey]);

  useEffect(() => {
    if (open) localStorage.setItem(storageKey, JSON.stringify(form));
  }, [form, open, storageKey]);

  const baselineValues = form.baselineValues.map(Number);
  const baselineComplete = form.baselineValues.every((value) => value.trim() !== "" && Number.isFinite(Number(value)));
  const stats = monthlyStats(baselineComplete ? baselineValues : []);
  const input: BalanceControlConfigInput = {
    mean: stats.mean ?? Number.NaN,
    sd: stats.sd ?? Number.NaN,
    baselineValues: baselineComplete ? baselineValues : [],
    nominal: parseOptional(form.nominal),
    updatedDate: form.updatedDate,
    brand: form.brand.trim(),
    model: form.model.trim(),
  };
  const preview = useMemo(() => computeLimits(input.mean, input.sd), [input.mean, input.sd]);

  const mutation = useMutation({
    mutationFn: (body: BalanceControlConfigInput) => api.updateBalanceControlConfig(scale.id, body),
    onSuccess: () => {
      toast.success(`บันทึกค่า Control ของ ${scale.code} แล้ว`);
      localStorage.removeItem(storageKey);
      queryClient.invalidateQueries({ queryKey: ["balance-control-config"] });
      onOpenChange(false);
    },
    onError: (err: Error) => toast.error(err.message || "บันทึกค่า Control ไม่สำเร็จ"),
  });

  const setField = (field: keyof FormState) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setForm((prev) => ({ ...prev, [field]: event.target.value }));
  const normalizeField = (field: "nominal") => () =>
    setForm((prev) => ({ ...prev, [field]: normalizedNumberText(prev[field], controlDecimals) }));

  const handleSave = () => {
    const error = validateBalanceControlInput(input);
    if (error) {
      toast.error(error);
      return;
    }
    mutation.mutate(input);
  };
  const handleClear = () => setForm((prev) => ({
    ...prev,
    baselineValues: Array(20).fill(""),
    updatedDate: todayStr(),
  }));

  const setBaselineValue = (index: number) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setForm((prev) => ({
      ...prev,
      baselineValues: prev.baselineValues.map((value, itemIndex) => itemIndex === index ? limitDecimalPlaces(event.target.value, controlDecimals) : value),
    }));
  const normalizeBaselineValue = (index: number) => () =>
    setForm((prev) => ({
      ...prev,
      baselineValues: prev.baselineValues.map((value, itemIndex) => itemIndex === index ? normalizedNumberText(value, controlDecimals) : value),
    }));

  const previewItems = [
    { label: "UCL (+3SD)", value: preview?.ucl },
    { label: "UWL (+2SD)", value: preview?.uwl },
    { label: "Mean", value: preview?.mean },
    { label: "LWL (−2SD)", value: preview?.lwl },
    { label: "LCL (−3SD)", value: preview?.lcl },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>ตั้งค่าค่า Control — {scale.code} · ตุ้ม {config.nominal} g</DialogTitle>
          <DialogDescription>
            กรอกผลการชั่ง 20 ค่า ระบบจะคำนวณ Mean, STD, UWL, LWL, UCL และ LCL ให้อัตโนมัติ
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>ค่าบันทึกสำหรับคำนวณ Control (20 ค่า) *</Label>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-5">
              {form.baselineValues.map((value, index) => (
                <div key={index} className="space-y-1">
                  <Label htmlFor={`bcc-value-${index}`} className="text-xs text-muted-foreground">ค่าที่ {index + 1}</Label>
                  <Input
                    id={`bcc-value-${index}`}
                    inputMode="decimal"
                    value={value}
                    onChange={setBaselineValue(index)}
                    onBlur={normalizeBaselineValue(index)}
                    aria-label={`ค่าบันทึกที่ ${index + 1}`}
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1.5">
              <Label htmlFor="bcc-mean">Mean (g)</Label>
              <Input id="bcc-mean" value={formatControlNumber(stats.mean, digits)} readOnly className="bg-muted/40" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bcc-sd">STD (g)</Label>
              <Input id="bcc-sd" value={formatControlNumber(stats.sd, digits)} readOnly className="bg-muted/40" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bcc-nominal">น้ำหนักตุ้ม Daily check (g)</Label>
              <Input id="bcc-nominal" inputMode="decimal" value={form.nominal} onChange={setField("nominal")} onBlur={normalizeField("nominal")} />
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
          <Button type="button" variant="outline" className="gap-2" onClick={handleClear} disabled={mutation.isPending}>
            <Trash2 className="h-4 w-4" />
            ล้างค่าทั้งหมด
          </Button>
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
