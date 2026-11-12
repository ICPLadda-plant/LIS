const mockGenerateJSONFromImage = jest.fn();
const mockIsOpenAIConfigured = jest.fn();

jest.mock('../lib/openaiClient', () => ({
  isOpenAIConfigured: () => mockIsOpenAIConfigured(),
  generateStream: jest.fn(),
  generateJSON: jest.fn(),
  generateJSONFromImage: (...args) => mockGenerateJSONFromImage(...args),
}));

const aiRouter = require('./ai');

function routeHandler(path, method = 'post') {
  const layer = aiRouter.stack.find((entry) => entry.route?.path === path && entry.route.methods[method]);
  if (!layer) throw new Error(`route not found: ${method.toUpperCase()} ${path}`);
  return layer.route.stack[0].handle;
}

function mockResponse() {
  return {
    statusCode: 200,
    status: jest.fn(function status(code) {
      this.statusCode = code;
      return this;
    }),
    json: jest.fn(function json(body) {
      this.body = body;
      return this;
    }),
  };
}

describe('stock label OCR route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsOpenAIConfigured.mockReturnValue(true);
  });

  test('rejects requests without an image data URL', async () => {
    const handler = routeHandler('/stock-label-ocr');
    const res = mockResponse();

    await handler({ body: {} }, res);

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'imageDataUrl required' });
  });

  test('returns 503 when OpenAI is not configured', async () => {
    mockIsOpenAIConfigured.mockReturnValue(false);
    const handler = routeHandler('/stock-label-ocr');
    const res = mockResponse();

    await handler({ body: { imageDataUrl: 'data:image/jpeg;base64,abc' } }, res);

    expect(res.statusCode).toBe(503);
    expect(res.body).toEqual({ error: 'OpenAI API key ไม่ได้ตั้งค่า' });
  });

  test('normalizes OCR candidates to stock label digits', async () => {
    mockGenerateJSONFromImage.mockResolvedValue({
      labelCode: ' 1016801 ',
      candidates: ['10-16801', 'abc'],
      rawText: 'Code 1016801',
    });
    const handler = routeHandler('/stock-label-ocr');
    const res = mockResponse();

    await handler({ body: { imageDataUrl: 'data:image/jpeg;base64,abc' } }, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      labelCode: '1016801',
      candidates: ['1016801'],
      rawText: 'Code 1016801',
    });
    expect(mockGenerateJSONFromImage).toHaveBeenCalledWith(
      expect.stringContaining('เลขใต้ QR'),
      'data:image/jpeg;base64,abc',
      expect.objectContaining({
        system: expect.stringContaining('บางส่วนของสติ๊กเกอร์'),
        temperature: 0,
        maxTokens: 300,
      }),
    );
  });
});

describe('balance display OCR route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsOpenAIConfigured.mockReturnValue(true);
  });

  test('returns a normalized decimal value from the balance display', async () => {
    mockGenerateJSONFromImage.mockResolvedValue({ value: ' +100,0123 g ', rawText: '+100,0123 g' });
    const handler = routeHandler('/balance-display-ocr');
    const res = mockResponse();

    await handler({ body: { imageDataUrl: 'data:image/jpeg;base64,abc' } }, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ value: '100.0123', rawText: '+100,0123 g' });
  });
});
