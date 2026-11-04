import { NAV_ITEMS } from "./navItems";
import { normalizeRoles } from "./roles";

export interface AccessUser {
  role?: string;
  roles?: string[];
  status?: "active" | "inactive";
  permissions?: string[];
}

// Detail/sub pages that aren't in the sidebar and ride along with their parent
// nav page's permission: granting the parent grants these too. They are never
// granted on their own.
const IMPLIED_CHILD_PATHS: Record<string, string[]> = {
  "/petition": [
    "/petition/:id",
    "/petitions/new",
  ],
  "/record-results": ["/record-results/:id"],
  "/qc-testing": ["/qc-testing/:id"],
  "/qc-approval": ["/qc-approval/:id"],
  "/lab-approval": ["/lab-approval/:id"],
  "/lab-testing": ["/lab-testing/:id"],
  "/lab-send-conditions": ["/mf-gap-medicines"],
  "/coa": ["/coa/:id"],
  "/daily-check": [
    "/daily-check/environment",
    "/daily-check/balance",
    "/daily-check/sample-prep",
    "/daily-check/analysis",
    "/daily-check/extraction",
    "/daily-check/records",
    "/daily-check/documents",
  ],
};

// Pages open to every signed-in user — no group/permission needed (shared
// scanner station and the lab/QC queue TV displays).
const PUBLIC_PATHS = ["/scanner", "/queue/lab", "/queue/qc"];

function normalizePath(path: string) {
  if (!path || path === "/") return "/";
  return path.replace(/\/+$/, "");
}

// A pathname that is itself a sidebar nav page is controlled on its own and must
// never be auto-granted through a parent's implied sub-pages. This keeps e.g.
// /petition/assign (a nav page that matches /petition/:id) out of the subtree
// granted by /petition.
function isOwnNavPage(pathname: string) {
  return NAV_ITEMS.some((item) => pathMatches(item.path, pathname));
}

// True if granting `grantedPath` should authorize `pathname` — either a direct
// match, or `pathname` is one of grantedPath's implied sub-pages (and isn't a
// separately-controlled nav page in its own right).
function grantMatches(grantedPath: string, pathname: string) {
  const normalizedGrantedPath = normalizePath(grantedPath);
  const normalizedPathname = normalizePath(pathname);
  if (normalizedGrantedPath !== normalizedPathname && isOwnNavPage(pathname)) return false;
  if (pathMatches(grantedPath, pathname)) return true;
  const children = IMPLIED_CHILD_PATHS[normalizedGrantedPath];
  if (!children || isOwnNavPage(pathname)) return false;
  return children.some((child) => pathMatches(child, pathname));
}

export function pathMatches(pattern: string, pathname: string) {
  const normalizedPattern = normalizePath(pattern);
  const normalizedPath = normalizePath(pathname);

  if (normalizedPattern === normalizedPath) return true;
  if (normalizedPattern.endsWith("/*")) {
    return normalizedPath.startsWith(normalizedPattern.slice(0, -2));
  }

  const patternParts = normalizedPattern.split("/");
  const pathParts = normalizedPath.split("/");
  if (patternParts.length !== pathParts.length) return false;

  return patternParts.every((part, index) => part.startsWith(":") || part === pathParts[index]);
}

export function isPublicPath(pathname: string) {
  return PUBLIC_PATHS.some((path) => pathMatches(path, pathname));
}

export function userCanAccessPath(
  user: AccessUser | null | undefined,
  pathname: string,
  groups: { id: string; paths?: string[] }[],
) {
  const roles = normalizeRoles(user);
  if (!user || user.status === "inactive" || roles.length === 0) return false;
  if (roles.includes("admin")) return true;
  if (isPublicPath(pathname)) return true;

  const permissions = user.permissions ?? [];
  for (const entry of permissions) {
    if (entry.startsWith("/")) {
      if (grantMatches(entry, pathname)) return true;
      continue;
    }
    if (entry === "others") {
      const coveredByOtherGroup = groups
        .filter((group) => group.id !== "others")
        .some((group) => (group.paths ?? []).some((path) => grantMatches(path, pathname)));
      if (!coveredByOtherGroup) return true;
      continue;
    }
    const group = groups.find((g) => g.id === entry);
    if (group && (group.paths ?? []).some((path) => grantMatches(path, pathname))) {
      return true;
    }
  }
  return false;
}
