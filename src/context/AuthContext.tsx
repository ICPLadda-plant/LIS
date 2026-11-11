import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { AccountInfo } from "@azure/msal-browser";
import { useMsal } from "@azure/msal-react";
import { loginRequest } from "@/lib/msalConfig";
import { api, setApiUserEmail } from "@/lib/api";
import { loadAccessControl } from "@/lib/accessControlSource";
import {
  DEV_MODE,
  DEV_DEFAULT_ROLE,
  synthesizeDevUser,
  normalizeDevRoleSelection,
  normalizeDevDepartment,
  toggleDevRoleSelection,
  type DevRoleOption,
} from "@/config/dev";
import { unionPermissions } from "@/lib/roles";
import { isStandalonePwa, PWA_ACTIVE_ACCOUNT_STORAGE_KEY } from "@/lib/pwa";

export type ApprovalStatus = "pending" | "approved" | "rejected";

export interface AuthUser {
  id?: string;
  email: string;
  name?: string;
  photoUrl?: string;
  signatureUrl?: string;
  role?: string;
  roles?: string[];
  permissions?: string[];
  department?: string;
  position?: string;
  employeeId?: string;
  status?: "active" | "inactive";
  // ไม่มีค่า = ผู้ใช้เดิมก่อนมีระบบอนุมัติ ถือว่า approved
  approvalStatus?: ApprovalStatus;
}

// เหตุผลที่ซิงก์บัญชี Microsoft กับ LIS ไม่สำเร็จ ใช้แสดงหน้าสถานะแทนหน้าขาว
export interface AccountAccessError {
  status?: number;
  code?: string;
  message: string;
}

function toAccountAccessError(err: unknown): AccountAccessError {
  const e = err as { status?: number; message?: string; response?: { data?: unknown } } | null;
  const body = e?.response?.data as { code?: unknown } | undefined;
  return {
    status: e?.status,
    code: typeof body?.code === "string" ? body.code : undefined,
    message: e?.message || "เชื่อมต่อระบบไม่สำเร็จ",
  };
}

export interface AuthAccount {
  id: string;
  email: string;
  name?: string;
  isActive: boolean;
  photoUrl?: string;
}

type MsalAccountControls = {
  getActiveAccount?: () => AccountInfo | null;
  setActiveAccount?: (account: AccountInfo | null) => void;
};

const PRODUCTION_SSO_USER_STORAGE_KEY = "lis_production_sso_user";

function readStoredProductionUser(): AuthUser | null {
  const raw = localStorage.getItem(PRODUCTION_SSO_USER_STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthUser;
  } catch {
    localStorage.removeItem(PRODUCTION_SSO_USER_STORAGE_KEY);
    return null;
  }
}

function storeProductionUser(user: AuthUser) {
  localStorage.setItem(PRODUCTION_SSO_USER_STORAGE_KEY, JSON.stringify(user));
}

function clearStoredProductionUser() {
  localStorage.removeItem(PRODUCTION_SSO_USER_STORAGE_KEY);
}

async function clearProductionSessionCookie() {
  await api.post("/auth/logout", {}).catch(() => undefined);
}

function msalAccountId(account: AccountInfo) {
  return account.homeAccountId || account.localAccountId || account.username;
}

function sameMsalAccount(a: AccountInfo, b: AccountInfo) {
  return msalAccountId(a) === msalAccountId(b) || a.username.toLowerCase() === b.username.toLowerCase();
}

function getActiveMsalAccount(instance: MsalAccountControls) {
  return typeof instance.getActiveAccount === "function" ? instance.getActiveAccount() : null;
}

function setActiveMsalAccount(instance: MsalAccountControls, account: AccountInfo | null) {
  if (typeof instance.setActiveAccount === "function") instance.setActiveAccount(account);
}

interface AuthContextType {
  user: AuthUser | null;
  // ตั้งค่าเมื่อซิงก์บัญชี Microsoft ไม่สำเร็จ (เช่น ถูกระงับ, ไม่ใช่อีเมลองค์กร, server ล่ม)
  accessError: AccountAccessError | null;
  login: (redirectTo?: string, loginHint?: string) => Promise<void>;
  // Seamless SSO when another system forwards ?login_hint=<email>: try a silent
  // sign-in against any existing Microsoft session first, falling back to a full
  // redirect (still pre-filled with the hint) if silent auth isn't possible.
  loginWithHint: (loginHint: string, redirectTo?: string, options?: { force?: boolean }) => Promise<void>;
  loginWithProductionToken: (token: string) => Promise<AuthUser>;
  logout: () => void;
  isPwa: boolean;
  // เข้าระบบผ่าน SSO ของฝ่ายผลิต (ไม่ใช่บัญชี Microsoft ของ LIS)
  isProductionSession?: boolean;
  accounts: AuthAccount[];
  activeAccountId?: string;
  switchAccount: (accountId: string) => void;
  addAccount: () => Promise<void>;
  // Links the current user to the HR employee whose email matches the account.
  // Used by EmployeeLinkGate for accounts that are still unlinked. Updates local
  // auth state on success so the gate closes without a re-login.
  linkSelfEmployee: () => Promise<void>;
  devRoleIds?: string[];
  devRoles?: DevRoleOption[];
  toggleDevRole?: (role: string) => void;
  // "" = ตามบทบาท (role-derived department)
  devDepartment?: string;
  setDevDepartment?: (department: string) => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be inside AuthProvider");
  return ctx;
};

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const { instance, accounts: msalAccounts } = useMsal();
  const [isPwa] = useState(() => isStandalonePwa());
  const [activeAccountId, setActiveAccountId] = useState<string>(() =>
    isPwa ? localStorage.getItem(PWA_ACTIVE_ACCOUNT_STORAGE_KEY) ?? "" : "",
  );
  const account = useMemo(() => {
    if (msalAccounts.length === 0) return null;
    const storedAccount = isPwa && activeAccountId
      ? msalAccounts.find((candidate) => msalAccountId(candidate) === activeAccountId)
      : undefined;
    if (storedAccount) return storedAccount;
    const activeAccount = getActiveMsalAccount(instance);
    const activeMatch = activeAccount
      ? msalAccounts.find((candidate) => sameMsalAccount(candidate, activeAccount))
      : undefined;
    return activeMatch ?? msalAccounts[0] ?? null;
  }, [activeAccountId, instance, isPwa, msalAccounts]);
  const selectedAccountId = account ? msalAccountId(account) : undefined;
  const [syncedUser, setSyncedUser] = useState<AuthUser | null>(null);
  const [accessError, setAccessError] = useState<AccountAccessError | null>(null);
  const [productionUser, setProductionUser] = useState<AuthUser | null>(() => readStoredProductionUser());
  const productionSessionCheckedRef = useRef(false);
  const [profilePhotoUrl, setProfilePhotoUrl] = useState<string | undefined>();
  const authAccounts = useMemo<AuthAccount[]>(
    () =>
      msalAccounts.map((candidate) => {
        const id = msalAccountId(candidate);
        const isActive = id === selectedAccountId;
        return {
          id,
          email: candidate.username,
          name: candidate.name ?? candidate.username,
          isActive,
          photoUrl: isActive ? profilePhotoUrl : undefined,
        };
      }),
    [msalAccounts, profilePhotoUrl, selectedAccountId],
  );
  const [devRoleIds, setDevRoleIds] = useState<string[]>(() => {
    const multi = localStorage.getItem("dev_roles");
    if (multi) {
      try {
        const parsed = JSON.parse(multi);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      } catch {
        /* ignore */
      }
    }
    const single = localStorage.getItem("dev_role");
    return single ? [single] : [DEV_DEFAULT_ROLE];
  });
  const [devPermissions, setDevPermissions] = useState<Record<string, string[]>>({});
  const [devRoles, setDevRoles] = useState<DevRoleOption[]>([]);
  const [devDepartment, setDevDepartmentState] = useState<string>(() =>
    normalizeDevDepartment(localStorage.getItem("dev_department")),
  );

  // Override the role-derived department so dev can exercise department-gated
  // flows (R&D skips ผู้นำส่ง/เลขแบช, ผลิต 1–5 / RM change รหัสลูกค้า).
  const setDevDepartment = (department: string) => {
    const next = normalizeDevDepartment(department);
    if (next) localStorage.setItem("dev_department", next);
    else localStorage.removeItem("dev_department");
    setDevDepartmentState(next);
  };

  const sameRoleSelection = (a: string[], b: string[]) =>
    a.length === b.length && a.every((id, index) => id === b[index]);

  const setDevRolesSelection = (ids: string[]) => {
    const next = normalizeDevRoleSelection(ids, devRoles);
    localStorage.setItem("dev_roles", JSON.stringify(next));
    setDevRoleIds(next);
  };

  // Toggle a single role in/out of the dev selection (used by DevRoleSwitcher).
  const toggleDevRole = (role: string) => {
    setDevRolesSelection(toggleDevRoleSelection(devRoleIds, role, devRoles));
  };

  // In DEV_MODE there is no Microsoft sync, so the dev user carries no
  // permissions. Pull the access matrix from the backend so switching the dev
  // role mirrors what that role would actually see in production.
  useEffect(() => {
    if (!DEV_MODE) return;

    let active = true;
    const loadMatrix = (force = false) => {
      loadAccessControl(force)
        .then((data) => {
          if (!active) return;
          setDevPermissions(data.permissions ?? {});
          setDevRoles(data.roles ?? []);
        })
        .catch((err) => {
          console.error("Failed to load access matrix for dev role", err);
        });
    };

    const refresh = () => loadMatrix(true);
    loadMatrix();
    window.addEventListener("lis-access-groups-changed", refresh);
    return () => {
      active = false;
      window.removeEventListener("lis-access-groups-changed", refresh);
    };
  }, []);

  useEffect(() => {
    if (!DEV_MODE) return;
    if (devRoles.length === 0) return; // not loaded yet
    const valid = devRoleIds.filter((id) => devRoles.some((r) => r.id === id));
    const normalized = normalizeDevRoleSelection(valid, devRoles);
    if (sameRoleSelection(normalized, devRoleIds)) return;
    setDevRolesSelection(normalized);
  }, [devRoles, devRoleIds]);

  const devUser: AuthUser | null = DEV_MODE
    ? (() => {
        const selected = devRoleIds
          .map((id) => devRoles.find((r) => r.id === id))
          .filter((r): r is DevRoleOption => Boolean(r));
        const roleObjs = selected.length > 0
          ? selected
          : devRoles.filter((r) => r.id === DEV_DEFAULT_ROLE);
        if (roleObjs.length === 0) return null;
        const base = synthesizeDevUser(roleObjs, devDepartment);
        return {
          ...base,
          permissions: unionPermissions(base.roles, devPermissions),
        };
      })()
    : null;

  const syncedUserForAccount = account && syncedUser?.email.toLowerCase() === account.username.toLowerCase()
    ? syncedUser
    : null;

  const user: AuthUser | null = DEV_MODE
    ? devUser
    : productionUser
    ? productionUser
    : account
    ? {
        id: syncedUserForAccount?.id,
        email: account.username,
        name: syncedUserForAccount?.name ?? account.name ?? account.username,
        photoUrl: profilePhotoUrl,
        role: syncedUserForAccount?.role,
        roles: syncedUserForAccount?.roles,
        permissions: syncedUserForAccount?.permissions,
        department: syncedUserForAccount?.department,
        position: syncedUserForAccount?.position,
        employeeId: syncedUserForAccount?.employeeId,
        signatureUrl: syncedUserForAccount?.signatureUrl,
        status: syncedUserForAccount?.status,
        approvalStatus: syncedUserForAccount?.approvalStatus,
      }
    : null;

  // ส่งอีเมลผู้ใช้ปัจจุบันให้ api.ts แนบเป็น header X-LIS-User (backend ใช้ตรวจ
  // สิทธิ์ admin ของ route /api-keys)
  useEffect(() => {
    setApiUserEmail(user?.email);
  }, [user?.email]);

  useEffect(() => {
    if (DEV_MODE || productionSessionCheckedRef.current || productionUser || account) return;

    let active = true;
    productionSessionCheckedRef.current = true;
    api.get<AuthUser>("/auth/session")
      .then((res) => {
        if (!active) return;
        const nextUser = res.data.data;
        storeProductionUser(nextUser);
        setProductionUser(nextUser);
      })
      .catch(() => undefined);

    return () => {
      active = false;
    };
  }, [account, productionUser]);

  useLayoutEffect(() => {
    if (!account) return;
    setActiveMsalAccount(instance, account);
    if (!isPwa) return;
    const accountId = msalAccountId(account);
    localStorage.setItem(PWA_ACTIVE_ACCOUNT_STORAGE_KEY, accountId);
    if (activeAccountId !== accountId) setActiveAccountId(accountId);
  }, [account, activeAccountId, instance, isPwa]);

  useEffect(() => {
    if (!account) {
      setSyncedUser(null);
      setAccessError(null);
      return;
    }

    setSyncedUser((prev) =>
      prev?.email.toLowerCase() === account.username.toLowerCase() ? prev : null,
    );
    setAccessError(null);

    let active = true;
    const claims = account.idTokenClaims as { tid?: string; oid?: string } | undefined;

    // Pull แผนก/ตำแหน่ง from Microsoft Graph so the LIS user record mirrors
    // Azure AD instead of falling back to "Unassigned". Best-effort: if Graph is
    // unavailable the backend keeps whatever it already has.
    const fetchGraphProfile = async (): Promise<{ department?: string; position?: string }> => {
      try {
        const token = await instance.acquireTokenSilent({ account, scopes: ["User.Read"] });
        const res = await fetch(
          "https://graph.microsoft.com/v1.0/me?$select=department,jobTitle",
          { headers: { Authorization: `Bearer ${token.accessToken}` } },
        );
        if (!res.ok) return {};
        const profile = (await res.json()) as { department?: string; jobTitle?: string };
        return {
          department: profile.department?.trim() || undefined,
          position: profile.jobTitle?.trim() || undefined,
        };
      } catch {
        return {};
      }
    };

    const syncUser = async (extra: { department?: string; position?: string }) => {
      const res = await api.post<{
        id: string;
        email: string;
        name: string;
        roleId: string;
        roleIds?: string[];
        permissions?: string[];
        department: string;
        position: string;
        employeeId: string;
        signatureUrl?: string;
        status: "active" | "inactive";
        approvalStatus?: ApprovalStatus;
      }>("/access-control/users/microsoft", {
        email: account.username,
        name: account.name ?? account.username,
        microsoftId: claims?.oid ?? account.localAccountId,
        tenantId: claims?.tid,
        ...extra,
      });
      if (!active) return;
      setSyncedUser({
        id: res.data.data.id,
        email: res.data.data.email,
        name: res.data.data.name,
        role: res.data.data.roleId,
        roles: res.data.data.roleIds ?? [res.data.data.roleId],
        permissions: res.data.data.permissions ?? [],
        department: res.data.data.department,
        position: res.data.data.position,
        employeeId: res.data.data.employeeId,
        signatureUrl: res.data.data.signatureUrl,
        status: res.data.data.status,
        approvalStatus: res.data.data.approvalStatus,
      });
      setAccessError(null);
    };

    (async () => {
      // Sync immediately so roles/permissions/status — which gate the whole app
      // shell via PrivateRoute — arrive without waiting on a Microsoft Graph
      // round-trip (acquireTokenSilent + Graph fetch sat on the LCP critical
      // path). แผนก/ตำแหน่ง is best-effort enrichment: the backend keeps the
      // existing/HR value when omitted (resolveHrField), and the first response
      // already carries the stored/HR dept, so we fetch Graph in parallel and
      // re-sync only when it actually returns something new.
      try {
        await syncUser({});
      } catch (err) {
        console.error("Failed to sync Microsoft user", err);
        if (active) setAccessError(toAccountAccessError(err));
        return;
      }
      const { department, position } = await fetchGraphProfile();
      if (!active || (!department && !position)) return;
      try {
        await syncUser({ department, position });
      } catch {
        /* dept/position enrichment is best-effort */
      }
    })();

    return () => {
      active = false;
    };
  }, [account, instance]);

  useEffect(() => {
    if (!account) {
      setProfilePhotoUrl(undefined);
      return;
    }

    setProfilePhotoUrl(undefined);

    let alive = true;
    let objectUrl: string | undefined;

    instance
      .acquireTokenSilent({
        account,
        scopes: ["User.Read"],
      })
      .then(async (token) => {
        const res = await fetch("https://graph.microsoft.com/v1.0/me/photo/$value", {
          headers: { Authorization: `Bearer ${token.accessToken}` },
        });
        if (!res.ok) return null;
        return res.blob();
      })
      .then((blob) => {
        if (!alive || !blob) return;
        objectUrl = URL.createObjectURL(blob);
        setProfilePhotoUrl(objectUrl);
      })
      .catch(() => {
        if (alive) setProfilePhotoUrl(undefined);
      });

    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [account, instance]);

  const switchAccount = useCallback(
    (accountId: string) => {
      if (!isPwa) return;
      const nextAccount = msalAccounts.find((candidate) => msalAccountId(candidate) === accountId);
      if (!nextAccount) return;
      clearStoredProductionUser();
      setProductionUser(null);
      void clearProductionSessionCookie();
      setSyncedUser(null);
      setProfilePhotoUrl(undefined);
      setActiveMsalAccount(instance, nextAccount);
      localStorage.setItem(PWA_ACTIVE_ACCOUNT_STORAGE_KEY, accountId);
      setActiveAccountId(accountId);
    },
    [instance, isPwa, msalAccounts],
  );

  const addAccount = useCallback(async () => {
    if (!isPwa) return;
    const target = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (target && target !== "/login") {
      sessionStorage.setItem("lis_login_redirect", target);
    }
    clearStoredProductionUser();
    setProductionUser(null);
    void clearProductionSessionCookie();
    await instance.loginRedirect({
      ...loginRequest,
      prompt: "select_account",
      redirectStartPage: window.location.href,
    });
  }, [instance, isPwa]);

  const login = async (redirectTo?: string, loginHint?: string) => {
    const target = redirectTo || `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (target && target !== "/login") {
      sessionStorage.setItem("lis_login_redirect", target);
    }
    clearStoredProductionUser();
    setProductionUser(null);
    await clearProductionSessionCookie();
    await instance.loginRedirect({
      ...loginRequest,
      ...(loginHint ? { loginHint } : {}),
      redirectStartPage: window.location.href,
    });
  };

  const loginWithHint = useCallback(
    async (loginHint: string, redirectTo?: string, options?: { force?: boolean }) => {
      if (redirectTo && redirectTo !== "/login") {
        sessionStorage.setItem("lis_login_redirect", redirectTo);
      }
      clearStoredProductionUser();
      setProductionUser(null);
      await clearProductionSessionCookie();
      if (options?.force) {
        await instance.loginRedirect({
          ...loginRequest,
          loginHint,
          prompt: "login",
          redirectStartPage: window.location.href,
        });
        return;
      }
      try {
        // Silent SSO: reuses an existing Microsoft browser session for this
        // tenant so the user lands logged in with no UI. Throws if there's no
        // usable session (e.g. first visit, different account) — then redirect.
        const result = await instance.ssoSilent({ ...loginRequest, loginHint });
        if (result.account) instance.setActiveAccount(result.account);
      } catch {
        await instance.loginRedirect({
          ...loginRequest,
          loginHint,
          redirectStartPage: window.location.href,
        });
      }
    },
    [instance],
  );

  const loginWithProductionToken = useCallback(async (token: string) => {
    const res = await api.post<AuthUser>("/auth/sso", { token });
    const nextUser = res.data.data;
    storeProductionUser(nextUser);
    setProductionUser(nextUser);
    return nextUser;
  }, []);

  const linkSelfEmployee = useCallback(
    async () => {
      // Server matches the signed-in account's email against the HR directory —
      // the client never chooses which employee to link.
      const res = await api.post<AuthUser>("/access-control/users/me/link-employee", {});
      const updated = res.data.data;
      // HR is the source of truth for ชื่อ/แผนก/ตำแหน่ง once linked — mirror what
      // the backend persisted (it pulls name + dept/position from the employee
      // record), so the display name flips to HR's without a re-login.
      if (productionUser) {
        const next = {
          ...productionUser,
          name: updated.name,
          employeeId: updated.employeeId,
          department: updated.department,
          position: updated.position,
        };
        storeProductionUser(next);
        setProductionUser(next);
      } else {
        setSyncedUser((prev) =>
          prev
            ? {
                ...prev,
                name: updated.name,
                employeeId: updated.employeeId,
                department: updated.department,
                position: updated.position,
              }
            : prev,
        );
      }
    },
    [productionUser],
  );

  const logout = useCallback(async () => {
    const appBaseUrl = import.meta.env.BASE_URL || "/";
    const appBasePath = appBaseUrl.endsWith("/") ? appBaseUrl : `${appBaseUrl}/`;
    const postLogoutRedirectUri = new URL("login", window.location.origin + appBasePath).toString();

    clearStoredProductionUser();
    sessionStorage.removeItem("lis_login_redirect");
    setProductionUser(null);
    await clearProductionSessionCookie();
    if (!account) {
      window.location.href = postLogoutRedirectUri;
      return;
    }
    instance.logoutRedirect({
      postLogoutRedirectUri,
    });
  }, [account, instance]);

  return (
    <AuthContext.Provider
      value={{
        user,
        accessError: DEV_MODE || productionUser ? null : accessError,
        login,
        loginWithHint,
        loginWithProductionToken,
        logout,
        isPwa,
        isProductionSession: !DEV_MODE && !!productionUser,
        accounts: authAccounts,
        activeAccountId: selectedAccountId,
        switchAccount,
        addAccount,
        linkSelfEmployee,
        devRoleIds: DEV_MODE ? devRoleIds : undefined,
        devRoles: DEV_MODE ? devRoles : undefined,
        toggleDevRole: DEV_MODE ? toggleDevRole : undefined,
        devDepartment: DEV_MODE ? devDepartment : undefined,
        setDevDepartment: DEV_MODE ? setDevDepartment : undefined,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
