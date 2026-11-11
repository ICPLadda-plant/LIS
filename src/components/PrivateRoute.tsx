import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { useIsAuthenticated, useMsal } from "@azure/msal-react";
import { InteractionStatus } from "@azure/msal-browser";
import { useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { userCanAccessPath } from "@/lib/accessControl";
import { DEV_MODE } from "@/config/dev";
import { normalizeRoles, unionPermissions } from "@/lib/roles";
import { RouteLoading } from "@/components/RouteLoading";
import AccountAccessScreen, { accessVariantForError } from "@/components/lis/AccountAccessScreen";
import {
  loadAccessControl,
  invalidateAccessControl,
  type AccessControlPayload,
} from "@/lib/accessControlSource";

type AccessControlState = AccessControlPayload;

function requesterEmailFromSearch(search: string): string | null {
  const params = new URLSearchParams(search);
  return params.get("requesterEmail")?.trim() || params.get("requester_email")?.trim() || params.get("email")?.trim() || null;
}

const PrivateRoute = ({ children }: { children: React.ReactNode }) => {
  const isAuthenticated = useIsAuthenticated();
  const { inProgress } = useMsal();
  const { user, accessError } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [accessControl, setAccessControl] = useState<AccessControlState | null>(null);
  const [mappingLoaded, setMappingLoaded] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [mappingVersion, setMappingVersion] = useState(0);

  useEffect(() => {
    const refreshMapping = () => {
      invalidateAccessControl();
      setMappingVersion((current) => current + 1);
    };
    window.addEventListener("lis-access-groups-changed", refreshMapping);
    return () => {
      window.removeEventListener("lis-access-groups-changed", refreshMapping);
    };
  }, []);

  useEffect(() => {
    let alive = true;
    if (!accessControl) {
      setMappingLoaded(false);
    }
    loadAccessControl()
      .then((loadedAccessControl) => {
        if (!alive) return;
        setAccessControl(loadedAccessControl);
        setLoadFailed(false);
      })
      .catch(() => {
        if (alive) setLoadFailed(true);
      })
      .finally(() => {
        if (alive) setMappingLoaded(true);
      });

    return () => {
      alive = false;
    };
  }, [mappingVersion]);

  if (DEV_MODE) {
    return <>{children}</>;
  }

  if (inProgress !== InteractionStatus.None) {
    return <RouteLoading />;
  }

  if (!isAuthenticated && !user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  const requesterEmail = requesterEmailFromSearch(location.search);
  if (user?.email && requesterEmail && user.email.toLowerCase() !== requesterEmail.toLowerCase()) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // ซิงก์บัญชีไม่สำเร็จ (ถูกระงับ / ไม่ใช่อีเมลองค์กร / server ล่ม) → บอกเหตุผลแทนหน้าขาว
  if (accessError) {
    return <AccountAccessScreen variant={accessVariantForError(accessError.code, accessError.status)} />;
  }

  if (user?.approvalStatus === "pending") {
    return <AccountAccessScreen variant="pending" />;
  }

  if (user?.approvalStatus === "rejected") {
    return <AccountAccessScreen variant="rejected" />;
  }

  if (user?.status === "inactive") {
    return <AccountAccessScreen variant="inactive" />;
  }

  if (normalizeRoles(user).length === 0 || user?.status === undefined) {
    return <RouteLoading />;
  }

  if (!mappingLoaded) {
    return <RouteLoading />;
  }

  const roles = normalizeRoles(user);
  const currentUser =
    user && roles.length > 0
      ? { ...user, permissions: unionPermissions(roles, accessControl?.permissions ?? {}) }
      : user;
  const isRedirectOnlyRoute = location.pathname === "/";

  if (!loadFailed && !isRedirectOnlyRoute && !userCanAccessPath(currentUser, location.pathname, accessControl?.groups ?? [])) {
    return <AccountAccessScreen variant="forbidden" onBack={() => navigate("/", { replace: true })} />;
  }

  return <>{children}</>;
};

export default PrivateRoute;
