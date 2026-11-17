import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import BalanceControlChart from "../BalanceControlChart";
import { chartDomain, computeLimits, displayDigits } from "@/lib/balanceControlChart";

// LD-005 ละเอียด 2 ตำแหน่ง → ทั้งจุดและ tick แกน Y ต้องแสดง 2 ตำแหน่ง
describe("BalanceControlChart", () => {
  it("labels the Y axis with the scale decimals", () => {
    const limits = computeLimits(9.9995, 0.0051)!;
    const series = [{ day: 1, date: "2026-11-01", value: 10.0032, record: null }];
    render(
      <BalanceControlChart
        series={series}
        limits={limits}
        domain={chartDomain(limits, [10.0032])!}
        digits={displayDigits(2, limits.sd)}
        fixed
      />,
    );
    const ticks = screen.getAllByText(/^\d+\.\d+$/).map((node) => node.textContent ?? "");
    expect(ticks.length).toBeGreaterThan(0);
    expect(ticks.every((tick) => tick.split(".")[1].length === 2)).toBe(true);
  });
});

  it("keeps LD-005 axis ticks at two decimals when limits are close together", () => {
    const limits = computeLimits(9.9995, 0.0051)!;
    const series = [{ day: 1, date: "2026-11-01", value: 10.0032, record: null }];
    const { container } = render(
      <BalanceControlChart
        series={series}
        limits={limits}
        domain={chartDomain(limits, [10.0032])!}
        digits={displayDigits(2, limits.sd)}
        fixed
      />,
    );
    const texts = Array.from(container.querySelectorAll("text")).map((node) => node.textContent ?? "");
    expect(texts).toMatchObject(expect.arrayContaining(["10.00"]));
    expect(texts.filter((t) => /^\d+\.\d{3,}$/.test(t))).toEqual([]);
  });
