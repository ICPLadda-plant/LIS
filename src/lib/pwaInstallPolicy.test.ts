import { describe, expect, it } from "vitest";
import { requiresPwaInstall, type PwaInstallPolicyInput } from "./pwaInstallPolicy";

const base: PwaInstallPolicyInput = {
  user: { roles: ["lab-analyze"], department: "Lab" },
  isProductionSession: false,
  pathname: "/home",
  isStandalone: false,
  isDesktop: true,
};

describe("requiresPwaInstall", () => {
  it("requires install for Lab and QC roles in a desktop browser tab", () => {
    expect(requiresPwaInstall(base)).toBe(true);
    expect(requiresPwaInstall({ ...base, user: { roles: ["qc-staff"] } })).toBe(true);
    expect(requiresPwaInstall({ ...base, user: { role: "qc-head" } })).toBe(true);
  });

  it("does not require install for other roles", () => {
    expect(requiresPwaInstall({ ...base, user: { roles: ["viewer"] } })).toBe(false);
    expect(requiresPwaInstall({ ...base, user: { roles: ["admin"] } })).toBe(false);
  });

  it("exempts production users even when they hold a Lab/QC role", () => {
    expect(requiresPwaInstall({ ...base, isProductionSession: true })).toBe(false);
    expect(requiresPwaInstall({ ...base, user: { roles: ["qc-staff"], department: "ผลิต 1" } })).toBe(false);
  });

  it("skips installed apps, phones, kiosk pages and unapproved accounts", () => {
    expect(requiresPwaInstall({ ...base, isStandalone: true })).toBe(false);
    expect(requiresPwaInstall({ ...base, isAppInstalled: true })).toBe(false);
    expect(requiresPwaInstall({ ...base, isDesktop: false })).toBe(false);
    expect(requiresPwaInstall({ ...base, pathname: "/queue/lab" })).toBe(false);
    expect(requiresPwaInstall({ ...base, pathname: "/scanner" })).toBe(false);
    expect(requiresPwaInstall({ ...base, user: { roles: ["lab"], approvalStatus: "pending" } })).toBe(false);
  });
});
