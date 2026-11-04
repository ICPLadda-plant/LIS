import { describe, it, expect } from "vitest";
import { userCanAccessPath } from "./accessControl";

const groups = [
  { id: "samples", paths: ["/petitions", "/petitions/:id", "/send-sample"] },
  { id: "reports", paths: ["/report"] },
  { id: "others", paths: [] },
];

describe("userCanAccessPath", () => {
  it("lets admin access any path", () => {
    const user = { role: "admin", status: "active" as const, permissions: [] };
    expect(userCanAccessPath(user, "/anything", groups)).toBe(true);
  });

  it("grants access when the exact path is in permissions", () => {
    const user = { role: "lab", status: "active" as const, permissions: ["/report"] };
    expect(userCanAccessPath(user, "/report", groups)).toBe(true);
  });

  it("denies a path that is not in permissions", () => {
    const user = { role: "lab", status: "active" as const, permissions: ["/report"] };
    expect(userCanAccessPath(user, "/send-sample", groups)).toBe(false);
  });

  it("matches a pattern path entry against a concrete pathname", () => {
    const user = { role: "lab", status: "active" as const, permissions: ["/petitions/:id"] };
    expect(userCanAccessPath(user, "/petitions/123", groups)).toBe(true);
  });

  it("honors a legacy group-id entry by granting all its paths", () => {
    const user = { role: "lab", status: "active" as const, permissions: ["samples"] };
    expect(userCanAccessPath(user, "/send-sample", groups)).toBe(true);
  });

  it("does not let a legacy group-id entry leak into other groups", () => {
    const user = { role: "lab", status: "active" as const, permissions: ["samples"] };
    expect(userCanAccessPath(user, "/report", groups)).toBe(false);
  });

  it("legacy 'others' entry grants paths not covered by any other group", () => {
    const user = { role: "lab", status: "active" as const, permissions: ["others"] };
    expect(userCanAccessPath(user, "/unmapped-page", groups)).toBe(true);
  });

  it("legacy 'others' entry does not grant a path covered by another group", () => {
    const user = { role: "lab", status: "active" as const, permissions: ["others"] };
    expect(userCanAccessPath(user, "/report", groups)).toBe(false);
  });

  it("denies an inactive user even with a matching path", () => {
    const user = { role: "lab", status: "inactive" as const, permissions: ["/report"] };
    expect(userCanAccessPath(user, "/report", groups)).toBe(false);
  });

  it("denies a user with no role", () => {
    const user = { status: "active" as const, permissions: ["/report"] };
    expect(userCanAccessPath(user, "/report", groups)).toBe(false);
  });

  it("denies a user with empty permissions", () => {
    const user = { role: "lab", status: "active" as const, permissions: [] };
    expect(userCanAccessPath(user, "/report", groups)).toBe(false);
  });

  it("denies a null user", () => {
    expect(userCanAccessPath(null, "/report", groups)).toBe(false);
  });

  describe("public pages", () => {
    it("lets any signed-in user reach the scanner and queue TV pages without permissions", () => {
      const user = { role: "viewer", status: "active" as const, permissions: [] };
      expect(userCanAccessPath(user, "/scanner", groups)).toBe(true);
      expect(userCanAccessPath(user, "/queue/lab", groups)).toBe(true);
      expect(userCanAccessPath(user, "/queue/qc", groups)).toBe(true);
    });

    it("still blocks an inactive account from public pages", () => {
      const user = { role: "viewer", status: "inactive" as const, permissions: [] };
      expect(userCanAccessPath(user, "/scanner", groups)).toBe(false);
    });

    it("does not treat a non-public page as open", () => {
      const user = { role: "viewer", status: "active" as const, permissions: [] };
      expect(userCanAccessPath(user, "/queue", groups)).toBe(false);
    });
  });

  describe("implied sub-pages", () => {
    // Granting a parent nav page should ride along to its detail/sub pages.
    const navGroups = [
      { id: "petitions", paths: ["/petition"] },
      { id: "results", paths: ["/record-results"] },
      { id: "lab", paths: ["/lab-testing"] },
      { id: "others", paths: [] },
    ];

    it("does not grant retired petition-old pages when /petition is granted", () => {
      const user = { role: "lab", status: "active" as const, permissions: ["/petition"] };
      expect(userCanAccessPath(user, "/petitions-old/123", navGroups)).toBe(false);
    });

    it("grants the canonical new petition page when /petition is granted", () => {
      const user = { role: "lab", status: "active" as const, permissions: ["/petition"] };
      expect(userCanAccessPath(user, "/petitions/new", navGroups)).toBe(true);
      expect(userCanAccessPath(user, "/petitions-old/new", navGroups)).toBe(false);
      expect(userCanAccessPath(user, "/petitions-old/123/edit", navGroups)).toBe(false);
    });

    it("grants sub-pages through a legacy group-id entry", () => {
      const user = { role: "lab", status: "active" as const, permissions: ["petitions"] };
      expect(userCanAccessPath(user, "/petition/123", navGroups)).toBe(true);
    });

    it("grants the lab testing detail page when /lab-testing is granted", () => {
      const user = { role: "lab", status: "active" as const, permissions: ["/lab-testing"] };
      expect(userCanAccessPath(user, "/lab-testing/abc", navGroups)).toBe(true);
    });

    it("grants the lab approval review page when /lab-approval is granted", () => {
      const user = { role: "lab-head", status: "active" as const, permissions: ["/lab-approval"] };
      expect(userCanAccessPath(user, "/lab-approval/abc", navGroups)).toBe(true);
    });

    it("grants the MF gap medicine list when lab send conditions is granted", () => {
      const user = { role: "lab", status: "active" as const, permissions: ["/lab-send-conditions"] };
      expect(userCanAccessPath(user, "/mf-gap-medicines", navGroups)).toBe(true);
    });

    it("grants the COA detail page when /coa is granted", () => {
      const user = { role: "qc-head", status: "active" as const, permissions: ["/coa"] };
      expect(userCanAccessPath(user, "/coa/abc", navGroups)).toBe(true);
    });

    it("grants the petition timeline detail page when /petition is granted", () => {
      const user = { role: "lab", status: "active" as const, permissions: ["/petition"] };
      expect(userCanAccessPath(user, "/petition/abc", navGroups)).toBe(true);
    });

    it("keeps Assign Lab as a separate current petition permission", () => {
      const user = { role: "lab", status: "active" as const, permissions: ["/petition"] };
      const assignUser = { role: "lab", status: "active" as const, permissions: ["/petition/assign"] };

      expect(userCanAccessPath(user, "/petition/assign", navGroups)).toBe(false);
      expect(userCanAccessPath(assignUser, "/petition/assign", navGroups)).toBe(true);
    });

    it("grants result detail from /record-results without granting petition detail", () => {
      const user = { role: "lab", status: "active" as const, permissions: ["/record-results"] };
      expect(userCanAccessPath(user, "/record-results/abc", navGroups)).toBe(true);
      expect(userCanAccessPath(user, "/petitions-old/abc", navGroups)).toBe(false);
    });

    it("'others' does not grant a sub-page already covered by its parent's group", () => {
      const user = { role: "lab", status: "active" as const, permissions: ["others"] };
      expect(userCanAccessPath(user, "/petition/123", navGroups)).toBe(false);
    });
  });

  describe("daily-check rooms", () => {
    const navGroups = [
      { id: "ops", paths: ["/daily-check"] },
      { id: "others", paths: [] },
    ];

    it("grants every room sub-page when /daily-check is granted", () => {
      const user = { role: "lab", status: "active" as const, permissions: ["/daily-check"] };
      expect(userCanAccessPath(user, "/daily-check/balance", navGroups)).toBe(true);
      expect(userCanAccessPath(user, "/daily-check/sample-prep", navGroups)).toBe(true);
      expect(userCanAccessPath(user, "/daily-check/analysis", navGroups)).toBe(true);
      expect(userCanAccessPath(user, "/daily-check/extraction", navGroups)).toBe(true);
      expect(userCanAccessPath(user, "/daily-check/records", navGroups)).toBe(true);
    });

    it("denies room sub-pages when /daily-check is not granted", () => {
      const user = { role: "lab", status: "active" as const, permissions: ["/report"] };
      expect(userCanAccessPath(user, "/daily-check/balance", navGroups)).toBe(false);
    });
  });

  it("a deny: token is inert and never grants a route", () => {
    const user = { role: "lab", status: "active" as const, permissions: ["deny:/report/oee"] };
    expect(userCanAccessPath(user, "/report/oee", groups)).toBe(false);
    expect(userCanAccessPath(user, "/report", groups)).toBe(false);
  });

  it("granting a page does not auto-grant its in-page tab paths", () => {
    const user = { role: "lab", status: "active" as const, permissions: ["/report"] };
    expect(userCanAccessPath(user, "/report", groups)).toBe(true);
    // tab visibility is handled by the deny model in useAccessibleTabs, not here
    expect(userCanAccessPath(user, "/report/oee", groups)).toBe(false);
  });

  it("'others' now grants an uncovered in-page path (no restricted-tab exception)", () => {
    const user = { role: "lab", status: "active" as const, permissions: ["others"] };
    expect(userCanAccessPath(user, "/settings/dashboard", groups)).toBe(true);
    expect(userCanAccessPath(user, "/settings/printers", groups)).toBe(true);
  });
});

describe("userCanAccessPath with multiple roles", () => {
  it("admin via roles[] bypasses all checks", () => {
    const user = { roles: ["lab", "admin"], status: "active" as const, permissions: [] };
    expect(userCanAccessPath(user, "/anything", groups)).toBe(true);
  });

  it("treats roles[] of lab the same as legacy role lab", () => {
    const user = { roles: ["lab"], status: "active" as const, permissions: ["/report"] };
    expect(userCanAccessPath(user, "/report", groups)).toBe(true);
  });

  it("denies when neither role nor roles is set", () => {
    const user = { status: "active" as const, permissions: ["/report"] };
    expect(userCanAccessPath(user, "/report", groups)).toBe(false);
  });
});
