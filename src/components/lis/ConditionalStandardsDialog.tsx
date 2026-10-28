import { useEffect, useState } from "react";
import { Plus, Trash2, ChevronUp, ChevronDown } from "lucide-react";
import type {
  ParameterItem, ParameterValueField, StandardRule, StandardCondition,
  StandardConditionOp, StandardOperator,
} from "@/lib/api";
import { OPERATOR_OPTIONS, describeRule, describeOutputRule } from "@/lib/standardOperators";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

const COND_OPS: { value: StandardConditionOp; label: string }[] = [
  { value: "eq", label: "= เท่ากับ" },
  { value: "ne", label: "≠ ไม่เท่ากับ" },
  { value: "gt", label: "> มากกว่า" },
  { value: "gte", label: "≥ มากกว่าหรือเท่ากับ" },
  { value: "lt", label: "< น้อยกว่า" },
  { value: "lte", label: "≤ น้อยกว่าหรือเท่ากับ" },
  { value: "between", label: "ช่วง (between)" },
];

type SourceOption = { paramId: string | null; label: string; display: string; field: ParameterValueField };

type Props = {
  open: boolean;
  field: ParameterValueField;
  allParameters: ParameterItem[];
  currentParameterId?: string;
  siblingFields: ParameterValueField[];   // field อื่นใน parameter เดียวกัน (ตัดตัวเอง)
  resultMode: "standard" | "output";
  onClose: () => void;
  onSave: (next: StandardRule[]) => void;
  focusRuleIndex?: number | null;
};

export function ConditionalStandardsDialog({
  open, field, allParameters, currentParameterId, siblingFields, resultMode, onClose, onSave, focusRuleIndex = null,
}: Props) {
  const unit = field.unit ?? "";
  const [rules, setRules] = useState<StandardRule[]>(field.conditionalStandards ?? []);
  const [focusSet, setFocusSet] = useState<Set<number> | null>(null);

  useEffect(() => {
    if (open) {
      const initial = field.conditionalStandards ?? [];
      setRules(initial);
      setFocusSet(focusRuleIndex != null && focusRuleIndex < initial.length ? new Set([focusRuleIndex]) : null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, focusRuleIndex]);

  // ตัวเลือก field ต้นทาง: พี่น้อง (paramId=null) + field ของ parameter อื่น
  const sources: SourceOption[] = [
    { paramId: null, label: field.label, display: `${field.label} (ช่องนี้)`, field },
    ...siblingFields.map((f) => ({ paramId: null, label: f.label, display: `${f.label} (พารามฯ นี้)`, field: f })),
    ...allParameters
      .filter((p) => String(p._id) !== String(currentParameterId))
      .flatMap((p) => (p.valueFields ?? []).map((f) => ({
        paramId: String(p._id), label: f.label, display: `${p.name} › ${f.label}`, field: f,
      }))),
  ];
  const sourceKey = (paramId: string | null, label: string) => `${paramId ?? ""}::${label}`;
  const findSource = (c: StandardCondition) =>
    sources.find((s) => sourceKey(s.paramId, s.label) === sourceKey(c.sourceParameterId ?? null, c.sourceFieldLabel));

  const patchRule = (i: number, patch: Partial<StandardRule>) =>
    setRules((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const moveRule = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= rules.length) return;
    setFocusSet((current) => (current
      ? new Set([...current].map((n) => (n === i ? j : n === j ? i : n)))
      : current));
    setRules((prev) => {
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  };
  const removeRule = (i: number) => {
    setFocusSet((current) => (current
      ? new Set([...current].filter((n) => n !== i).map((n) => (n > i ? n - 1 : n)))
      : current));
    setRules((prev) => prev.filter((_, idx) => idx !== i));
  };
  const defaultCondOp = resultMode === "output" ? "between" : "eq";
  const addRule = (withCondition: boolean) => {
    setFocusSet((current) => (current ? new Set([...current, rules.length]) : current));
    setRules((prev) => [...prev, {
      label: "",
      conditions: withCondition ? [{ sourceFieldLabel: sources[0]?.label ?? "", op: defaultCondOp, value: "" }] : [],
      operator: "between", value: null, value2: null,
      ...(resultMode === "output" ? { outputText: "", outputKind: "normal" as const } : {}),
    }]);
  };

  const patchCond = (ri: number, ci: number, patch: Partial<StandardCondition>) =>
    setRules((prev) => prev.map((r, idx) => idx !== ri ? r : {
      ...r, conditions: r.conditions.map((c, k) => (k === ci ? { ...c, ...patch } : c)),
    }));
  const addCond = (ri: number) =>
    setRules((prev) => prev.map((r, idx) => idx !== ri ? r : {
      ...r, conditions: [...r.conditions, { sourceFieldLabel: sources[0]?.label ?? "", op: defaultCondOp, value: "" }],
    }));
  const removeCond = (ri: number, ci: number) =>
    setRules((prev) => prev.map((r, idx) => idx !== ri ? r : {
      ...r, conditions: r.conditions.filter((_, k) => k !== ci),
    }));

  const needsValue2 = (op: StandardOperator) => op === "between" || op === "tolerance";

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>เงื่อนไขพิเศษ — {field.label}</DialogTitle>
          <p className="text-xs text-muted-foreground">
            ไล่จากบนลงล่าง เจอกฎแรกที่เข้าเงื่อนไข (AND ทุกข้อ) จะใช้เกณฑ์นั้น — อยาก OR ให้เพิ่มเป็นอีกกฎ
          </p>
        </DialogHeader>

        <div className="space-y-3">
          {rules.length === 0 && (
            <p className="text-xs text-muted-foreground">ยังไม่มีกฎ — กดเพิ่มกฎด้านล่าง</p>
          )}
          {rules.map((rule, ri) => (focusSet && !focusSet.has(ri) ? null : (
            <div key={ri} className="rounded-lg border p-3 space-y-2 bg-muted/30">
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono text-muted-foreground">#{ri + 1}</span>
                <Input
                  value={rule.label ?? ""}
                  onChange={(e) => patchRule(ri, { label: e.target.value })}
                  placeholder="ป้ายชื่อกฎ เช่น ก้อนใหญ่"
                  className="h-8 flex-1"
                />
                <Button type="button" size="icon" variant="ghost" className="h-7 w-7" disabled={ri === 0} onClick={() => moveRule(ri, -1)}>
                  <ChevronUp className="h-4 w-4" />
                </Button>
                <Button type="button" size="icon" variant="ghost" className="h-7 w-7" disabled={ri === rules.length - 1} onClick={() => moveRule(ri, 1)}>
                  <ChevronDown className="h-4 w-4" />
                </Button>
                <Button type="button" size="icon" variant="ghost" className="h-7 w-7" onClick={() => removeRule(ri)}>
                  <Trash2 className="h-4 w-4 text-red-500" />
                </Button>
              </div>

              {/* conditions (AND) */}
              <div className="space-y-1.5 pl-2 border-l-2 border-emerald-200">
                {rule.conditions.length === 0 ? (
                  <p className="text-xs text-amber-700">ไม่มีเงื่อนไข = แถว default (เข้าเสมอ) — ควรอยู่ล่างสุด</p>
                ) : rule.conditions.map((cond, ci) => {
                  const src = findSource(cond);
                  const srcIsEnum = src?.field.type === "enum";
                  return (
                    <div key={ci} className="flex flex-wrap items-center gap-1.5">
                      {ci > 0 && <span className="text-[10px] text-muted-foreground">และ</span>}
                      <Select
                        value={src ? sourceKey(src.paramId, src.label) : ""}
                        onValueChange={(v) => {
                          const s = sources.find((o) => sourceKey(o.paramId, o.label) === v);
                          if (s) patchCond(ri, ci, { sourceParameterId: s.paramId, sourceFieldLabel: s.label, value: "" });
                        }}
                      >
                        <SelectTrigger className="h-8 w-52"><SelectValue placeholder="field ต้นทาง" /></SelectTrigger>
                        <SelectContent>
                          {sources.map((s) => (
                            <SelectItem key={sourceKey(s.paramId, s.label)} value={sourceKey(s.paramId, s.label)}>
                              {s.display}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Select value={cond.op} onValueChange={(v) => patchCond(ri, ci, { op: v as StandardConditionOp })}>
                        <SelectTrigger className="h-8 w-40"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {COND_OPS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      {srcIsEnum && (cond.op === "eq" || cond.op === "ne") ? (
                        <Select value={String(cond.value ?? "")} onValueChange={(v) => patchCond(ri, ci, { value: v })}>
                          <SelectTrigger className="h-8 w-40"><SelectValue placeholder="ค่า" /></SelectTrigger>
                          <SelectContent>
                            {(src?.field.options ?? []).map((opt) => <SelectItem key={opt} value={opt}>{opt}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      ) : (
                        <Input
                          value={String(cond.value ?? "")}
                          onChange={(e) => patchCond(ri, ci, { value: e.target.value })}
                          placeholder="ค่า"
                          className="h-8 w-28"
                        />
                      )}
                      {cond.op === "between" && (
                        <Input
                          type="number"
                          value={cond.value2 ?? ""}
                          onChange={(e) => patchCond(ri, ci, { value2: e.target.value === "" ? null : Number(e.target.value) })}
                          placeholder="ถึง"
                          className="h-8 w-24"
                        />
                      )}
                      <Button type="button" size="icon" variant="ghost" className="h-7 w-7" onClick={() => removeCond(ri, ci)}>
                        <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                      </Button>
                    </div>
                  );
                })}
                <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={() => addCond(ri)}>
                  <Plus className="h-3 w-3 mr-1" /> เพิ่มเงื่อนไข
                </Button>
              </div>

              {/* resulting standard OR text output */}
              {resultMode === "output" ? (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs text-muted-foreground">→ ผลลัพธ์:</span>
                  <Input
                    value={rule.outputText ?? ""}
                    onChange={(e) => patchRule(ri, { outputText: e.target.value })}
                    placeholder="ข้อความ เช่น ก้อนเล็ก"
                    className="h-8 w-44"
                  />
                  <Select value={rule.outputKind ?? "normal"} onValueChange={(v) => patchRule(ri, { outputKind: v as "normal" | "abnormal" })}>
                    <SelectTrigger className="h-8 w-32"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="normal">ปกติ</SelectItem>
                      <SelectItem value="abnormal">ผิดปกติ</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs text-muted-foreground">→ เกณฑ์:</span>
                  <Select value={rule.operator} onValueChange={(v) => patchRule(ri, { operator: v as StandardOperator })}>
                    <SelectTrigger className="h-8 w-44"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {OPERATOR_OPTIONS.filter((o) => o.value !== "none").map((o) => (
                        <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    type="number"
                    value={rule.value ?? ""}
                    onChange={(e) => patchRule(ri, { value: e.target.value === "" ? null : Number(e.target.value) })}
                    placeholder={rule.operator === "tolerance" ? "ค่ามาตรฐาน" : rule.operator === "between" ? "ตั้งแต่" : "ค่า"}
                    className="h-8 w-28"
                  />
                  {needsValue2(rule.operator) && (
                    <Input
                      type="number"
                      value={rule.value2 ?? ""}
                      onChange={(e) => patchRule(ri, { value2: e.target.value === "" ? null : Number(e.target.value) })}
                      placeholder={rule.operator === "tolerance" ? "± %" : "ถึง"}
                      className="h-8 w-24"
                    />
                  )}
                  {unit && <span className="text-xs text-muted-foreground">{unit}</span>}
                </div>
              )}

              <p className="text-xs text-emerald-700">
                {resultMode === "output" ? describeOutputRule(rule) : describeRule(rule, unit)}
              </p>
            </div>
          )))}
        </div>

        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => addRule(true)}>
            <Plus className="h-4 w-4 mr-1" /> เพิ่มกฎ
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => addRule(false)}>
            <Plus className="h-4 w-4 mr-1" /> เพิ่มแถว default
          </Button>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>ยกเลิก</Button>
          <Button type="button" variant="primary" onClick={() => { onSave(rules); onClose(); }}>บันทึก</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
