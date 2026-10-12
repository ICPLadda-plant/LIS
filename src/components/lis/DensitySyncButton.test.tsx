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
      <DensitySyncButton batchNo="009" onRows={vi.fn()} {...props} />
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
        <DensitySyncButton batchNo="009" onRows={vi.fn()} onOptions={onOptions} />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(onOptions).toHaveBeenCalled());
    const calls = onOptions.mock.calls.length;

    view.rerender(
      <QueryClientProvider client={qc}>
        <DensitySyncButton batchNo="009" onRows={vi.fn()} onOptions={(docs) => onOptions(docs)} />
      </QueryClientProvider>,
    );

    expect(onOptions).toHaveBeenCalledTimes(calls);
  });

  it('auto applies the density row without showing a chooser', async () => {
    const docs = [
      { _id: 'a', 'Sample name': 'Batch 009 A', 'Measurement status': 'valid', 'Density (3 ตำแหน่ง)': '1.156', 'T(block) [°C]': '30.20' },
      { _id: 'b', 'Sample name': 'Batch 009 B', 'Measurement status': 'valid', 'Density (3 ตำแหน่ง)': '1.156', 'T(block) [°C]': '29.95' },
      { _id: 'c', 'Sample name': 'Batch 009 C', 'Measurement status': 'valid', 'Density (3 ตำแหน่ง)': '1.157', 'T(block) [°C]': '30.00' },
    ];
    vi.mocked(api.getResultDensitiesByBatch).mockResolvedValue({ batch: '009', docs });
    const onRows = vi.fn();

    renderWith({ onRows });

    await waitFor(() => expect(onRows).toHaveBeenCalledWith([docs[1]]));
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /ใช้ค่าที่เลือก/ })).not.toBeInTheDocument();
  });

  it('auto applies a single valid result row', async () => {
    const docs = [
      { _id: 'a', 'Sample name': 'Batch 009 A', 'Measurement status': 'valid', 'Density [g/cm³]': '0.991', 'T(block) [°C]': '31.5' },
    ];
    vi.mocked(api.getResultDensitiesByBatch).mockResolvedValue({ batch: '009', docs });
    const onRows = vi.fn();

    renderWith({ onRows });

    await waitFor(() => expect(onRows).toHaveBeenCalledWith([docs[0]]));
    expect(screen.queryByText(/รอค่า ถพ/)).not.toBeInTheDocument();
  });

  it('auto applies the repeated 3-decimal density row with T(block) closest to 30', async () => {
    const docs = [
      { _id: 'a', 'Sample name': 'Batch 009 A', 'Measurement status': 'valid', 'Density (3 ตำแหน่ง)': '1.157', 'T(block) [°C]': '29.80' },
      { _id: 'b', 'Sample name': 'Batch 009 B', 'Measurement status': 'valid', 'Density (3 ตำแหน่ง)': '1.157', 'T(block) [°C]': '30.10' },
      { _id: 'c', 'Sample name': 'Batch 009 C', 'Measurement status': 'valid', 'Density (3 ตำแหน่ง)': '1.158', 'T(block) [°C]': '30.00' },
    ];
    vi.mocked(api.getResultDensitiesByBatch).mockResolvedValue({ batch: '009', docs });
    const onRows = vi.fn();

    renderWith({ onRows });

    await waitFor(() => expect(onRows).toHaveBeenCalledWith([docs[1]]));
  });

  it('does not apply or show wait status when repeated rows are not valid', async () => {
    const docs = [
      { _id: 'a', 'Sample name': 'Batch 009 A', 'Measurement status': 'invalid', 'Density (3 ตำแหน่ง)': '1.157', 'T(block) [°C]': '30.00' },
      { _id: 'b', 'Sample name': 'Batch 009 B', 'Measurement status': 'invalid', 'Density (3 ตำแหน่ง)': '1.157', 'T(block) [°C]': '30.00' },
    ];
    vi.mocked(api.getResultDensitiesByBatch).mockResolvedValue({ batch: '009', docs });
    const onRows = vi.fn();

    renderWith({ onRows });

    await waitFor(() => expect(api.getResultDensitiesByBatch).toHaveBeenCalledWith('009'));
    expect(screen.queryByText(/รอค่า ถพ/)).not.toBeInTheDocument();
    expect(onRows).not.toHaveBeenCalled();
  });
});
