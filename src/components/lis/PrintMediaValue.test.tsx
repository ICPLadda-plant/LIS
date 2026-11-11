import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PrintMediaValue } from "./PrintMediaValue";

describe("PrintMediaValue", () => {
  it("แสดงรูปจากข้อความ path ที่คั่นด้วยจุลภาค (รายงาน LAB / COA)", () => {
    const a = "/LIS/uploads/qc-photos/a.jpg";
    const b = "/LIS/api/uploads/qc-photos/b.png";
    render(<PrintMediaValue value={`${a},${b}`} />);
    const images = screen.getAllByAltText("รูปผลการทดสอบ");
    expect(images).toHaveLength(2);
    expect(images[1].getAttribute("src")).toContain("/LIS/uploads/qc-photos/b.png");
    expect(screen.queryByText(new RegExp(a))).toBeNull();
  });

  it("วิดีโอแสดงชื่อไฟล์ และค่าปกติแสดงเป็นข้อความ", () => {
    const { rerender } = render(<PrintMediaValue value="/LIS/uploads/qc-photos/clip.mp4" />);
    expect(screen.getByText("วิดีโอ: clip.mp4")).toBeTruthy();
    rerender(<PrintMediaValue value="98.5">98.5 %</PrintMediaValue>);
    expect(screen.getByText("98.5 %")).toBeTruthy();
  });
});
