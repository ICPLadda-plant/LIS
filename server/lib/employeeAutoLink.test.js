const test = require('node:test');
const assert = require('node:assert/strict');
const directory = require('./employeeDirectory');
const { autoLinkEmployeeByEmail } = require('./employeeAutoLink');

const hrRows = [{
  employeeId: '11204',
  name: 'นางอัจฉรา บุญไทย',
  department: 'ผลิต 4',
  position: 'หัวหน้าแผนก ผลิต 4',
  email: 'achara.b@icpladda.com',
}];

test('links an unlinked user whose email matches HR (case-insensitive)', async (context) => {
  context.mock.method(directory, 'fetchMonthlyEmployees', async () => hrRows);
  const user = { _id: 'u1', email: 'Achara.B@icpladda.com', employeeId: '', name: 'achara', department: 'production' };

  const result = await autoLinkEmployeeByEmail(user, { findLinkedUser: async () => null });

  assert.equal(result.status, 'linked');
  assert.equal(user.employeeId, '11204');
  assert.equal(user.name, 'นางอัจฉรา บุญไทย');
  assert.equal(user.department, 'ผลิต 4');
});

test('does not link when the employee is already linked to another user', async (context) => {
  context.mock.method(directory, 'fetchMonthlyEmployees', async () => hrRows);
  const user = { _id: 'u1', email: 'achara.b@icpladda.com', employeeId: '' };

  const result = await autoLinkEmployeeByEmail(user, { findLinkedUser: async () => ({ _id: 'u2' }) });

  assert.equal(result.status, 'taken');
  assert.equal(user.employeeId, '');
});

test('reports not-found and unavailable without throwing', async (context) => {
  const mock = context.mock.method(directory, 'fetchMonthlyEmployees', async () => hrRows);
  assert.equal((await autoLinkEmployeeByEmail({ email: 'nobody@icpladda.com', employeeId: '' })).status, 'not-found');

  mock.mock.mockImplementation(async () => { throw new Error('HR down'); });
  assert.equal((await autoLinkEmployeeByEmail({ email: 'achara.b@icpladda.com', employeeId: '' })).status, 'unavailable');
});

test('leaves an existing link untouched', async () => {
  const user = { email: 'achara.b@icpladda.com', employeeId: '9999' };
  assert.equal((await autoLinkEmployeeByEmail(user)).status, 'already');
  assert.equal(user.employeeId, '9999');
});
