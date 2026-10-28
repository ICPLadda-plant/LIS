import { describe, it, expect } from "vitest";
import { customerCodeFromDepartment } from "./customerCode";

describe("customerCodeFromDepartment", () => {
  it("maps production lines 1–5 in Thai and English variants", () => {
    expect(customerCodeFromDepartment("ผลิต 1")).toBe("TI P01");
    expect(customerCodeFromDepartment("ผลิต2")).toBe("TI P02");
    expect(customerCodeFromDepartment("Production 3")).toBe("TI P03");
    expect(customerCodeFromDepartment("prod 4")).toBe("TI P04");
    expect(customerCodeFromDepartment("ผลิต  5")).toBe("TI P05");
  });

  it("maps inter trade / QC / R&D", () => {
    expect(customerCodeFromDepartment("inter trade")).toBe("TI INT");
    expect(customerCodeFromDepartment("Inter Trade")).toBe("TI INT");
    expect(customerCodeFromDepartment("QC")).toBe("TI QC");
    expect(customerCodeFromDepartment("QC Reviewer")).toBe("TI QC");
    expect(customerCodeFromDepartment("วิจัยพัฒนา")).toBe("TI RD");
    expect(customerCodeFromDepartment("R&D")).toBe("TI RD");
  });

  it("falls back to the raw department when it cannot be mapped", () => {
    expect(customerCodeFromDepartment("ผลิต")).toBe("");
    expect(customerCodeFromDepartment("lab")).toBe("");
    expect(customerCodeFromDepartment("LDI")).toBe("TI INT");
    expect(customerCodeFromDepartment("ผลิต 01")).toBe("TI P01");
    expect(customerCodeFromDepartment("คลังสินค้า RM")).toBe("TI WH");
    expect(customerCodeFromDepartment("ควบคุมคุณภาพ")).toBe("TI QC");
  });

  it("returns empty string for blank/missing input", () => {
    expect(customerCodeFromDepartment("")).toBe("");
    expect(customerCodeFromDepartment(undefined)).toBe("");
    expect(customerCodeFromDepartment(null)).toBe("");
  });
});
