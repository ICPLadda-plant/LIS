import { describe, expect, it } from "vitest";
import { NAV_ITEMS, type NavItem } from "@/lib/navItems";
import { pickMobileNavItems } from "../MobileBottomNav";

const allow = (paths: string[]) => (item: NavItem) => paths.includes(item.path);
const paths = (items: NavItem[]) => items.map((i) => i.path);

describe("pickMobileNavItems", () => {
  it("uses the role's preferred order when every item is accessible", () => {
    expect(paths(pickMobileNavItems(["qc-staff"], () => true))).toEqual([
      "/home",
      "/qc-testing",
      "/qc-approval",
      "/petition",
    ]);
  });

  it("never shows a menu the user cannot access and fills from accessible ones", () => {
    const picked = pickMobileNavItems(["lab-analyze"], allow(["/home", "/lab-testing", "/coa"]));
    expect(paths(picked)).toEqual(["/home", "/lab-testing", "/coa"]);
  });

  it("caps at four items and skips Validation as filler", () => {
    const picked = pickMobileNavItems(["viewer"], () => true, NAV_ITEMS);
    expect(picked).toHaveLength(4);
    expect(paths(picked)).not.toContain("/validation");
  });
});
