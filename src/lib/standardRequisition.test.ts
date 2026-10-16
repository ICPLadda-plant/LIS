import { describe, it, expect } from "vitest";
import {
  defaultWeightCount,
  findStandardBottleBySearch,
  requisitionUser,
  standardMatchesRequisitionSearch,
  standardRequisitionSearchScore,
  sumWeights,
  validateWeights,
} from "./standardRequisition";

describe("defaultWeightCount", () => {
  it("gc → 3, hplc → 1, unknown → 1", () => {
    expect(defaultWeightCount("gc")).toBe(3);
    expect(defaultWeightCount("hplc")).toBe(1);
    expect(defaultWeightCount(undefined)).toBe(1);
  });
});

describe("sumWeights", () => {
  it("sums, ignoring NaN", () => {
    expect(sumWeights([9.8, 10.3, 10.1])).toBeCloseTo(30.2);
    expect(sumWeights([Number.NaN, 5])).toBe(5);
    expect(sumWeights([])).toBe(0);
  });
});

describe("requisitionUser", () => {
  it("map user → _user payload (email + name) ให้ backend ลง ผู้ดำเนินการ", () => {
    expect(requisitionUser({ email: "a@icpladda.com", name: "สมชาย" })).toEqual({
      email: "a@icpladda.com",
      name: "สมชาย",
    });
  });
  it("ไม่มี user (ยังไม่ login) → undefined ไม่ใช่ object ว่าง", () => {
    expect(requisitionUser(null)).toBeUndefined();
    expect(requisitionUser(undefined)).toBeUndefined();
  });
});

describe("validateWeights", () => {
  it("all weights must be > 0", () => {
    expect(validateWeights([0, 5], 100)).toBe("กรุณากรอก mg ทุกน้ำหนักให้มากกว่า 0");
    expect(validateWeights([], 100)).toBe("กรุณากรอก mg ทุกน้ำหนักให้มากกว่า 0");
  });
  it("total must not exceed remaining", () => {
    expect(validateWeights([60, 60], 100)).toBe("mg รวมเกินปริมาณคงเหลือของขวด");
  });
  it("allows using the displayed total when remaining has floating-point residue", () => {
    expect(validateWeights([0.02], 0.01999999999999602)).toBe("");
  });
  it("ok returns empty string", () => {
    expect(validateWeights([10, 10, 10], 100)).toBe("");
  });
});

describe("standard requisition search", () => {
  const units = [
    { qrId: "qr-primary-1", itemCode: "67", itemName: "Metalaxyl", labelCode: "676901", lotNo: "LOT-A" },
    { qrId: "qr-working-1", itemCode: "67", itemName: "Metalaxyl", labelCode: "676902", lotNo: "LOT-B" },
  ];

  it("ค้นหา standard ด้วยเลขขวดที่ติดกับ QR code ได้", () => {
    expect(standardMatchesRequisitionSearch({ code: "67", name: "Metalaxyl" }, units, "676902")).toBe(true);
  });

  it("เลือกขวดที่ตรงกับเลขขวดที่พิมพ์", () => {
    expect(findStandardBottleBySearch(units, "676902")?.qrId).toBe("qr-working-1");
  });

  it("เลือกขวดได้เมื่อพิมพ์เลขขวดตอนแป้นเป็นไทย", () => {
    expect(standardMatchesRequisitionSearch({ code: "67", name: "Metalaxyl" }, units, "ุึุตจ/")).toBe(true);
    expect(findStandardBottleBySearch(units, "ุึุตจ/")?.qrId).toBe("qr-working-1");
  });

  it("เลือกขวดได้เมื่อพิมพ์เลขไทยจากมือถือหรือ iPad", () => {
    expect(standardMatchesRequisitionSearch({ code: "67", name: "Metalaxyl" }, units, "๖๗๖๙๐๒")).toBe(true);
    expect(findStandardBottleBySearch(units, "๖๗๖๙๐๒")?.qrId).toBe("qr-working-1");
  });

  it("ยังค้นหาด้วยชื่อและ code ของ standard ได้เหมือนเดิม", () => {
    expect(standardMatchesRequisitionSearch({ code: "67", name: "Metalaxyl" }, units, "Metal")).toBe(true);
    expect(standardMatchesRequisitionSearch({ code: "67", name: "Metalaxyl" }, units, "67")).toBe(true);
  });

  it("ranks code and bottle aliases ahead of names with keyboard fallbacks", () => {
    const standard = { code: "67", name: "Metalaxyl" };
    const nameMatch = { code: "OTHER", name: "676902" };
    for (const query of ["676902", "ุึุตจ/", "๖๗๖๙๐๒"]) {
      expect(standardRequisitionSearchScore(standard, units, query)).toBeGreaterThan(
        standardRequisitionSearchScore(nameMatch, [], query),
      );
    }
    expect(standardRequisitionSearchScore(standard, units, "67")).toBe(6);
    expect(standardRequisitionSearchScore(standard, units, "qr-working-1")).toBe(6);
    expect(standardRequisitionSearchScore(standard, units, "LOT-B")).toBe(6);
    expect(standardRequisitionSearchScore(standard, units, "missing")).toBe(0);
    expect(standardRequisitionSearchScore(standard, units, " ")).toBe(0);
  });
});
