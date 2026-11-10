import { beforeEach, describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import DensitySyncButton from './DensitySyncButton';
import { api } from '@/lib/api';

vi.mock('@/lib/api', () => ({
  api: {
    triggerDensitySync: vi.fn().mockResolvedValue({ triggered: true }),
    getResultDensitiesByBatch: vi.fn().mockResolvedValue({ batch: '009', docs: [] }),
  },
}));

function renderWith(props: Partial<React.ComponentProps<typeof DensitySyncButton>> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <DensitySyncButton batchNo="009" {...props} />
    </QueryClientProvider>,
  );
}

describe('DensitySyncButton', () => {
  beforeEach(() => {
    vi.mocked(api.triggerDensitySync).mockClear();
    vi.mocked(api.getResultDensitiesByBatch).mockClear();
    vi.mocked(api.getResultDensitiesByBatch).mockResolvedValue({ batch: '009', docs: [] });
  });

  it('does not render a manual sync button or wait status', () => {
    renderWith();
    expect(screen.queryByRole('button', { name: /ดึงค่า ถพ\./ })).not.toBeInTheDocument();
    expect(screen.queryByText(/รอค่า ถพ/)).not.toBeInTheDocument();
  });

  it('does not query when batchNo is empty', async () => {
    renderWith({ batchNo: '' });
    await Promise.resolve();
    expect(api.getResultDensitiesByBatch).not.toHaveBeenCalled();
  });

  it('queries matching density rows on mount without triggering sync webhook', async () => {
    renderWith();
    await waitFor(() => expect(api.getResultDensitiesByBatch).toHaveBeenCalledWith('009'));
    expect(api.triggerDensitySync).not.toHaveBeenCalled();
  });

  it('does not report the same options again when its parent rerenders', async () => {
    const onOptions = vi.fn();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(
      <QueryClientProvider client={qc}>
        <DensitySyncButton batchNo="009" onOptions={onOptions} />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(onOptions).toHaveBeenCalled());
    const calls = onOptions.mock.calls.length;

    view.rerender(
      <QueryClientProvider client={qc}>
        <DensitySyncButton batchNo="009" onOptions={(docs) => onOptions(docs)} />
      </QueryClientProvider>,
    );

    expect(onOptions).toHaveBeenCalledTimes(calls);
  });

  it('reports every machine row as a choice without applying one by itself', async () => {
    const docs = [
      { _id: 'a', 'Sample name': 'Batch 009 A', 'Measurement status': 'valid', 'Density (3 ตำแหน่ง)': '1.156', 'T(block) [°C]': '30.20' },
      { _id: 'b', 'Sample name': 'Batch 009 B', 'Measurement status': 'valid', 'Density (3 ตำแหน่ง)': '1.156', 'T(block) [°C]': '29.95' },
      { _id: 'c', 'Sample name': 'Batch 009 C', 'Measurement status': 'valid', 'Density (3 ตำแหน่ง)': '1.157', 'T(block) [°C]': '30.00' },
    ];
    vi.mocked(api.getResultDensitiesByBatch).mockResolvedValue({ batch: '009', docs });
    const onOptions = vi.fn();

    renderWith({ onOptions });

    await waitFor(() => expect(onOptions).toHaveBeenLastCalledWith(docs));
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    expect(screen.queryByText(/ใช้ค่า ถพ\. จากเครื่องแล้ว/)).not.toBeInTheDocument();
  });
});
