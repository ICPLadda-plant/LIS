const directory = require('./employeeDirectory');
const { findEmployeeByEmail } = require('./employeeLink');

function isEmployeeIdConflict(err) {
  return err?.code === 11000 && Boolean(err.keyPattern?.employeeId || /employeeId/.test(err.message || ''));
}

// ผูก user (mongoose doc) ที่ยังไม่มี employeeId กับพนักงาน HR ที่อีเมลตรงกัน
// แก้ค่าใน doc อย่างเดียว ผู้เรียกต้อง save เอง — ไม่ throw เพื่อไม่ให้ login ล้ม
// status: already | linked | not-found | taken | unavailable
async function autoLinkEmployeeByEmail(user, { findLinkedUser } = {}) {
  if (!user) return { status: 'not-found' };
  if (user.employeeId) return { status: 'already' };

  let employees;
  try {
    employees = await directory.fetchMonthlyEmployees();
  } catch (err) {
    console.error('[auto-link] employee lookup failed:', err.message);
    return { status: 'unavailable' };
  }

  const employee = findEmployeeByEmail(employees, user.email);
  if (!employee) return { status: 'not-found' };

  if (findLinkedUser) {
    const other = await findLinkedUser(employee.employeeId, user._id);
    if (other) return { status: 'taken', employee };
  }

  // ผูกแล้ว HR เป็นแหล่งข้อมูลหลักของชื่อ/แผนก/ตำแหน่ง
  user.employeeId = employee.employeeId;
  user.name = employee.name || user.name;
  user.department = employee.department || user.department;
  user.position = employee.position || user.position;
  return { status: 'linked', employee };
}

// save user หลัง auto-link; ถ้ารหัสพนักงานชนกับ user อื่นให้ถอดลิงก์แล้ว save ใหม่
async function saveWithEmployeeLinkFallback(user) {
  try {
    await user.save();
  } catch (err) {
    if (!isEmployeeIdConflict(err)) throw err;
    user.employeeId = '';
    await user.save();
  }
}

module.exports = { autoLinkEmployeeByEmail, saveWithEmployeeLinkFallback, isEmployeeIdConflict };
