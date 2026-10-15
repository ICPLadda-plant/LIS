import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setApiUserEmail, uploadQcPhoto } from './api';

describe('uploadQcPhoto', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    setApiUserEmail('qc@example.com');
  });

  it('sends the current LIS identity with the multipart request', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ url: '/LIS/uploads/qc-photos/photo.png' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const file = new File(['photo'], 'photo.png', { type: 'image/png' });

    await uploadQcPhoto(file);

    expect(fetchMock).toHaveBeenCalledWith('/api/uploads/qc-photo', expect.objectContaining({
      method: 'POST',
      credentials: 'include',
      headers: { 'X-LIS-User': 'qc@example.com' },
      body: expect.any(FormData),
    }));
  });
});
