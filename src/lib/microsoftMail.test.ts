import { beforeEach, expect, it, vi } from "vitest";
import { sendMicrosoftMailWithPdf } from "./microsoftMail";

const msal = vi.hoisted(() => ({
  account: { username: "sender@icpladda.com" } as { username: string } | null,
  acquireTokenSilent: vi.fn(),
  loginPopup: vi.fn(),
  setActiveAccount: vi.fn(),
}));

vi.mock("@/lib/msalConfig", () => ({
  msalInstance: {
    getActiveAccount: () => msal.account,
    getAllAccounts: () => [],
    acquireTokenSilent: msal.acquireTokenSilent,
    loginPopup: msal.loginPopup,
    setActiveAccount: msal.setActiveAccount,
  },
}));

beforeEach(() => {
  msal.account = { username: "sender@icpladda.com" };
  msal.acquireTokenSilent.mockResolvedValue({ accessToken: "token" });
  msal.loginPopup.mockResolvedValue({ accessToken: "token", account: { username: "sender@icpladda.com" } });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 202 }));
});

it("sends the COA PDF to the selected internal employee", async () => {
  await sendMicrosoftMailWithPdf({
    to: "employee@icpladda.com",
    subject: "COA 13482026",
    body: "แนบเอกสาร COA 13482026",
    fileName: "COA-13482026.pdf",
    pdf: new Blob(["pdf"], { type: "application/pdf" }),
  });

  const [, request] = vi.mocked(fetch).mock.calls[0];
  const payload = JSON.parse(String(request?.body));
  expect(payload.message.toRecipients[0].emailAddress.address).toBe("employee@icpladda.com");
  expect(payload.message.attachments[0]).toMatchObject({ name: "COA-13482026.pdf", contentType: "application/pdf" });
});

it("opens Microsoft login when LIS is running with a dev account", async () => {
  msal.account = null;

  await sendMicrosoftMailWithPdf({
    to: "employee@icpladda.com",
    subject: "COA 13482026",
    body: "COA",
    fileName: "COA-13482026.pdf",
    pdf: new Blob(["pdf"], { type: "application/pdf" }),
  });

  expect(msal.loginPopup).toHaveBeenCalledWith({ scopes: ["User.Read", "Mail.Send"], prompt: "select_account" });
  expect(msal.setActiveAccount).toHaveBeenCalledWith({ username: "sender@icpladda.com" });
});
