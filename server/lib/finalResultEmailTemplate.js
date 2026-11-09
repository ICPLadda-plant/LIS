// HTML ของเมลขอออก Final Report / เมลแจ้งผู้ขอ / หน้ายืนยันใน LIS
// เมลใช้ table + inline style ล้วน (Outlook desktop ไม่รองรับ CSS สมัยใหม่)
// สีอิง token กลางของ LIS (src/index.css): primary 210 70% 45% = #2273C3
const C = {
  primary: '#2273C3',
  bg: '#F4F6F9',
  card: '#FFFFFF',
  border: '#E1E5EA',
  text: '#1F2937',
  muted: '#6C7A8D',
  green: '#15803D',
  greenBg: '#ECFDF3',
  red: '#B91C1C',
  redBg: '#FEF2F2',
};
const FONT = "'Segoe UI',Tahoma,'Leelawadee UI',Arial,sans-serif";

function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function thaiDateTime(d) {
  if (!d) return '-';
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'medium', timeStyle: 'short' }) + ' น.';
}

function sendTo(item) {
  const sides = [];
  if (item.sendToQc !== false) sides.push('QC');
  if (item.sendToLab) sides.push('Lab');
  return sides.join(' + ') || '-';
}

function infoRows(rows) {
  return rows
    .filter(([, v]) => v)
    .map(([k, v]) => '<tr>'
      + '<td style="padding:6px 16px 6px 0;color:' + C.muted + ';font-size:13px;white-space:nowrap;vertical-align:top">' + esc(k) + '</td>'
      + '<td style="padding:6px 0;color:' + C.text + ';font-size:14px;font-weight:600">' + esc(v) + '</td></tr>')
    .join('');
}

function itemsTable(items = []) {
  const head = ['#', 'ชื่อตัวอย่าง', 'Batch', 'ส่งตรวจ']
    .map((h, i) => '<th align="' + (i === 0 ? 'center' : 'left') + '" style="padding:8px 10px;background:' + C.bg + ';color:' + C.muted + ';font-size:12px;font-weight:600;border-bottom:1px solid ' + C.border + '">' + h + '</th>')
    .join('');
  const body = items.map((it) => '<tr>'
    + '<td align="center" style="padding:8px 10px;border-bottom:1px solid ' + C.border + ';color:' + C.muted + ';font-size:13px">' + esc(it.seq) + '</td>'
    + '<td style="padding:8px 10px;border-bottom:1px solid ' + C.border + ';color:' + C.text + ';font-size:13px">' + esc(it.sampleName || '-') + '</td>'
    + '<td style="padding:8px 10px;border-bottom:1px solid ' + C.border + ';color:' + C.text + ';font-size:13px;white-space:nowrap">' + esc(it.batchNo || '-') + '</td>'
    + '<td style="padding:8px 10px;border-bottom:1px solid ' + C.border + ';color:' + C.text + ';font-size:13px;white-space:nowrap">' + esc(sendTo(it)) + '</td>'
    + '</tr>').join('');
  return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid ' + C.border + ';border-radius:6px">'
    + '<tr>' + head + '</tr>' + body + '</table>';
}

// ปุ่มแบบ table — Outlook แสดงพื้นสีได้ทุกเวอร์ชัน
function button(href, label, color = C.primary) {
  return '<table role="presentation" cellpadding="0" cellspacing="0"><tr>'
    + '<td align="center" bgcolor="' + color + '" style="border-radius:6px">'
    + '<a href="' + esc(href) + '"' + (String(href).startsWith('mailto:') ? '' : ' target="_blank"') + ' style="display:inline-block;padding:12px 28px;font-family:' + FONT + ';font-size:15px;font-weight:600;color:#FFFFFF;text-decoration:none;border-radius:6px">' + esc(label) + '</a>'
    + '</td></tr></table>';
}

function layout({ preheader, badge, badgeColor, title, bodyHtml, footer = 'อีเมลนี้ส่งอัตโนมัติจากระบบ LIS กรุณาอย่าตอบกลับอีเมลนี้' }) {
  return '<!DOCTYPE html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>'
    + '<body style="margin:0;padding:0;background:' + C.bg + '">'
    + '<div style="display:none;max-height:0;overflow:hidden">' + esc(preheader) + '</div>'
    + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:' + C.bg + '"><tr><td align="center" style="padding:24px 12px">'
    + '<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:100%;background:' + C.card + ';border:1px solid ' + C.border + ';border-radius:8px;font-family:' + FONT + '">'
    + '<tr><td style="background:' + C.primary + ';padding:16px 28px;border-radius:8px 8px 0 0;color:#FFFFFF;font-size:13px;font-weight:600;letter-spacing:.3px">LIS · ระบบห้องปฏิบัติการ ICP Ladda</td></tr>'
    + '<tr><td style="padding:28px 28px 8px">'
    + '<div style="display:inline-block;padding:3px 10px;border-radius:999px;background:' + (badgeColor?.bg || '#EAF2FB') + ';color:' + (badgeColor?.fg || C.primary) + ';font-size:12px;font-weight:600">' + esc(badge) + '</div>'
    + '<h1 style="margin:12px 0 0;font-size:22px;line-height:1.4;color:' + C.text + '">' + esc(title) + '</h1>'
    + '</td></tr>'
    + '<tr><td style="padding:8px 28px 28px;color:' + C.text + ';font-size:14px;line-height:1.7">' + bodyHtml + '</td></tr>'
    + '<tr><td style="padding:16px 28px;border-top:1px solid ' + C.border + ';color:' + C.muted + ';font-size:12px;line-height:1.6">' + esc(footer) + '</td></tr>'
    + '</table></td></tr></table></body></html>';
}

// เมลถึงหัวหน้า QC — ขอออก Final Report
function approvalRequestEmail({ petition, approverName, approveUrl, reviewUrl, preview = false }) {
  const items = petition.items || [];
  const sb = petition.submittedBy || {};
  const bodyHtml = '<p style="margin:0 0 16px">เรียน ' + esc(approverName) + '</p>'
    + '<p style="margin:0 0 20px">คำขอด้านล่างทดสอบครบทุกฝั่งแล้ว รอหัวหน้า QC ออก Final Report</p>'
    + '<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 20px">' + infoRows([
      ['เลขที่คำขอ', petition.petitionNo],
      ['ผู้ขอ', sb.name],
      ['แผนก', sb.department],
      ['ทดสอบเสร็จเมื่อ', thaiDateTime(petition.completedAt)],
      ['จำนวนตัวอย่าง', items.length + ' รายการ'],
    ]) + '</table>'
    + itemsTable(items)
    + '<table role="presentation" cellpadding="0" cellspacing="0" style="margin:28px 0 12px"><tr><td>' + button(approveUrl, 'ตอบกลับเพื่ออนุมัติ Final Report') + '</td></tr></table>'
    + '<p style="margin:0;color:' + C.muted + ';font-size:13px">กดปุ่มแล้ว Outlook จะเปิดอีเมลตอบกลับที่พิมพ์คำว่า "อนุมัติ" ไว้ให้ กด "ส่ง" ได้ทันที หรือกด "ตอบกลับ" อีเมลนี้แล้วพิมพ์ว่า "อนุมัติ" ก็ได้ ระบบจะออก Final Report แจ้งผลผู้ขอ และส่งอีเมลยืนยันกลับมา</p>'
    + '<p style="margin:12px 0 0;font-size:13px">ต้องการตรวจรายละเอียดหรือส่งกลับแก้ไข: <a href="' + esc(reviewUrl) + '" style="color:' + C.primary + '">เปิดคำขอในระบบ LIS</a></p>';
  return {
    html: layout({
      preheader: petition.petitionNo + ' · ' + (sb.name || '') + ' · ' + items.length + ' รายการ รอออก Final Report',
      badge: 'รออนุมัติ Final Report',
      badgeColor: { bg: '#FEF6E7', fg: '#B45309' },
      title: (preview ? '[ตัวอย่าง] ' : '') + 'ขออนุมัติออก Final Report ' + petition.petitionNo,
      bodyHtml,
      footer: 'อีเมลนี้ส่งอัตโนมัติจากระบบ LIS · ตอบกลับเพื่ออนุมัติได้ โปรดอย่าแก้รหัส [FR:...] ในหัวเรื่อง',
    }),
  };
}

// เมลถึงผู้ขอ — ออก Final Report แล้ว
function requesterResultEmail({ petition, approverName, viewUrl }) {
  const items = petition.items || [];
  const sb = petition.submittedBy || {};
  const oos = petition.conclusion === 'accepted-oos';
  const bodyHtml = '<p style="margin:0 0 16px">เรียน ' + esc(sb.name || 'ผู้ขอ') + '</p>'
    + '<p style="margin:0 0 20px">หัวหน้า QC อนุมัติและออก Final Report ของคำขอของคุณแล้ว</p>'
    + '<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 20px">' + infoRows([
      ['เลขที่คำขอ', petition.petitionNo],
      ['ผลสรุป', oos ? 'ผ่าน (ยอมรับผลไม่ปกติ)' : 'ผ่าน'],
      ['อนุมัติโดย', approverName],
      ['ออก Final Report เมื่อ', thaiDateTime(petition.approvedAt)],
    ]) + '</table>'
    + itemsTable(items)
    + '<table role="presentation" cellpadding="0" cellspacing="0" style="margin:28px 0 0"><tr><td>' + button(viewUrl, 'ดูผลในระบบ LIS') + '</td></tr></table>';
  return {
    subject: '[LIS] ออก Final Report แล้ว ' + petition.petitionNo,
    html: layout({
      preheader: petition.petitionNo + ' ออก Final Report แล้ว',
      badge: 'ออก Final Report แล้ว',
      badgeColor: { bg: C.greenBg, fg: C.green },
      title: 'ผลวิเคราะห์ ' + petition.petitionNo + ' ออกแล้ว',
      bodyHtml,
    }),
  };
}

// เมลตอบกลับหา QC Head หลังกดส่งเมลอนุมัติ (n8n ใช้เป็นเนื้อ Reply)
function approverReplyEmail({ ok, title, message, petition, linkUrl, linkLabel }) {
  const tone = ok ? { bg: C.greenBg, fg: C.green } : { bg: C.redBg, fg: C.red };
  const items = petition?.items || [];
  const bodyHtml = '<p style="margin:0 0 20px;padding:12px 16px;border-radius:6px;background:' + tone.bg + ';color:' + tone.fg + ';font-weight:600">' + esc(message) + '</p>'
    + (petition
      ? '<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 20px">' + infoRows([
        ['เลขที่คำขอ', petition.petitionNo],
        ['ผู้ขอ', petition.submittedBy?.name],
        ['แผนก', petition.submittedBy?.department],
        ['จำนวนตัวอย่าง', items.length + ' รายการ'],
      ]) + '</table>' + itemsTable(items)
      : '')
    + (linkUrl ? '<table role="presentation" cellpadding="0" cellspacing="0" style="margin:28px 0 0"><tr><td>' + button(linkUrl, linkLabel || 'เปิดในระบบ LIS') + '</td></tr></table>' : '');
  return {
    subject: title,
    html: layout({
      preheader: message,
      badge: ok ? 'ออก Final Report แล้ว' : 'ยังออก Final Report ไม่ได้',
      badgeColor: tone,
      title,
      bodyHtml,
    }),
  };
}

module.exports = { esc, thaiDateTime, approvalRequestEmail, requesterResultEmail, approverReplyEmail };
