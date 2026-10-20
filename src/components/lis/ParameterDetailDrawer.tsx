import { useState } from "react";
import { Filter, Pencil } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import type {
  OptionOutput,
  ParameterApplyRule,
  ParameterItem,
  ParameterScope,
  ParameterValueField,
} from "@/lib/api";
import {
  describeLabelTolerance,
  describeOutputRule,
  describeRule,
  describeSingleStandard,
  describeSubstanceStandard,
} from "@/lib/standardOperators";
import {
  formatTimerHuman,
  seedOptionOutputsFromLegacy,
} from "@/lib/parameterValidation";
import {
  FIELD_TYPE_META,
  SCOPE_BADGE_CLASS,
  SCOPE_LABEL,
  summarizeOptionFilter,
} from "@/lib/parameterDisplay";
import { productTypeLabels } from "@/lib/productClassification";

const CRITERIA_PREVIEW_COUNT = 5;

const APPLY_RULE_KEYS = [
  "itemNos",
  "itemNames",
  "fullCommonNames",
  "commonNames",
  "productTypes",
  "categories",
  "subCategories",
  "itemGroups",
] as const satisfies readonly (keyof ParameterApplyRule)[];

function cleanStringList(values: string[] | undefined): string[] {
  return Array.from(new Set((values ?? []).map((value) => value.trim()).filter(Boolean)));
}

function normalizedApplyRules(rules: ParameterApplyRule[] | undefined): ParameterApplyRule[] {
  return (rules ?? []).filter((rule) => APPLY_RULE_KEYS.some((key) => (rule[key]?.length ?? 0) > 0));
}

function formatWarehouseCategoryOption(value: string): string {
  if (value === "RM") return "คลัง RM";
  if (value === "FG") return "คลัง FG";
  return value;
}

function summarizeApplyRule(rule: ParameterApplyRule, groupNameById: Map<string, string>): string {
  const parts: string[] = [];
  const add = (label: string, values: string[] | undefined, mapValue?: (value: string) => string) => {
    const displayValues = cleanStringList(values).map((value) => mapValue?.(value) ?? value);
    if (displayValues.length > 0) parts.push(`${label}: ${displayValues.join(', ')}`);
  };

  add("รหัสสินค้า", rule.itemNos);
  add("Item", rule.itemNames);
  add("Common Name", rule.fullCommonNames);
  add("ประเภท Common Name", rule.commonNames);
  add("ประเภท", rule.productTypes, (value) => productTypeLabels[value] ?? value);
  add("หมวดหมู่", rule.categories, formatWarehouseCategoryOption);
  add("หมวดย่อย", rule.subCategories);
  add("กลุ่ม", rule.itemGroups, (id) => groupNameById.get(id) ?? id);

  return parts.join(" · ") || "ทุก item";
}

type ParameterDetailDrawerProps = {
  parameter: ParameterItem;
  allParameters: ParameterItem[];
  groupNameById: Map<string, string>;
  onEdit: () => void;
  onClose: () => void;
};

/** เกณฑ์แบบ list (ต่อสาร / %สาร / กฎ) — โชว์ 5 แรก + ปุ่มคลี่ในที่ */
function CriteriaList({ title, items, emptyText }: { title: string; items: string[]; emptyText: string }) {
  const [showAll, setShowAll] = useState(false);
  if (items.length === 0) {
    return <p className="text-xs text-muted-foreground">{emptyText}</p>;
  }
  const visible = showAll ? items : items.slice(0, CRITERIA_PREVIEW_COUNT);
  return (
    <div className="space-y-0.5">
      <p className="text-xs font-medium text-muted-foreground">{title}</p>
      {visible.map((text, i) => (
        <p key={i} className="text-xs text-emerald-700">{text}</p>
      ))}
      {items.length > CRITERIA_PREVIEW_COUNT ? (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="text-xs text-primary hover:underline"
        >
          {showAll ? "ย่อ" : `ดูทั้งหมด (${items.length})`}
        </button>
      ) : null}
    </div>
  );
}

function OptionOutputChip({ output }: { output: OptionOutput | undefined }) {
  if (!output || output.kind === "normal") {
    return <Badge className="bg-emerald-100 text-[10px] text-emerald-800 hover:bg-emerald-100">ปกติ</Badge>;
  }
  if (output.kind === "abnormal") {
    return <Badge className="bg-red-100 text-[10px] text-red-700 hover:bg-red-100">ไม่ปกติ</Badge>;
  }
  return (
    <Badge variant="secondary" className="text-[10px] font-normal">
      ข้อความ: "{output.text ?? ""}"
    </Badge>
  );
}

function ApplyToSection({
  parameter,
  groupNameById,
}: {
  parameter: ParameterItem;
  groupNameById: Map<string, string>;
}) {
  const hasExcludes =
      (parameter.excludeItemNos?.length ?? 0) +
      (parameter.excludeItemNames?.length ?? 0) +
      (parameter.excludeFullCommonNames?.length ?? 0) +
      (parameter.excludeCommonNames?.length ?? 0) +
      (parameter.excludeProductTypes?.length ?? 0) +
      (parameter.excludeCategories?.length ?? 0) +
      (parameter.excludeSubCategories?.length ?? 0) +
      (parameter.excludeItemGroups?.length ?? 0) >
    0;
  const applyRules = normalizedApplyRules(parameter.applyRules);
  if (parameter.applyAll && !hasExcludes && applyRules.length === 0) {
    return <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100">ทั้งหมด</Badge>;
  }
  const groups: { label: string; values: string[]; color: string }[] = [
    { label: "รหัสสินค้า", values: parameter.itemNos ?? [], color: "bg-violet-50 text-violet-700" },
    { label: "Item", values: parameter.itemNames ?? [], color: "bg-violet-50 text-violet-700" },
    { label: "Common Name", values: parameter.fullCommonNames ?? [], color: "bg-blue-50 text-blue-700" },
    { label: "ประเภท Common Name", values: parameter.commonNames ?? [], color: "bg-blue-50 text-blue-700" },
    {
      label: "ประเภท",
      values: (parameter.productTypes ?? []).map((v) => productTypeLabels[v] ?? v),
      color: "bg-emerald-50 text-emerald-700",
    },
    { label: "หมวดหมู่", values: (parameter.categories ?? []).map((v) => v === "RM" ? "คลัง RM" : v === "FG" ? "คลัง FG" : v), color: "bg-amber-50 text-amber-700" },
    { label: "หมวดย่อย", values: parameter.subCategories ?? [], color: "bg-orange-50 text-orange-700" },
    {
      label: "กลุ่ม",
      values: (parameter.itemGroups ?? []).map((id) => groupNameById.get(id) ?? id),
      color: "bg-rose-50 text-rose-700",
    },
  ].filter((g) => g.values.length > 0);
  if (parameter.applyAll) {
    groups.unshift({ label: "ทั้งหมด", values: ["ทั้งหมด"], color: "bg-amber-100 text-amber-800" });
  }
  const excludes: { label: string; values: string[] }[] = [
    { label: "รหัสสินค้า", values: parameter.excludeItemNos ?? [] },
    { label: "Item", values: parameter.excludeItemNames ?? [] },
    { label: "Common Name", values: parameter.excludeFullCommonNames ?? [] },
    { label: "ประเภท Common Name", values: parameter.excludeCommonNames ?? [] },
    {
      label: "ประเภท",
      values: (parameter.excludeProductTypes ?? []).map((v) => productTypeLabels[v] ?? v),
    },
    { label: "หมวดหมู่", values: (parameter.excludeCategories ?? []).map((v) => v === "RM" ? "คลัง RM" : v === "FG" ? "คลัง FG" : v) },
    { label: "หมวดย่อย", values: parameter.excludeSubCategories ?? [] },
    {
      label: "กลุ่ม",
      values: (parameter.excludeItemGroups ?? []).map((id) => groupNameById.get(id) ?? id),
    },
  ].filter((g) => g.values.length > 0);

  if (applyRules.length === 0 && groups.length === 0 && excludes.length === 0) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  return (
    <div className="space-y-1.5">
      {applyRules.length > 0 ? (
        <div className="space-y-2">
          {applyRules.map((rule, index) => (
            <div key={index} className="rounded-md border bg-card p-2 text-xs text-card-foreground">
              <Badge variant="secondary">กฎ {index + 1}</Badge>
              <p className="mt-1 text-muted-foreground">{summarizeApplyRule(rule, groupNameById)}</p>
            </div>
          ))}
        </div>
      ) : null}
      {groups.map((g) => (
        <div key={g.label} className="flex flex-wrap items-baseline gap-1">
          <span className="text-xs font-semibold text-muted-foreground">{g.label}:</span>
          {g.values.map((v) => (
            <span key={v} className={cn("rounded-md px-2 py-0.5 text-xs", g.color)}>
              {v}
            </span>
          ))}
        </div>
      ))}
      {excludes.length > 0 ? (
        <div className="space-y-1 border-t border-border pt-2">
          {excludes.map((g) => (
            <div key={g.label} className="flex flex-wrap items-baseline gap-1">
              <span className="text-xs font-semibold text-red-700">ยกเว้น {g.label}:</span>
              {g.values.map((v) => (
                <span key={v} className="rounded-md bg-red-50 px-2 py-0.5 text-xs text-red-700">
                  {v}
                </span>
              ))}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function FieldDetail({
  field,
  allParameters,
  groupNameById,
}: {
  field: ParameterValueField;
  allParameters: ParameterItem[];
  groupNameById: Map<string, string>;
}) {
  const unit = field.unit ?? "";
  switch (field.type) {
    case "number":
    case "float": {
      const unitLine = field.unit ? (
        <p className="text-xs text-muted-foreground">หน่วย: {field.unit}</p>
      ) : null;
      if (field.labelToleranceMode) {
        const stds = field.labelToleranceStandards ?? [];
        return (
          <div className="space-y-1">
            {unitLine}
            <CriteriaList
              title={`ตาม %สาร (${stds.length} สาร)`}
              items={stds.map((s) => `${s.substance} — ${describeLabelTolerance(s, unit)}`)}
              emptyText="ยังไม่ได้ตั้งเกณฑ์ตาม %สาร"
            />
          </div>
        );
      }
      if (field.conditionalMode) {
        const rules = field.conditionalStandards ?? [];
        const isOutput = (field.conditionalResult ?? "standard") === "output";
        return (
          <div className="space-y-1">
            {unitLine}
            <CriteriaList
              title={`เงื่อนไขพิเศษ (${rules.length} กฎ)`}
              items={rules.map((r) => (isOutput ? describeOutputRule(r) : describeRule(r, unit)))}
              emptyText="ยังไม่ได้ตั้งกฎ"
            />
          </div>
        );
      }
      if (field.substanceMode) {
        const stds = field.substanceStandards ?? [];
        return (
          <div className="space-y-1">
            {unitLine}
            <CriteriaList
              title={`เกณฑ์ต่อสาร (${stds.length} สาร)`}
              items={stds.map((s) => `${s.substance} — ${describeSubstanceStandard(s, unit)}`)}
              emptyText="ยังไม่ได้ตั้งเงื่อนไขสาร"
            />
          </div>
        );
      }
      const single = describeSingleStandard(field);
      return (
        <div className="space-y-1">
          {unitLine}
          <p className={cn("text-xs", single.set ? "text-emerald-700" : "text-muted-foreground")}>
            {single.text}
          </p>
        </div>
      );
    }
    case "enum": {
      const opts = field.options ?? [];
      if (opts.length === 0) {
        return <p className="text-xs text-muted-foreground">ยังไม่มีตัวเลือก</p>;
      }
      const outputs =
        field.optionOutputs ?? seedOptionOutputsFromLegacy(opts, field.expectedValues ?? []);
      return (
        <div className="space-y-1">
          {opts.map((opt) => {
            const filter = field.optionFilters?.[opt];
            return (
              <div key={opt} className="flex flex-wrap items-center gap-1.5 text-xs">
                <span>{opt}</span>
                <OptionOutputChip output={outputs[opt]} />
                {(field.requireNoteOn ?? []).includes(opt) ? (
                  <Badge variant="outline" className="text-[10px] font-normal">ต้องกรอกหมายเหตุ</Badge>
                ) : null}
                {filter ? (
                  <span className="flex items-center gap-1 text-[10px] text-emerald-700">
                    <Filter className="h-2.5 w-2.5 shrink-0" />
                    {summarizeOptionFilter(filter, groupNameById)}
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>
      );
    }
    case "timer":
      return (
        <p className="text-xs text-muted-foreground">
          {field.timerDurationSec && field.timerDurationSec > 0
            ? `จับเวลา: ${formatTimerHuman(field.timerDurationSec)}`
            : "ยังไม่ตั้งระยะเวลา"}
        </p>
      );
    case "photo":
      return <p className="text-xs text-muted-foreground">สูงสุด {field.maxPhotos ?? 5} รูป</p>;
    case "file": {
      const types = (field.allowedFileTypes ?? ["pdf"]).map((t) => t.toUpperCase()).join(", ");
      return (
        <p className="text-xs text-muted-foreground">
          {types} · สูงสุด {field.maxFiles ?? 5} ไฟล์
        </p>
      );
    }
    case "reference": {
      if (!field.refParameterId || !field.refFieldLabel) {
        return <p className="text-xs text-muted-foreground">ยังไม่ได้เลือก parameter ต้นทาง</p>;
      }
      const source = allParameters.find((p) => p._id === field.refParameterId);
      const phaseSuffix = field.refPhase === 2 ? " · phase 2" : "";
      return (
        <p className="text-xs text-muted-foreground">
          ← ดึงจาก {source?.name ?? field.refParameterId} · {field.refFieldLabel}
          {phaseSuffix}
        </p>
      );
    }
    case "text":
      return null;
  }
}

function FieldCard({
  field,
  index,
  parameter,
  allParameters,
  groupNameById,
}: {
  field: ParameterValueField;
  index: number;
  parameter: ParameterItem;
  allParameters: ParameterItem[];
  groupNameById: Map<string, string>;
}) {
  const meta = FIELD_TYPE_META[field.type];
  const Icon = meta.Icon;
  const chips: string[] = [];
  if (parameter.hasPhases) {
    const phase = field.phase ?? "both";
    chips.push(
      phase === "both" ? "ทั้ง 2 phase" : phase === "before" ? "เฉพาะก่อน (Phase 1)" : "เฉพาะหลัง (Phase 2)",
    );
    if (field.triggersPhase2) chips.push("ตัว trigger รอบตรวจซ้ำ");
  }
  if (field.multiple) chips.push("กรอกได้หลายค่า");
  if (field.showLastBatch) chips.push("โชว์ค่าแบชล่าสุด");

  return (
    <div className="relative overflow-hidden rounded-lg border border-grey-200 bg-background">
      <div className={cn("absolute inset-y-0 left-0 w-1", meta.accent)} aria-hidden />
      <div className="space-y-2 py-2.5 pl-4 pr-3">
        <div className="flex items-baseline gap-2">
          <span className="w-4 text-right font-mono text-xs tabular-nums text-muted-foreground">
            {index + 1}
          </span>
          <Icon className={cn("h-4 w-4 shrink-0 self-center", meta.iconText)} />
          <span className="text-sm font-medium">
            {field.label?.trim() || <span className="italic text-muted-foreground">ยังไม่ได้ตั้งชื่อ</span>}
          </span>
          <span className={cn("text-xs font-medium", meta.text)}>{meta.label}</span>
          {field.required ? <span className="text-xs text-red-500">*</span> : null}
        </div>
        {chips.length > 0 ? (
          <div className="flex flex-wrap gap-1 pl-6">
            {chips.map((c) => (
              <Badge key={c} variant="secondary" className="text-[10px] font-normal">
                {c}
              </Badge>
            ))}
          </div>
        ) : null}
        <div className="pl-6">
          <FieldDetail field={field} allParameters={allParameters} groupNameById={groupNameById} />
        </div>
      </div>
    </div>
  );
}

export function ParameterDetailDrawer({
  parameter,
  allParameters,
  groupNameById,
  onEdit,
  onClose,
}: ParameterDetailDrawerProps) {
  const scope = (parameter.scope ?? "qc") as ParameterScope;
  const status = parameter.status ?? "active";
  const fields = parameter.valueFields ?? [];
  const systemInfo: string[] = [];
  if (parameter.hasPhases) systemInfo.push("เป็นตัว trigger รอบตรวจซ้ำ");
  if (parameter.multiEntry) systemInfo.push("กรอกซ้ำได้หลายรายการ");

  return (
    <Sheet open onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-lg"
      >
        <SheetHeader className="space-y-2 border-b border-border p-6 pr-12 text-left">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge className={cn("text-[10px] font-semibold uppercase", SCOPE_BADGE_CLASS[scope])}>
              {SCOPE_LABEL[scope]}
            </Badge>
            {scope === "qc" && parameter.shareWithLab ? (
              <Badge
                variant="outline"
                className="border-sky-300 bg-sky-50 text-[10px] text-sky-800"
                title="แชร์ให้ Lab อ่านได้"
              >
                → Lab
              </Badge>
            ) : null}
            <Badge variant={status === "active" ? "default" : "secondary"}>
              {status === "active" ? "เปิด" : "ปิด"}
            </Badge>
          </div>
          <SheetTitle className="text-xl font-bold">{parameter.name}</SheetTitle>
          <SheetDescription className="sr-only">
            รายละเอียดพารามิเตอร์ {parameter.name}
          </SheetDescription>
          {parameter.note ? (
            <p className="text-sm text-muted-foreground">{parameter.note}</p>
          ) : null}
        </SheetHeader>

        <div className="flex-1 space-y-5 p-6">
          <section className="space-y-2">
            <h3 className="text-sm font-semibold">ใช้กับ</h3>
            <p className="text-xs text-muted-foreground">ต้องตรงทุกมิติที่เลือกพร้อมกัน</p>
            <ApplyToSection parameter={parameter} groupNameById={groupNameById} />
          </section>

          <section className="space-y-2">
            <h3 className="text-sm font-semibold">ช่องค่า ({fields.length})</h3>
            {fields.length === 0 ? (
              <p className="text-xs text-muted-foreground">— ยังไม่มีช่องค่า</p>
            ) : (
              <div className="space-y-2">
                {fields.map((field, i) => (
                  <FieldCard
                    key={i}
                    field={field}
                    index={i}
                    parameter={parameter}
                    allParameters={allParameters}
                    groupNameById={groupNameById}
                  />
                ))}
              </div>
            )}
          </section>

          {systemInfo.length > 0 ? (
            <section className="space-y-1 border-t border-border pt-3">
              {systemInfo.map((line) => (
                <p key={line} className="text-xs text-muted-foreground">{line}</p>
              ))}
            </section>
          ) : null}
        </div>

        <SheetFooter className="gap-2 border-t border-border p-4">
          <Button type="button" variant="outline" onClick={onEdit}>
            <Pencil className="h-4 w-4" />
            แก้ไข
          </Button>
          <Button type="button" onClick={onClose}>
            ปิด
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
