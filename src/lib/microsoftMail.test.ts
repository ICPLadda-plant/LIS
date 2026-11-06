import { beforeEach, expect, it, vi } from "vitest";
import { sendMicrosoftMailWithPdf } from "./microsoftMail";

const { acquireTokenSilent } = vi.hoisted(() => ({ acquireTokenSilent: vi.fn() }));

vi.mock("@/lib/msalConfig", () => ({
  msalInstance: {
    getActiveAccount: () => ({ username: "sender@icpladda.com" }),
    getAllAccounts: () => [],
    acquireTokenSilent,
  },
}));

beforeEach(() => {
  acquireTokenSilent.mockResolvedValue({ accessToken: "token" });
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
