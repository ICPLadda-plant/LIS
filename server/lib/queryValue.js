// ค่าจาก req.query ถูก parse ด้วย qs ทำให้ ?a[$regex]=x กลายเป็น object/array ได้
// ฟังก์ชันนี้รับเฉพาะค่า primitive (string/number/boolean) เพื่อกันไม่ให้ operator ของ MongoDB หลุดเข้า filter
function queryString(value) {
  const type = typeof value;
  return type === 'string' || type === 'number' || type === 'boolean' ? value : undefined;
}

module.exports = { queryString };
