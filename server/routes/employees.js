const express = require('express');
const { fetchMonthlyEmployees } = require('../lib/employeeDirectory');
const { LAB_ANALYST_ROLE_RX, userToAssignee, mergeAssignees } = require('../lib/assignees');
const User = require('../models/User');

const router = express.Router();

const ALLOWED_DEPARTMENTS = ['Lab/วิเคราะห์'];

function toAssignee(e) {
  return {
    id: e.id,
    employeeId: e.employeeId,
    name: e.name,
    department: e.department,
    position: e.position,
    empType: e.empType,
    isActive: e.isActive,
  };
}

function toDirectoryEntry(e) {
  return {
    employeeId: e.employeeId,
    name: e.name,
    department: e.department,
    position: e.position,
    email: e.email,
  };
}

function byDeptThenName(a, b) {
  return (
    a.department.localeCompare(b.department, 'th') ||
    a.name.localeCompare(b.name, 'th')
  );
}

// Drives the /petitions/assign picker. Two sources, unioned: HR monthly staff in
// the Lab/วิเคราะห์ department, plus any LIS user holding a lab-analyst role —
// so a lab-analyst can be assigned (and then see their lab-testing queue) even
// when their HR department isn't Lab/วิเคราะห์. Role users need an employeeId
// (the picker keys options by it, and isAssignedTo matches on it).
router.get('/assignees', async (_req, res) => {
  try {
    const [employees, roleUsers] = await Promise.all([
      fetchMonthlyEmployees(),
      User.find({
        status: 'active',
        employeeId: { $gt: '' },
        $or: [{ roles: LAB_ANALYST_ROLE_RX }, { role: LAB_ANALYST_ROLE_RX }],
      }).lean(),
    ]);
    const deptAssignees = employees
      .filter((e) => ALLOWED_DEPARTMENTS.includes(e.department))
      .map(toAssignee);
    const roleAssignees = roleUsers.map(userToAssignee);
    const result = mergeAssignees(deptAssignees, roleAssignees).sort(byDeptThenName);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: { message: err.message } });
  }
});

// All active monthly employees (every department) — drives the Access Control
// "link to employee" picker.
// ผู้รับงานคำร้องเฉพาะ Admin (PACLOBUTRAZOL) — เฉพาะผู้ใช้ role admin ที่ผูกรหัสพนักงานแล้ว
router.get('/admin-assignees', async (_req, res) => {
  try {
    const admins = await User.find({
      status: 'active',
      employeeId: { $gt: '' },
      $or: [{ roles: 'admin' }, { role: 'admin' }],
    }).lean();
    res.json(admins.map(userToAssignee).sort(byDeptThenName));
  } catch (err) {
    res.status(500).json({ error: { message: err.message } });
  }
});

router.get('/directory', async (_req, res) => {
  try {
    const employees = await fetchMonthlyEmployees();
    const result = employees.map(toDirectoryEntry).sort(byDeptThenName);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: { message: err.message } });
  }
});

module.exports = router;
