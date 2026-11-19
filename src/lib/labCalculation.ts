import { aiSubstancesForItem } from "@/lib/aiSubstanceFields";
import type { LabReportPage } from "@/lib/labReport";
import type { ApprovalItemGroup } from "@/lib/qcApprovalRows";
import type { Petition } from "@/types/petition.types";

export function buildLabCalculationPages(
  petition: Petition,
  pages: LabReportPage[],
  groups: ApprovalItemGroup[],
): LabReportPage[] {
  return pages.flatMap((page, index) => {
    const seq = petition.items?.[index]?.seq;
    const group = groups.find((entry) => entry.seq === seq);
    if (!group) return [page];

    const rows = group.params.flatMap((parameter) => parameter.rows.map((row) => ({
      testItem: `${row.label}${row.unit ? ` (${row.unit})` : ""}`,
      result: row.value || "-",
      criteria: "-",
      method: "-",
    })));
    const substances = aiSubstancesForItem(group.commonName);
    if (substances.length === 0) return [{ ...page, rows: [...rows, ...page.rows] }];

    return substances.map((substance) => {
      const escapedName = substance.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const suffix = new RegExp(`\\s+—\\s+${escapedName}(?=\\s*(·|\\(|$))`, "i");
      const ownRows = rows
        .filter((row) => !/\s—\s/.test(row.testItem) || suffix.test(row.testItem))
        .map((row) => ({ ...row, testItem: row.testItem.replace(suffix, "") }));
      return { ...page, sample: { ...page.sample, name: substance.raw }, rows: [...ownRows, ...page.rows] };
    });
  });
}
