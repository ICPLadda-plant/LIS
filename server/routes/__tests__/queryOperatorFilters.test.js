const stockRouter = require('../stock');

describe('query filters ignore MongoDB operator objects', () => {
  test('buildTransactionFilter drops object values from qs-parsed query', () => {
    const filter = stockRouter.buildTransactionFilter({
      itemType: { $regex: '(a+)+$' },
      itemId: { $ne: '' },
      action: { $in: ['deduct'] },
    });
    expect(filter.itemType).toBeUndefined();
    expect(filter.itemId).toBeUndefined();
    expect(filter.action).toBeUndefined();
  });

  test('buildTransactionFilter keeps normal string values', () => {
    const filter = stockRouter.buildTransactionFilter({ itemType: 'standard', itemId: 'abc', action: 'deduct' });
    expect(filter).toMatchObject({ itemType: 'standard', itemId: 'abc', action: 'deduct' });
  });
});
