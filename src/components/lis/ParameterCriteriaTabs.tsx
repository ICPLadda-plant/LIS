import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Pencil, Search } from "lucide-react";

import type { ParameterItem, ParameterScope } from "@/lib/api";
import { rankSearchResults } from "@/lib/searchRanking";
import {
  type AdvancedCriteriaMode,
  buildConditionalCriteriaRows,
  buildLabelToleranceCriteriaRows,
  buildSubstanceCriteriaRows,
} from "@/lib/parameterCriteriaRows";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export type ParameterCriteriaTab = "list" | AdvancedCriteriaMode;

type CriteriaSortKey =
  | "parameterOrder"
  | "parameterName"
  | "substanceAsc"
  | "substanceDesc"
  | "minValueAsc"
  | "minValueDesc"
  | "maxValueAsc"
  | "maxValueDesc"
  | "drugPercentAsc"
  | "drugPercentDesc";

type ParameterOption = ParameterItem & { _id: string };

type SortableCriteriaRow = {
  parameterId: string;
  parameterName: string;
  fieldIndex: number;
  fieldLabel: string;
  ruleIndex: number | null;
  searchText: string;
  substance?: string;
  itemNo?: string;
  packSize?: string;
  masterItemName?: string;
  masterCommonName?: string;
  rawMasterText?: string;
  value?: number | null;
  value2?: number | null;
  drugPercent?: string;
};

const criteriaCollator = new Intl.Collator(["th", "en"], { numeric: true, sensitivity: "base" });
const SEARCHABLE_ROW_KEYS = [
  "parameterName",
  "fieldLabel",
  "substance",
  "operator",
  "value",
  "value2",
  "productTypeText",
  "categoryText",
  "ruleLabel",
  "conditionsText",
  "resultText",
  "selectorText",
  "drugPercent",
  "tolerancePercent",
  "headTolerance",
  "failLow",
  "passLow",
  "passHigh",
  "failHigh",
  "previewText",
] as const;

const SUBSTANCE_SORT_OPTIONS: Array<{ value: CriteriaSortKey; label: string }> = [
  { value: "substanceAsc", label: "ชื่อสาร A-Z" },
  { value: "substanceDesc", label: "ชื่อสาร Z-A" },
  { value: "minValueAsc", label: "ค่าต่ำสุด น้อยไปมาก" },
  { value: "minValueDesc", label: "ค่าต่ำสุด มากไปน้อย" },
  { value: "maxValueAsc", label: "ค่าสูงสุด น้อยไปมาก" },
  { value: "maxValueDesc", label: "ค่าสูงสุด มากไปน้อย" },
];

const DEFAULT_SORT_OPTIONS: Array<{ value: CriteriaSortKey; label: string }> = [
  { value: "parameterOrder", label: "ตามลำดับ Parameter" },
  { value: "parameterName", label: "ชื่อ Parameter" },
];

const LABEL_TOLERANCE_SORT_OPTIONS: Array<{ value: CriteriaSortKey; label: string }> = [
  ...DEFAULT_SORT_OPTIONS,
  { value: "drugPercentAsc", label: "%สาร น้อยไปมาก" },
  { value: "drugPercentDesc", label: "%สาร มากไปน้อย" },
];

export type ParameterCriteriaTabsProps = {
  value: ParameterCriteriaTab;
  onValueChange: (value: ParameterCriteriaTab) => void;
  parameters: ParameterItem[];
  scope: ParameterScope;
  children: ReactNode;
  canViewHeadCriteriaColumns?: boolean;
  onEditField: (mode: AdvancedCriteriaMode, parameterId: string, fieldIndex: number, ruleIndex?: number | null) => void;
};

export function ParameterCriteriaTabs({
  value,
  onValueChange,
  parameters,
  scope,
  children,
  canViewHeadCriteriaColumns = false,
  onEditField,
}: ParameterCriteriaTabsProps) {
  const [parameterFilter, setParameterFilter] = useState("");
  const [sortKeyByTab, setSortKeyByTab] = useState<Record<Exclude<ParameterCriteriaTab, "list">, CriteriaSortKey>>({
    substance: "substanceAsc",
    conditional: "parameterOrder",
    labelTolerance: "drugPercentAsc",
  });
  const [criteriaSearch, setCriteriaSearch] = useState("");
  const showHeadCriteriaColumns = canViewHeadCriteriaColumns === true;
  const substanceRows = useMemo(() => buildSubstanceCriteriaRows(parameters, scope), [parameters, scope]);
  const conditionalRows = useMemo(() => buildConditionalCriteriaRows(parameters, scope), [parameters, scope]);
  const labelRows = useMemo(() => buildLabelToleranceCriteriaRows(parameters, scope), [parameters, scope]);
  const criteriaTabOptions = useMemo(
    () =>
      [
        { value: "substance" as const, label: "แยกตามสาร", rows: substanceRows },
        { value: "conditional" as const, label: "เงื่อนไขพิเศษ", rows: conditionalRows },
        { value: "labelTolerance" as const, label: "ตาม %สาร", rows: labelRows },
      ].filter((tab) => tab.rows.length > 0),
    [conditionalRows, labelRows, substanceRows],
  );
  const availableCriteriaTabValues = useMemo(
    () => criteriaTabOptions.map((tab) => tab.value),
    [criteriaTabOptions],
  );
  const isRequestedCriteriaTabAvailable = value !== "list" && availableCriteriaTabValues.includes(value);
  const selectedTabValue: ParameterCriteriaTab = isRequestedCriteriaTabAvailable ? value : "list";
  const activeCriteriaTab = isRequestedCriteriaTabAvailable
    ? value
    : criteriaTabOptions[0]?.value ?? "substance";
  const sortOptions =
    activeCriteriaTab === "substance"
      ? SUBSTANCE_SORT_OPTIONS
      : activeCriteriaTab === "labelTolerance"
        ? LABEL_TOLERANCE_SORT_OPTIONS
        : DEFAULT_SORT_OPTIONS;
  const sortKey = sortKeyByTab[activeCriteriaTab];

  const scopedParameters = useMemo(
    () =>
      parameters.filter(
        (parameter): parameter is ParameterOption => (parameter.scope ?? "qc") === scope && Boolean(parameter._id),
      ),
    [parameters, scope],
  );
  const parameterOrder = useMemo(() => {
    const order = new Map<string, number>();
    scopedParameters.forEach((parameter, index) => order.set(parameter._id, index));
    return order;
  }, [scopedParameters]);
  const activeCriteriaRows =
    activeCriteriaTab === "substance"
      ? substanceRows
      : activeCriteriaTab === "conditional"
        ? conditionalRows
        : labelRows;
  const activeParameterIds = useMemo(
    () => new Set(activeCriteriaRows.map((row) => row.parameterId)),
    [activeCriteriaRows],
  );
  const parameterOptions = useMemo(
    () => scopedParameters.filter((parameter) => activeParameterIds.has(parameter._id)),
    [activeParameterIds, scopedParameters],
  );
  const parameterOptionIds = useMemo(
    () => new Set(parameterOptions.map((parameter) => parameter._id)),
    [parameterOptions],
  );
  const defaultParameterFilter = useMemo(
    () => parameterOptions.find(isSpecificGravityParameter)?._id ?? parameterOptions[0]?._id ?? "",
    [parameterOptions],
  );
  const activeParameterFilter = parameterOptionIds.has(parameterFilter) ? parameterFilter : defaultParameterFilter;
  const selectedParameterName =
    parameterOptions.find((parameter) => parameter._id === activeParameterFilter)?.name ?? "ยังไม่มี Parameter";
  const normalizedCriteriaSearch = normalizeCriteriaSearchText(criteriaSearch);
  const visibleSubstanceRows = useMemo(
    () => filterAndSortRows(substanceRows, activeParameterFilter, normalizedCriteriaSearch, sortKey, parameterOrder),
    [activeParameterFilter, normalizedCriteriaSearch, parameterOrder, sortKey, substanceRows],
  );
  const visibleConditionalRows = useMemo(
    () => filterAndSortRows(conditionalRows, activeParameterFilter, normalizedCriteriaSearch, sortKey, parameterOrder),
    [activeParameterFilter, conditionalRows, normalizedCriteriaSearch, parameterOrder, sortKey],
  );
  const visibleLabelRows = useMemo(
    () => filterAndSortRows(labelRows, activeParameterFilter, normalizedCriteriaSearch, sortKey, parameterOrder),
    [activeParameterFilter, labelRows, normalizedCriteriaSearch, parameterOrder, sortKey],
  );

  useEffect(() => {
    setParameterFilter(defaultParameterFilter);
    setCriteriaSearch("");
  }, [activeCriteriaTab, defaultParameterFilter]);

  useEffect(() => {
    if (value !== "list" && !availableCriteriaTabValues.includes(value)) {
      onValueChange("list");
    }
  }, [availableCriteriaTabValues, onValueChange, value]);

  const handleTabChange = (next: string) => {
    setParameterFilter("");
    setCriteriaSearch("");
    onValueChange(next as ParameterCriteriaTab);
  };

  return (
    <Tabs value={selectedTabValue} onValueChange={handleTabChange}>
      <TabsList className="mb-4 h-auto w-full flex-wrap justify-start gap-1 lg:w-auto">
        <TabsTrigger value="list">ทั้งหมด</TabsTrigger>
        {criteriaTabOptions.map((tab) => (
          <TabsTrigger key={tab.value} value={tab.value}>{tab.label}</TabsTrigger>
        ))}
      </TabsList>

      {selectedTabValue !== "list" ? (
        <div className="mb-4 flex flex-col gap-3 rounded-md border bg-muted/20 p-3 sm:flex-row sm:items-end">
          <label className="flex min-w-0 flex-col gap-1 text-xs font-medium text-muted-foreground sm:min-w-[260px] sm:flex-1">
            ค้นหาเกณฑ์
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                aria-label="ค้นหาเกณฑ์"
                value={criteriaSearch}
                onChange={(event) => setCriteriaSearch(event.target.value)}
                placeholder="ค้นหาสาร / ค่าเกณฑ์..."
                className="h-9 bg-background pl-8"
              />
            </div>
          </label>
          <label className="flex min-w-0 flex-col gap-1 text-xs font-medium text-muted-foreground sm:min-w-[220px]">
            Parameter
            <NativeSelect
              aria-label="เลือก Parameter"
              className="h-9 bg-background"
              value={activeParameterFilter}
              onChange={(event) => setParameterFilter(event.target.value)}
            >
              {parameterOptions.map((parameter) => (
                <option key={parameter._id} value={parameter._id}>
                  {parameter.name}
                </option>
              ))}
            </NativeSelect>
          </label>
          <label className="flex min-w-0 flex-col gap-1 text-xs font-medium text-muted-foreground sm:min-w-[220px]">
            เรียงลำดับ
            <NativeSelect
              aria-label="เรียงลำดับ"
              className="h-9 bg-background"
              value={sortKey}
              onChange={(event) =>
                setSortKeyByTab((current) => ({
                  ...current,
                  [activeCriteriaTab]: event.target.value as CriteriaSortKey,
                }))
              }
            >
              {sortOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </NativeSelect>
          </label>
        </div>
      ) : null}

      <TabsContent value="list" className="mt-0">
        {children}
      </TabsContent>

      <TabsContent value="substance" className="mt-0">
        <TableShell empty={visibleSubstanceRows.length === 0}>
          <Table className="min-w-[980px]">
            <TableHeader>
              <ParameterTitleRow title={selectedParameterName} colSpan={7} />
              <TableRow>
                <TableHead>สาร</TableHead>
                <TableHead>รหัสสินค้า</TableHead>
                <TableHead>ขนาดบรรจุ</TableHead>
                <TableHead>Master item</TableHead>
                <TableHead>ค่าต่ำสุด</TableHead>
                <TableHead>ค่าต่ำสุด 2</TableHead>
                <TableHead className="text-right">แก้ไข</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleSubstanceRows.map((row) => (
                <TableRow
                  key={row.rowId}
                  className="cursor-pointer"
                  onClick={() => onEditField("substance", row.parameterId, row.fieldIndex, row.ruleIndex)}
                >
                  <TableCell>{row.substance}</TableCell>
                  <TableCell>{row.itemNo || "-"}</TableCell>
                  <TableCell>{row.packSize || "-"}</TableCell>
                  <TableCell>
                    {row.masterItemName || row.masterCommonName || row.rawMasterText ? (
                      <div className="min-w-0 space-y-0.5 text-xs">
                        {row.masterItemName ? <div className="font-medium text-foreground">{row.masterItemName}</div> : null}
                        {row.masterCommonName ? <div className="text-muted-foreground">{row.masterCommonName}</div> : null}
                        {row.rawMasterText ? (
                          <div className="max-w-[280px] truncate font-mono text-[11px] text-muted-foreground" title={row.rawMasterText}>
                            {row.rawMasterText}
                          </div>
                        ) : null}
                      </div>
                    ) : (
                      "-"
                    )}
                  </TableCell>
                  <TableCell>{row.value ?? "-"}</TableCell>
                  <TableCell>{row.value2 ?? "-"}</TableCell>
                  <TableCell className="text-right">
                    <EditButton
                      label={`แก้ไขเกณฑ์สาร ${row.fieldLabel}`}
                      onClick={() => onEditField("substance", row.parameterId, row.fieldIndex, row.ruleIndex)}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableShell>
      </TabsContent>

      <TabsContent value="conditional" className="mt-0">
        <TableShell empty={visibleConditionalRows.length === 0}>
          <Table className="min-w-[820px]">
            <TableHeader>
              <ParameterTitleRow title={selectedParameterName} colSpan={5} />
              <TableRow>
                <TableHead>กฎที่</TableHead>
                <TableHead>ชื่อกฎ</TableHead>
                <TableHead>เงื่อนไข</TableHead>
                <TableHead>ผลลัพธ์</TableHead>
                <TableHead className="text-right">แก้ไข</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleConditionalRows.map((row) => (
                <TableRow key={row.rowId}>
                  <TableCell>{row.ruleIndex == null ? "-" : row.ruleIndex + 1}</TableCell>
                  <TableCell>{row.ruleLabel}</TableCell>
                  <TableCell>{row.conditionsText}</TableCell>
                  <TableCell>{row.resultText}</TableCell>
                  <TableCell className="text-right">
                    <EditButton
                      label={`แก้ไขกฎ ${row.fieldLabel}`}
                      onClick={() => onEditField("conditional", row.parameterId, row.fieldIndex, row.ruleIndex)}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableShell>
      </TabsContent>

      <TabsContent value="labelTolerance" className="mt-0">
        <TableShell empty={visibleLabelRows.length === 0}>
          <Table className={showHeadCriteriaColumns ? "min-w-[1100px]" : "min-w-[780px]"}>
            <TableHeader>
              <ParameterTitleRow title={selectedParameterName} colSpan={showHeadCriteriaColumns ? 7 : 4} />
              <TableRow>
                <TableHead>%สาร</TableHead>
                {showHeadCriteriaColumns ? <TableHead>เกณฑ์คลาดเคลื่อน (%,+-)</TableHead> : null}
                <TableHead>เกณฑ์กลาง</TableHead>
                <TableHead>ค่าต่ำสุด</TableHead>
                {showHeadCriteriaColumns ? (
                  <>
                    <TableHead>25% ล่าง</TableHead>
                    <TableHead>25% บน</TableHead>
                  </>
                ) : null}
                <TableHead>ค่าสูงสุด</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleLabelRows.map((row) => (
                <TableRow key={row.rowId}>
                  <TableCell>
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-medium tabular-nums">{row.selectorText}</span>
                      <EditButton
                        label={`แก้ไขเกณฑ์ %สาร ${row.fieldLabel}`}
                        onClick={() => onEditField("labelTolerance", row.parameterId, row.fieldIndex, row.ruleIndex)}
                      />
                    </div>
                  </TableCell>
                  {showHeadCriteriaColumns ? <TableCell>{row.tolerancePercent}</TableCell> : null}
                  <TableCell>{row.headTolerance}</TableCell>
                  <TableCell>{row.failLow}</TableCell>
                  {showHeadCriteriaColumns ? (
                    <>
                      <TableCell>{row.passLow}</TableCell>
                      <TableCell>{row.passHigh}</TableCell>
                    </>
                  ) : null}
                  <TableCell>{row.failHigh}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableShell>
      </TabsContent>
    </Tabs>
  );
}

function isSpecificGravityParameter(parameter: ParameterOption) {
  return [parameter.name, ...(parameter.valueFields ?? []).map((field) => field.label)]
    .some((value) => normalizeCriteriaSearchText(value).includes("ถพ"));
}

function ParameterTitleRow({ title, colSpan }: { title: string; colSpan: number }) {
  return (
    <TableRow>
      <TableHead colSpan={colSpan} className="bg-muted/40 text-sm font-semibold text-foreground">
        {title}
      </TableHead>
    </TableRow>
  );
}

function filterAndSortRows<T extends SortableCriteriaRow>(
  rows: T[],
  parameterFilter: string,
  searchQuery: string,
  sortKey: CriteriaSortKey,
  parameterOrder: Map<string, number>,
) {
  const filtered = rows
    .filter(
      (row) =>
        Boolean(parameterFilter) &&
        row.parameterId === parameterFilter &&
        matchesCriteriaSearch(row, searchQuery),
    )
    .slice()
    .sort(compareCriteriaRows(sortKey, parameterOrder));
  return rankSearchResults(filtered, searchQuery, (row) => {
    const searchable = row as unknown as Record<string, unknown>;
    return {
      primary: [normalizeCriteriaSearchText(row.itemNo || row.substance || searchable.ruleLabel || searchable.selectorText || row.parameterName)],
      secondary: [row.searchText, ...SEARCHABLE_ROW_KEYS.map((key) => searchable[key])].map(normalizeCriteriaSearchText),
    };
  });
}

function matchesCriteriaSearch(row: SortableCriteriaRow, searchQuery: string) {
  if (!searchQuery) return true;
  const searchable = row as unknown as Record<string, unknown>;
  const rowSearchText = normalizeCriteriaSearchText(searchable.searchText);
  if (rowSearchText.includes(searchQuery)) return true;
  return SEARCHABLE_ROW_KEYS.some((key) => {
    const value = searchable[key];
    if (value == null) return false;
    if (Array.isArray(value)) {
      return value.some((item) => normalizeCriteriaSearchText(item).includes(searchQuery));
    }
    return normalizeCriteriaSearchText(value).includes(searchQuery);
  });
}

function normalizeCriteriaSearchText(value: unknown) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/%\s+/g, "%")
    .trim();
}

function compareCriteriaRows<T extends SortableCriteriaRow>(
  sortKey: CriteriaSortKey,
  parameterOrder: Map<string, number>,
) {
  const defaultCompare = (a: T, b: T) => compareByParameterOrder(a, b, parameterOrder);
  return (a: T, b: T) => {
    if (sortKey === "parameterName") {
      return (
        criteriaCollator.compare(a.parameterName, b.parameterName) ||
        criteriaCollator.compare(a.fieldLabel, b.fieldLabel) ||
        defaultCompare(a, b)
      );
    }
    if (sortKey === "substanceAsc" || sortKey === "substanceDesc") {
      return compareSubstance(a, b, sortKey === "substanceAsc" ? "asc" : "desc") || defaultCompare(a, b);
    }
    if (sortKey === "minValueAsc" || sortKey === "minValueDesc") {
      return compareNullableNumber(a.value, b.value, sortKey === "minValueAsc" ? "asc" : "desc") || defaultCompare(a, b);
    }
    if (sortKey === "maxValueAsc" || sortKey === "maxValueDesc") {
      return compareNullableNumber(a.value2, b.value2, sortKey === "maxValueAsc" ? "asc" : "desc") || defaultCompare(a, b);
    }
    if (sortKey === "drugPercentAsc" || sortKey === "drugPercentDesc") {
      return compareDrugPercent(a, b, sortKey === "drugPercentAsc" ? "asc" : "desc") || defaultCompare(a, b);
    }
    return defaultCompare(a, b);
  };
}

function compareByParameterOrder<T extends SortableCriteriaRow>(
  a: T,
  b: T,
  parameterOrder: Map<string, number>,
) {
  return (
    (parameterOrder.get(a.parameterId) ?? Number.MAX_SAFE_INTEGER) -
      (parameterOrder.get(b.parameterId) ?? Number.MAX_SAFE_INTEGER) ||
    a.fieldIndex - b.fieldIndex ||
    (a.ruleIndex ?? -1) - (b.ruleIndex ?? -1) ||
    criteriaCollator.compare(a.fieldLabel, b.fieldLabel)
  );
}

function compareSubstance<T extends SortableCriteriaRow>(a: T, b: T, direction: "asc" | "desc") {
  const result = criteriaCollator.compare(a.substance ?? "", b.substance ?? "");
  return direction === "asc" ? result : -result;
}

function compareNullableNumber(
  aValue: number | null | undefined,
  bValue: number | null | undefined,
  direction: "asc" | "desc",
) {
  if (aValue == null && bValue == null) return 0;
  if (aValue == null) return 1;
  if (bValue == null) return -1;
  const aNumber = Number(aValue);
  const bNumber = Number(bValue);
  const aValid = Number.isFinite(aNumber);
  const bValid = Number.isFinite(bNumber);
  if (!aValid && !bValid) return 0;
  if (!aValid) return 1;
  if (!bValid) return -1;
  return direction === "asc" ? aNumber - bNumber : bNumber - aNumber;
}

function compareDrugPercent<T extends SortableCriteriaRow>(a: T, b: T, direction: "asc" | "desc") {
  const aValue = parseDrugPercent(a);
  const bValue = parseDrugPercent(b);
  if (aValue == null && bValue == null) return 0;
  if (aValue == null) return 1;
  if (bValue == null) return -1;
  return direction === "asc" ? aValue - bValue : bValue - aValue;
}

function parseDrugPercent(row: SortableCriteriaRow) {
  const value = Number(row.drugPercent);
  return Number.isFinite(value) ? value : null;
}

function TableShell({ empty, children }: { empty: boolean; children: ReactNode }) {
  if (empty) {
    return (
      <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
        ไม่มีรายการเกณฑ์ในแท็บนี้
      </div>
    );
  }
  return <div className="overflow-x-auto rounded-md border">{children}</div>;
}

function EditButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={label}
      title={label}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
    >
      <Pencil className="h-4 w-4" />
    </Button>
  );
}
