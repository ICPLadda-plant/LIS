import { createRoot } from "react-dom/client";
import { MsalProvider } from "@azure/msal-react";
import { msalInstance } from "./lib/msalConfig";
import App from "./App.tsx";
import "./index.css";
import { loadAccessControl } from "./lib/accessControlSource";
import { registerPwaServiceWorker, startPwaInstallPromptCapture } from "./lib/pwa";
import { startBuildRefreshWatcher } from "./lib/buildRefresh";
import { startOutageRecoveryWatcher } from "./lib/outageRecovery";
import { applyAppPreferences, readAppPreferences } from "./lib/appPreferences";

// Resolving the sign-in redirect must never be able to abort the render.
// MSAL throws `no_token_request_cache_error` whenever sessionStorage still
// holds `msal.interaction.status` but its matching `request.params` entry is
// gone โ€” the state a login redirect leaves behind when it is interrupted
// (reload, back button, slow authority discovery) between setting the
// in-progress flag and caching the request. MSAL clears the stale entries and
// rethrows, so the condition is recoverable; letting the rejection escape used
// to skip createRoot() entirely and leave the user on a blank page.
startPwaInstallPromptCapture();

function appBasePath() {
  return (import.meta.env.BASE_URL || "/").replace(new RegExp("/+$"), "");
}

function currentAppPath() {
  const base = appBasePath();
  const { pathname, search, hash } = window.location;
  if (base && pathname === base) return (search + hash) || "/";
  if (base && pathname.startsWith(base + "/")) return (pathname.slice(base.length) || "/") + search + hash;
  return (pathname || "/") + search + hash;
}

function normalizeLoginRedirect(raw: string | null) {
  if (!raw) return "";
  const base = appBasePath();
  const isAppRelativePath =
    raw.startsWith("/") &&
    !raw.startsWith("//") &&
    (!base || (raw !== base && !raw.startsWith(base + "/")));
  if (isAppRelativePath) return raw;

  try {
    const url = new URL(raw, window.location.origin);
    if (url.origin !== window.location.origin) return "";
    if (base && url.pathname !== base && !url.pathname.startsWith(base + "/")) return "";
    const path = base ? url.pathname.slice(base.length) || "/" : url.pathname || "/";
    return path + url.search + url.hash;
  } catch {
    return raw.startsWith("/") && !raw.startsWith("//") ? raw : "";
  }
}

function restoreLoginRedirectAtRoot() {
  const target = normalizeLoginRedirect(sessionStorage.getItem("lis_login_redirect"));
  if (!target || target === "/" || currentAppPath() !== "/") return;
  sessionStorage.removeItem("lis_login_redirect");
  const base = appBasePath();
  window.history.replaceState(window.history.state, "", base + target);
}

async function resolveActiveAccount() {
  try {
    await msalInstance.initialize();
  } catch (error) {
    console.error("[auth] MSAL failed to initialize; rendering logged out", error);
    return undefined;
  }

  let redirectAccount;
  try {
    const response = await msalInstance.handleRedirectPromise({
      navigateToLoginRequestUrl: false,
    });
    redirectAccount = response?.account;
  } catch (error) {
    // Stale redirect state, already cleaned up by MSAL โ€” fall through to the
    // cached account so an existing session survives the failed redirect.
    console.error("[auth] sign-in redirect could not be completed", error);
  }

  return redirectAccount ?? msalInstance.getAllAccounts()[0];
}

resolveActiveAccount().then((account) => {
  applyAppPreferences(readAppPreferences());

  if (account) {
    msalInstance.setActiveAccount(account);
    // Authenticated session: warm the landing route's chunk (Vite also preloads
    // its AppLayout dep) and the access-control matrix in parallel with React's
    // first mount, so neither is a sequential network hop before the home LCP.
    // Skipped when logged out so the /login page isn't slowed by a Home download.
    void import("./pages/Home");
    void loadAccessControl().catch(() => {});
  }
  restoreLoginRedirectAtRoot();

  createRoot(document.getElementById("root")!).render(
    <MsalProvider instance={msalInstance}>
      <App />
    </MsalProvider>
  );

  void registerPwaServiceWorker();
  startBuildRefreshWatcher();
  startOutageRecoveryWatcher();
});

