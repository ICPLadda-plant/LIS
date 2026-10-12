import { render, renderHook, waitFor, act } from '@testing-library/react';
import { createElement, useLayoutEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePetition, usePetitionList } from './usePetition';

function mockFetchOk() {
  const fn = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit): Promise<{ ok: boolean; json: () => Promise<unknown> }> => ({
    ok: true,
    json: async () => ({ items: [], total: 0, page: 1, limit: 100 }),
  }));
  vi.stubGlobal('fetch', fn);
  return fn;
}

describe('usePetitionList auto-refetch', () => {
  let fetchMock: ReturnType<typeof mockFetchOk>;

  beforeEach(() => {
    fetchMock = mockFetchOk();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('refetches when the window regains focus (opt-in)', async () => {
    const { result } = renderHook(() =>
      usePetitionList({ page: 1, limit: 100, status: 'sampleSent' }, { refetchOnFocus: true }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    const afterMount = fetchMock.mock.calls.length;

    act(() => {
      window.dispatchEvent(new Event('focus'));
    });

    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(afterMount));
  });

  it('refetches when the tab becomes visible again (opt-in)', async () => {
    const { result } = renderHook(() =>
      usePetitionList({ page: 1, limit: 100, status: 'sampleSent' }, { refetchOnFocus: true }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    const afterMount = fetchMock.mock.calls.length;

    act(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
      document.dispatchEvent(new Event('visibilitychange'));
    });

    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(afterMount));
  });

  it('refetches on focus by default', async () => {
    const { result } = renderHook(() =>
      usePetitionList({ page: 1, limit: 100, status: 'sampleSent' }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    const afterMount = fetchMock.mock.calls.length;

    act(() => {
      window.dispatchEvent(new Event('focus'));
    });

    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(afterMount));
  });

  it('can disable refetch on focus', async () => {
    const { result } = renderHook(() =>
      usePetitionList({ page: 1, limit: 100, status: 'sampleSent' }, { refetchOnFocus: false, pollMs: 0 }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    const afterMount = fetchMock.mock.calls.length;

    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    await new Promise((r) => setTimeout(r, 50));

    expect(fetchMock.mock.calls.length).toBe(afterMount);
  });

  it('polls while the tab stays visible', async () => {
    const { result } = renderHook(() =>
      usePetitionList(
        { page: 1, limit: 100, status: 'sampleSent' },
        { refetchOnFocus: false, pollMs: 20 },
      ),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    const afterMount = fetchMock.mock.calls.length;

    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(afterMount));
  });

  it('includes assigned-to filters in the petition list request', async () => {
    const { result } = renderHook(() =>
      usePetitionList({
        page: 1,
        limit: 50,
        status: 'sampleSent,pendingReview,inProgress',
        assignedToEmployeeId: 'E123',
        assignedToNames: ['Analyst A', 'Analyst Alias'],
      }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    const requestedUrl = new URL(String(fetchMock.mock.calls[0][0]), 'http://localhost');
    expect(requestedUrl.searchParams.get('assignedToEmployeeId')).toBe('E123');
    expect(requestedUrl.searchParams.getAll('assignedToName')).toEqual(['Analyst A', 'Analyst Alias']);
  });

  it('requests the QC approval queue without waiting for both tracks', async () => {
    const { result } = renderHook(() =>
      usePetitionList({ awaitingQcApproval: true, limit: 100 }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    const requestedUrl = new URL(String(fetchMock.mock.calls[0][0]), 'http://localhost');
    expect(requestedUrl.searchParams.get('awaitingQcApproval')).toBe('true');
  });
});

describe('usePetition auto-refetch', () => {
  let fetchMock: ReturnType<typeof mockFetchOk>;

  beforeEach(() => {
    fetchMock = mockFetchOk();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('refetches petition detail on focus by default', async () => {
    const { result } = renderHook(() => usePetition('petition-1'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    const afterMount = fetchMock.mock.calls.length;

    act(() => {
      window.dispatchEvent(new Event('focus'));
    });

    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(afterMount));
  });

  it('does not show the previous petition while a new route is loading', async () => {
    fetchMock.mockImplementation(async (url) => {
      if (String(url).endsWith('/petitions/next')) return new Promise(() => {});
      return { ok: true, json: async () => ({ _id: 'first', petitionNo: 'P-1' }) };
    });
    const seen: Array<{ route: string; petitionId?: string }> = [];
    function Probe({ id }: { id: string }) {
      const { data } = usePetition(id, { refetchOnFocus: false, pollMs: 0 });
      useLayoutEffect(() => {
        seen.push({ route: id, petitionId: data?._id });
      }, [id, data]);
      return null;
    }

    const view = render(createElement(Probe, { id: 'first' }));
    await waitFor(() => expect(seen.some((entry) => entry.petitionId === 'first')).toBe(true));
    view.rerender(createElement(Probe, { id: 'next' }));
    expect(seen.filter((entry) => entry.route === 'next').map((entry) => entry.petitionId)).not.toContain('first');
  });
});
