import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useAccessibleTabs } from "./useAccessibleTabs";

// Mutable mock the hook reads each render.
const mock = { permissions: [] as string[], isAdmin: false };
vi.mock("./useEffectivePermissions", () => ({
  useEffectivePermissions: () => mock,
}));

describe("useAccessibleTabs (deny model)", () => {
  it("shows all registry tabs by default (nothing denied)", () => {
    mock.permissions = [];
    mock.isAdmin = false;
    const { result } = renderHook(() => useAccessibleTabs("/stock"));
    expect(result.current.visibleKeys).toEqual([
      "standard",
      "solvent",
      "glassware",
      "history",
    ]);
  });

  it("hides a denied tab", () => {
    mock.permissions = ["deny:/stock/history"];
    mock.isAdmin = false;
    const { result } = renderHook(() => useAccessibleTabs("/stock"));
    expect(result.current.isVisible("history")).toBe(false);
    expect(result.current.visibleKeys).not.toContain("history");
  });

  it("adminOnly tab is hidden for non-admin, shown for admin", () => {
    mock.permissions = [];
    mock.isAdmin = false;
    expect(renderHook(() => useAccessibleTabs("/settings")).result.current.isVisible("line")).toBe(false);
    mock.isAdmin = true;
    expect(renderHook(() => useAccessibleTabs("/settings")).result.current.isVisible("line")).toBe(true);
  });

  it("admin ignores deny tokens", () => {
    mock.permissions = ["deny:/stock/history"];
    mock.isAdmin = true;
    const { result } = renderHook(() => useAccessibleTabs("/stock"));
    expect(result.current.isVisible("history")).toBe(true);
  });

  it("keeps an unregistered key visible", () => {
    mock.permissions = [];
    mock.isAdmin = false;
    const { result } = renderHook(() => useAccessibleTabs("/stock"));
    expect(result.current.isVisible("nonexistent")).toBe(true);
  });

  it("defaultKey falls back to the first visible key", () => {
    mock.permissions = ["deny:/stock/standard"];
    mock.isAdmin = false;
    const { result } = renderHook(() => useAccessibleTabs("/stock"));
    expect(result.current.defaultKey).toBe("solvent");
  });
});
