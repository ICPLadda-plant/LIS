import { PublicClientApplication, type Configuration } from "@azure/msal-browser";

const CLIENT_ID = import.meta.env.VITE_AZURE_CLIENT_ID || "3606c739-b089-4e15-80bc-cef9538b46dc";
const TENANT_ID = import.meta.env.VITE_AZURE_TENANT_ID || "2e73ca10-7e02-42ce-a4c8-d71202e7bc71";

if (!CLIENT_ID || !TENANT_ID) {
  // Vite resolves these from the .env at the REPO ROOT (server/.env is the
  // backend's and is never bundled), inlining them at build time. Left unset
  // they silently produce an authority of ".../undefined", which Azure rejects
  // at sign-in with AADSTS900023 rather than at startup — so say it here.
  console.error(
    "[auth] VITE_AZURE_CLIENT_ID / VITE_AZURE_TENANT_ID are missing. " +
      "Set them in the repo-root .env and restart Vite (or rebuild for production).",
  );
}

const APP_BASE_URL = import.meta.env.BASE_URL || "/";
const APP_BASE_PATH = APP_BASE_URL.endsWith("/") ? APP_BASE_URL : `${APP_BASE_URL}/`;
// Redirect URI must match the Vite base path registered in Azure App Registration.
const REDIRECT_URI = new URL(APP_BASE_PATH, window.location.origin).toString();
const POST_LOGOUT_REDIRECT_URI = new URL("login", window.location.origin + APP_BASE_PATH).toString();

const msalConfig: Configuration = {
  auth: {
    clientId: CLIENT_ID,
    authority: `https://login.microsoftonline.com/${TENANT_ID}`,
    redirectUri: REDIRECT_URI,
    postLogoutRedirectUri: POST_LOGOUT_REDIRECT_URI,
  },
  cache: {
    cacheLocation: "localStorage",
  },
};

export const loginRequest = {
  scopes: ["User.Read", "openid", "profile", "email"],
};

export const msalInstance = new PublicClientApplication(msalConfig);
