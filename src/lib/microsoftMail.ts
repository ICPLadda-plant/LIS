import { InteractionRequiredAuthError } from "@azure/msal-browser";
import { msalInstance } from "@/lib/msalConfig";

async function blobBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error("อ่านไฟล์ PDF ไม่สำเร็จ"));
    reader.onload = () => resolve(String(reader.result).split(",", 2)[1] || "");
    reader.readAsDataURL(blob);
  });
}

export async function ensureMicrosoftMailAccount() {
  const existing = msalInstance.getActiveAccount() ?? msalInstance.getAllAccounts()[0];
  if (existing) return existing;
  const login = await msalInstance.loginPopup({ scopes: ["User.Read", "Mail.Send"], prompt: "select_account" });
  if (!login.account) throw new Error("ไม่พบบัญชี Microsoft หลังเข้าสู่ระบบ");
  msalInstance.setActiveAccount(login.account);
  return login.account;
}

export async function sendMicrosoftMailWithPdf(input: {
  to: string;
  subject: string;
  body: string;
  fileName: string;
  pdf: Blob;
}): Promise<void> {
  const account = await ensureMicrosoftMailAccount();
  let token;
  try {
    token = await msalInstance.acquireTokenSilent({ account, scopes: ["Mail.Send"] });
  } catch (error) {
    if (!(error instanceof InteractionRequiredAuthError)) throw error;
    token = await msalInstance.acquireTokenPopup({ account, scopes: ["Mail.Send"] });
  }
  const response = await fetch("https://graph.microsoft.com/v1.0/me/sendMail", {
    method: "POST",
    headers: { Authorization: `Bearer ${token.accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      message: {
        subject: input.subject,
        body: { contentType: "Text", content: input.body },
        toRecipients: [{ emailAddress: { address: input.to } }],
        attachments: [{
          "@odata.type": "#microsoft.graph.fileAttachment",
          name: input.fileName,
          contentType: "application/pdf",
          contentBytes: await blobBase64(input.pdf),
        }],
      },
      saveToSentItems: true,
    }),
  });
  if (!response.ok) throw new Error(`ส่งอีเมลไม่สำเร็จ (${response.status})`);
}
