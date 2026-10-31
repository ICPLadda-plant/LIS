import { describe, it, expect } from "vitest";
import {
  tabsFor,
  configurableTabsFor,
  tabPath,
  denyToken,
  isTabDenied,
  PAGES_WITH_TABS,
} from "./tabRegistry";

describe("tabRegistry", () => {
  it("returns [] for a page with no registered tabs", () => {
    expect(tabsFor("/nope")).toEqual([]);
  });

  it("configurableTabsFor drops adminOnly tabs", () => {
    const keys = configurableTabsFor("/settings").map((t) => t.key);
    expect(keys).toContain("dashboard");
    expect(keys).not.toContain("line");
  });

  it("tabsFor keeps adminOnly tabs", () => {
    expect(tabsFor("/settings").map((t) => t.key)).toContain("line");
  });

  it("stock deduction has no tab registry", () => {
    expect(tabsFor("/stock-deduction")).toEqual([]);
    expect(PAGES_WITH_TABS).not.toContain("/stock-deduction");
  });

  it("stock does not include the six month medicine list tab", () => {
    expect(tabsFor("/stock").map((tab) => tab.key)).not.toContain("medicine-six-months");
  });

  it("stock does not include the FG quality inspection alert tab", () => {
    expect(tabsFor("/stock").map((tab) => tab.key)).not.toContain("fg-quality-alerts");
  });

  it("builds tab + deny tokens", () => {
    expect(tabPath("/stock", "history")).toBe("/stock/history");
    expect(denyToken("/stock", "history")).toBe("deny:/stock/history");
  });

  it("isTabDenied reflects token presence", () => {
    expect(isTabDenied(["deny:/stock/history"], "/stock", "history")).toBe(true);
    expect(isTabDenied([], "/stock", "history")).toBe(false);
    expect(isTabDenied(["/stock"], "/stock", "history")).toBe(false);
  });

  it("PAGES_WITH_TABS lists the registered pages", () => {
    expect(PAGES_WITH_TABS).toEqual(
      expect.arrayContaining(["/stock", "/settings", "/report", "/admin-data", "/qc-approval"]),
    );
  });

  it("qc-approval exposes QC and Lab tabs as configurable rows", () => {
    expect(configurableTabsFor("/qc-approval").map((t) => t.key)).toEqual(["qc", "lab"]);
  });
});
