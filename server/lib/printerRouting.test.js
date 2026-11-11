const {
  PRINTER_KINDS,
  DOC_TYPE_KIND,
  PRINT_DOC_TYPES,
  kindForDocType,
  paperSizeForSlug,
  normalizePrinterAssignmentsInput,
  pickPrinterAssignmentRoute,
  normalizePrinterAddress,
  printerTargetFromAddress,
  validatePrinterInput,
  pickDefault,
} = require('./printerRouting');

describe('printerRouting kinds/map', () => {
  test('two kinds', () => {
    expect(PRINTER_KINDS).toEqual(['a4', 'sticker']);
  });
  test('all six doc types map to a kind', () => {
    expect(PRINT_DOC_TYPES).toEqual([
      'sample-label', 'stock-label', 'coa', 'service-request', 'daily-check-report', 'goods-receipt',
    ]);
    expect(kindForDocType('sample-label')).toBe('sticker');
    expect(kindForDocType('stock-label')).toBe('sticker');
    expect(kindForDocType('coa')).toBe('a4');
    expect(kindForDocType('service-request')).toBe('a4');
    expect(kindForDocType('daily-check-report')).toBe('a4');
    expect(kindForDocType('goods-receipt')).toBe('a4');
    expect(kindForDocType('nope')).toBeNull();
  });
  test('paper size derives from slug', () => {
    expect(paperSizeForSlug('sample-label')).toBe('label-100x50');
    expect(paperSizeForSlug('stock-label')).toBe('label-65x25');
    expect(paperSizeForSlug('coa')).toBe('A4');
    expect(paperSizeForSlug('anything-else')).toBe('A4');
  });
});

describe('printer assignment config', () => {
  test('normalizes department, paper size, and multiple document choices on a printer', () => {
    expect(normalizePrinterAssignmentsInput({
      assignments: [
        {
          department: ' QC ',
          docTypes: ['sample-label', 'stock-label', 'sample-label'],
          paperSize: 'label-100x50',
        },
      ],
    }, 'sticker')).toEqual({
      assignments: [
        {
          department: 'QC',
          docTypes: ['sample-label', 'stock-label'],
          paperSize: 'label-100x50',
        },
      ],
    });
  });

  test('rejects assignments with invalid documents, wrong printer kind, or invalid paper size', () => {
    expect(normalizePrinterAssignmentsInput({
      assignments: [{ department: 'QC', docTypes: ['unknown'], paperSize: 'A4' }],
    }, 'a4').error).toMatch(/เอกสาร/);

    expect(normalizePrinterAssignmentsInput({
      assignments: [{ department: 'QC', docTypes: ['sample-label'], paperSize: 'A4' }],
    }, 'a4').error).toMatch(/ประเภทเครื่อง/);

    expect(normalizePrinterAssignmentsInput({
      assignments: [{ department: 'QC', docTypes: ['coa'], paperSize: 'letter' }],
    }, 'a4').error).toMatch(/paperSize/);
  });

  test('picks printer assignment by document and exact department before all-department fallback', () => {
    const printers = [
      {
        id: 'global-a4',
        kind: 'a4',
        isDefault: true,
        assignments: [{ department: '', docTypes: ['coa'], paperSize: 'A4' }],
      },
      {
        id: 'qc-a4',
        kind: 'a4',
        isDefault: false,
        assignments: [{ department: 'QC', docTypes: ['coa', 'service-request'], paperSize: 'label-65x25' }],
      },
      {
        id: 'stock-label',
        kind: 'sticker',
        isDefault: true,
        assignments: [{ department: 'QC', docTypes: ['stock-label'], paperSize: 'label-65x25' }],
      },
    ];

    expect(pickPrinterAssignmentRoute(printers, 'coa', 'QC')).toMatchObject({
      printerConfig: { id: 'qc-a4' },
      assignment: { department: 'QC', paperSize: 'label-65x25' },
      paperSize: 'label-65x25',
    });
    expect(pickPrinterAssignmentRoute(printers, 'coa', 'ผลิต 1')).toMatchObject({
      printerConfig: { id: 'global-a4' },
      assignment: { department: '', paperSize: 'A4' },
      paperSize: 'A4',
    });
    expect(pickPrinterAssignmentRoute(printers, 'service-request', 'ผลิต 1')).toBeNull();
  });

  test('matches zero-padded department ผลิต 03 to printer assigned to ผลิต 3', () => {
    const printers = [{ id: 'p3', kind: 'sticker', assignments: [{ department: 'ผลิต 3', docTypes: ['sample-label'], paperSize: 'label-100x50' }] }];
    expect(pickPrinterAssignmentRoute(printers, 'sample-label', 'ผลิต 03')).toMatchObject({ printerConfig: { id: 'p3' } });
  });

  test('does not use default flag to bypass print-time choice when multiple assignments match', () => {
    const printers = [
      {
        id: 'first-qc',
        kind: 'sticker',
        isDefault: false,
        assignments: [{ department: 'QC', docTypes: ['sample-label'], paperSize: 'label-100x50' }],
      },
      {
        id: 'default-qc',
        kind: 'sticker',
        isDefault: true,
        assignments: [{ department: 'QC', docTypes: ['sample-label'], paperSize: 'label-65x25' }],
      },
    ];

    expect(pickPrinterAssignmentRoute(printers, 'sample-label', 'QC')).toMatchObject({
      printerConfig: { id: 'first-qc' },
      paperSize: 'label-100x50',
    });
  });
});

describe('validatePrinterInput', () => {
  const ok = 'https://192.168.0.237:631/printers/HP-A4';
  test('accepts a valid CUPS URL', () => {
    expect(validatePrinterInput({ kind: 'a4', cupsPrinterUrl: ok })).toBeNull();
    expect(validatePrinterInput({ kind: 'sticker', cupsPrinterUrl: 'ipps://host:631/classes/labels' })).toBeNull();
  });
  test('rejects bad kind', () => {
    expect(validatePrinterInput({ kind: 'a3', cupsPrinterUrl: ok })).toMatch(/kind/);
  });
  test('rejects missing url when required', () => {
    expect(validatePrinterInput({ kind: 'a4', cupsPrinterUrl: '' })).toMatch(/Printer IP \/ URL/);
  });
  test('allows empty url when requireUrl false', () => {
    expect(validatePrinterInput({ kind: 'a4', cupsPrinterUrl: '' }, { requireUrl: false })).toBeNull();
  });
  test('rejects non-url and non-host input', () => {
    expect(validatePrinterInput({ kind: 'a4', cupsPrinterUrl: 'not a url' })).toMatch(/ไม่ถูกต้อง/);
  });
  test('rejects wrong protocol', () => {
    expect(validatePrinterInput({ kind: 'a4', cupsPrinterUrl: 'ftp://host/printers/x' })).toMatch(/http/);
  });
  test('accepts url with no queue as direct URL', () => {
    expect(validatePrinterInput({ kind: 'a4', cupsPrinterUrl: 'https://192.168.0.237:631/' })).toBeNull();
  });
});

describe('printer address normalization', () => {
  test('accepts direct printer IP and host', () => {
    expect(validatePrinterInput({ kind: 'sticker', cupsPrinterUrl: '192.168.1.50' })).toBeNull();
    expect(validatePrinterInput({ kind: 'a4', cupsPrinterUrl: 'printer.local' })).toBeNull();
  });

  test('normalizes bare values to IPP endpoint', () => {
    expect(normalizePrinterAddress('192.168.1.50')).toBe('ipp://192.168.1.50:631/ipp/print');
    expect(normalizePrinterAddress('printer.local')).toBe('ipp://printer.local:631/ipp/print');
    expect(normalizePrinterAddress('192.168.1.50:632')).toBe('ipp://192.168.1.50:632/ipp/print');
  });

  test('keeps full CUPS and IPP URLs intact', () => {
    expect(normalizePrinterAddress('http://cups:631/printers/Zebra')).toBe('http://cups:631/printers/Zebra');
    expect(normalizePrinterAddress('ipps://printer.local:631/ipp/print')).toBe('ipps://printer.local:631/ipp/print');
  });

  test('resolves target uri for CUPS and direct IPP', () => {
    expect(printerTargetFromAddress('http://cups:631/printers/Zebra')).toEqual({
      printerUri: 'ipp://cups:631/printers/Zebra',
      display: 'http://cups:631/printers/Zebra',
      isDirect: false,
    });
    expect(printerTargetFromAddress('192.168.1.50')).toEqual({
      printerUri: 'ipp://192.168.1.50:631/ipp/print',
      display: '192.168.1.50',
      isDirect: true,
    });
  });
});

describe('pickDefault', () => {
  const list = [
    { id: '1', kind: 'a4', isDefault: false },
    { id: '2', kind: 'a4', isDefault: true },
    { id: '3', kind: 'sticker', isDefault: false },
  ];
  test('returns the explicit default of the kind', () => {
    expect(pickDefault(list, 'a4').id).toBe('2');
  });
  test('does not invent a default when none flagged', () => {
    expect(pickDefault(list, 'sticker')).toBeNull();
  });
  test('null when kind absent or list empty', () => {
    expect(pickDefault(list, 'nope')).toBeNull();
    expect(pickDefault([], 'a4')).toBeNull();
    expect(pickDefault(undefined, 'a4')).toBeNull();
  });
});
