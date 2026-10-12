import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, type ParameterItem } from '@/lib/api';
import type { AdditionalSampleRequest, Petition, QCTestResult } from '@/types/petition.types';
import QCTestingDetailPage from './QCTestingDetailPage';
import LabTestingDetailPage from './LabTestingDetailPage';

const state = vi.hoisted(() => ({ petition: null as Petition | null, parameters: [] as ParameterItem[], results: [] as QCTestResult[] }));
vi.mock('react-router-dom', async (importOriginal) => ({
  ...await importOriginal<typeof import('react-router-dom')>(),
  useParams: () => ({ id: 'petition-1' }),
  useNavigate: () => vi.fn(),
  useLocation: () => ({ pathname: '/qc-testing/petition-1', search: '', hash: '', state: null, key: 'test' }),
  useSearchParams: () => [new URLSearchParams(), vi.fn()],
  Navigate: () => null,
}));
vi.mock('@tanstack/react-query', () => ({ useQueries: () => [] }));
vi.mock('@/components/lis/AppLayout', () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock('@/components/lis/PageHeader', () => ({ default: () => <header>คำร้อง</header> }));
vi.mock('@/hooks/usePetition', () => ({ usePetition: () => ({ data: state.petition, loading: false, error: null }), usePetitionList: () => ({ data: { items: [] } }) }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { name: 'ผู้ตรวจ', email: 'tester@example.com', roles: ['admin'] } }) }));
vi.mock('@/hooks/useArrivalFlash', () => ({ useArrivalFlash: () => '' }));
vi.mock('@/hooks/useItemGroupMembership', () => ({ useItemGroupMembership: () => ({ get: () => [] }) }));
vi.mock('@/context/ConfirmDialog', () => ({ useConfirm: () => vi.fn().mockResolvedValue(true) }));
vi.mock('@/lib/aiApi', () => ({ getAiStatus: () => Promise.resolve({ available: false }), checkOutlier: vi.fn(), streamAnalyzeQC: vi.fn() }));
vi.mock('@/lib/api', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/api')>(),
  api: {
    getParameters: vi.fn(() => Promise.resolve(state.parameters)),
    getQCResults: vi.fn(() => Promise.resolve(state.results)),
    getInstrumentSources: vi.fn().mockResolvedValue([]),
    getReturnedFlags: vi.fn().mockResolvedValue({}),
    saveQCResult: vi.fn(), saveQCEntries: vi.fn(), completePetitionTrack: vi.fn(), post: vi.fn(), patch: vi.fn(),
  },
}));

const sampleRequest = (side: 'qc' | 'lab', status: AdditionalSampleRequest['status'] = 'requested'): AdditionalSampleRequest => ({
  _id: 'round-' + side, qrCode: 'QR-' + side, side, status, reason: 'ค่าสูงกว่าเกณฑ์',
  items: [{ itemSeq: 1, quantity: 1 }], requestedAt: '2026-09-19T01:00:00Z', requestedBy: { name: 'ผู้ตรวจ' },
});

describe.each(['qc', 'lab'] as const)('%s additional sample integration', (side) => {
  const Page = side === 'qc' ? QCTestingDetailPage : LabTestingDetailPage;
  beforeEach(() => {
    vi.clearAllMocks();
    state.petition = {
      _id: 'petition-1', petitionNo: 'LIS-001', dept: 'rm', status: 'inProgress',
      submittedBy: { name: 'ผู้ยื่น', submittedAt: '2026-09-19T01:00:00Z' },
      qcReceivedAt: '2026-09-19T01:00:00Z', labReceivedAt: '2026-09-19T01:00:00Z',
      items: [{ seq: 1, sampleName: 'ตัวอย่าง A', batchNo: '1231' }],
      createdAt: '2026-09-19T01:00:00Z', updatedAt: '2026-09-19T01:00:00Z',
    };
    state.parameters = [{ _id: 'param', name: 'Assay', scope: side, applyAll: true, valueFields: [{ label: 'ค่า', type: 'number', required: true, standardOperator: 'lte', standardValue: 10 }] }];
    state.results = [{ petitionId: 'petition-1', itemSeq: 1, parameterId: 'param', sampleRoundId: '', values: { ค่า: 20 } }];
    vi.mocked(api.saveQCResult).mockResolvedValue(state.results[0]);
  });
  afterEach(cleanup);

  it('locks fields and completion while this side waits for additional samples', async () => {
    state.petition!.additionalSampleRequests = [sampleRequest(side)];
    render(<Page />);
    expect(await screen.findByRole('spinbutton')).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('รอรับตัวอย่างเพิ่ม');
    expect(screen.queryByRole('button', { name: /^บันทึก/ })).not.toBeInTheDocument();
    expect(api.completePetitionTrack).not.toHaveBeenCalled();
  });

  it('does not lock the other side', async () => {
    state.petition!.additionalSampleRequests = [sampleRequest(side === 'qc' ? 'lab' : 'qc')];
    render(<Page />);
    const input = await screen.findByRole('spinbutton');
    await waitFor(() => expect(input).toBeEnabled());
  });

  it('clears old result values after receiving a new round and writes its sampleRoundId', async () => {
    state.petition!.additionalSampleRequests = [sampleRequest(side, 'received')];
    render(<Page />);
    const input = await screen.findByRole('spinbutton');
    await waitFor(() => expect(input).toHaveValue(null));
    fireEvent.change(input, { target: { value: '5' } });
    await waitFor(() => expect(api.saveQCResult).toHaveBeenCalledWith(expect.objectContaining({ sampleRoundId: 'round-' + side, value: '5' })), { timeout: 2500 });
  });

  it('requests more samples only after autosaves finish, keeps track open and shows waiting state', async () => {
    let finish: (value: QCTestResult) => void = () => {};
    vi.mocked(api.saveQCResult).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    vi.mocked(api.post).mockResolvedValue({ data: { data: { ...state.petition, additionalSampleRequests: [sampleRequest(side)] } } });
    render(<Page />);
    const input = await screen.findByRole('spinbutton');
    await waitFor(() => expect(input).toHaveValue(20));
    fireEvent.change(input, { target: { value: '30' } });
    fireEvent.click(await screen.findByRole('button', { name: 'ขอตัวอย่างเพิ่ม' }));
    fireEvent.change(screen.getByLabelText('เหตุผลที่ขอตัวอย่างเพิ่ม'), { target: { value: 'ค่าสูงกว่าเกณฑ์' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /ตัวอย่าง A/ }));
    fireEvent.change(screen.getByRole('spinbutton', { name: 'น้ำหนักตัวอย่างที่ 1 รายการที่ 1' }), { target: { value: '500' } });
    fireEvent.click(screen.getByRole('button', { name: 'ส่งคำขอ' }));
    await waitFor(() => expect(api.saveQCResult).toHaveBeenCalled());
    expect(api.post).not.toHaveBeenCalled();
    finish(state.results[0]);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('รอรับตัวอย่างเพิ่ม'));
    expect(api.post).toHaveBeenCalledWith('/petitions/petition-1/additional-samples', expect.objectContaining({ items: [{ itemSeq: 1, quantity: 1, weights: [500] }] }));
    expect(input).toBeDisabled();
    expect(api.completePetitionTrack).not.toHaveBeenCalled();
  });

  it('offers the request when only Phase 2 is abnormal', async () => {
    state.petition!.currentPhase = 2;
    state.parameters[0].hasPhases = true;
    state.results[0].values = { ค่า: 5 };
    state.results[0].valuesPhase2 = { ค่า: 20 };
    render(<Page />);
    const button = await screen.findByRole('button', { name: 'ขอตัวอย่างเพิ่ม' });
    await waitFor(() => expect(button).toBeEnabled());
  });

  it('starts a received additional round in Phase 1 and never reuses Phase 2 values', async () => {
    state.petition!.currentPhase = 2;
    state.petition!.phase2UnlockedAt = '2026-09-19T00:00:00Z';
    state.petition!.additionalSampleRequests = [sampleRequest(side, 'received')];
    state.parameters[0].hasPhases = true;
    state.results[0].valuesPhase2 = { ค่า: 40 };
    render(<Page />);
    const input = await screen.findByRole('spinbutton');
    await waitFor(() => expect(input).toBeEnabled());
    expect(input).toHaveValue(null);
    fireEvent.change(input, { target: { value: '4' } });
    await waitFor(() => expect(api.saveQCResult).toHaveBeenCalledWith(expect.objectContaining({ phase: 1, sampleRoundId: 'round-' + side, value: '4' })), { timeout: 2500 });
    expect(screen.getByRole('button', { name: /Phase 2: ตรวจซ้ำ/ })).toBeDisabled();
    expect(screen.queryByText('พร้อมตรวจซ้ำแล้ว')).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue('40')).not.toBeInTheDocument();
  });

  it('unlocks Phase 2 only from the received round metadata, not the original trigger', async () => {
    state.petition!.currentPhase = 1;
    state.petition!.phase2TriggeredBy = { parameterId: 'param', fieldLabel: 'ค่า', itemSeq: 1, triggeredAt: '2026-09-19T00:00:00Z' };
    state.petition!.additionalSampleRequests = [{ ...sampleRequest(side, 'received'), currentPhase: 2, phase2UnlockedAt: '2026-09-19T02:00:00Z', phase2TriggeredBy: { parameterId: 'round-trigger', fieldLabel: 'timer', itemSeq: 1, triggeredAt: '2026-09-19T01:00:00Z' } }];
    state.parameters[0].hasPhases = true;
    state.results[0].valuesPhase2 = { ค่า: 40 };
    render(<Page />);
    const input = await screen.findByRole('spinbutton');
    await waitFor(() => expect(input).toBeEnabled());
    expect(screen.getByRole('button', { name: /Phase 2: ตรวจซ้ำ/ })).toBeEnabled();
    expect(input).toHaveValue(null);
    fireEvent.click(screen.getByRole('button', { name: /Phase 2: ตรวจซ้ำ/ }));
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '7' } });
    await waitFor(() => expect(api.saveQCResult).toHaveBeenCalledWith(expect.objectContaining({ phase: 2, sampleRoundId: 'round-' + side, value: '7' })), { timeout: 2500 });
  });

  it('keeps an unaffected item in the original Phase 2 while the requested item starts Phase 1', async () => {
    state.petition!.currentPhase = 2;
    state.petition!.additionalSampleRequests = [sampleRequest(side, 'received')];
    state.petition!.items.push({ seq: 2, sampleName: 'ตัวอย่าง B', batchNo: '1241' });
    state.parameters[0].hasPhases = true;
    state.results.push({ petitionId: 'petition-1', itemSeq: 2, parameterId: 'param', sampleRoundId: '', values: { ค่า: 3 }, valuesPhase2: { ค่า: 44 } });
    render(<Page />);
    expect(await screen.findByDisplayValue('44')).toBeEnabled();
    expect(screen.queryByDisplayValue('20')).not.toBeInTheDocument();
    const phaseButtons = screen.getAllByRole('button', { name: /Phase 2: ตรวจซ้ำ/ });
    expect(phaseButtons.filter((button) => (button as HTMLButtonElement).disabled)).toHaveLength(1);
  });

  it('unlocks the received round when refreshed server metadata advances its phase', async () => {
    state.petition!.currentPhase = 2;
    state.petition!.additionalSampleRequests = [sampleRequest(side, 'received')];
    state.parameters[0].hasPhases = true;
    const view = render(<Page />);
    expect(await screen.findByRole('button', { name: /Phase 2: ตรวจซ้ำ/ })).toBeDisabled();
    state.petition = { ...state.petition!, updatedAt: '2026-09-19T04:00:00Z', additionalSampleRequests: [{ ...sampleRequest(side, 'received'), currentPhase: 2, phase2UnlockedAt: '2026-09-19T04:00:00Z' }] };
    view.rerender(<Page />);
    await waitFor(() => expect(screen.getByRole('button', { name: /Phase 2: ตรวจซ้ำ/ })).toBeEnabled());
    expect(screen.getByText('พร้อมตรวจซ้ำแล้ว')).toBeInTheDocument();
  });

  it('uses the saved other-side parameter when detecting a conditional failure', async () => {
    state.parameters[0].valueFields = [{ label: 'ค่า', type: 'number', required: true, conditionalMode: true,
      conditionalStandards: [{ conditions: [{ sourceParameterId: 'control', sourceFieldLabel: 'kind', op: 'eq', value: 'low' }], operator: 'lte', value: 10 }],
    }];
    state.parameters.push({ _id: 'control', name: 'Control', scope: side === 'qc' ? 'lab' : 'qc', applyAll: true, valueFields: [{ label: 'kind', type: 'text' }] });
    state.results.push({ petitionId: 'petition-1', itemSeq: 1, parameterId: 'control', values: { kind: 'low' } });
    render(<Page />);
    const button = await screen.findByRole('button', { name: 'ขอตัวอย่างเพิ่ม' });
    await waitFor(() => expect(button).toBeEnabled());
  });

  it('sends the expected sampleRoundId for a new multi-entry field', async () => {
    state.petition!.additionalSampleRequests = [sampleRequest(side, 'received')];
    state.parameters[0].multiEntry = true;
    state.results[0].entries = [{ ค่า: 80 }];
    render(<Page />);
    const input = await screen.findByRole('spinbutton');
    await waitFor(() => expect(input).toBeEnabled());
    expect(input).toHaveValue(null);
    fireEvent.change(input, { target: { value: '6' } });
    await waitFor(() => expect(api.saveQCResult).toHaveBeenCalledWith(expect.objectContaining({ entryIndex: 0, sampleRoundId: 'round-' + side, value: '6' })), { timeout: 2500 });
  });

  it('keeps the current round on whole-entry writes when removing a row', async () => {
    state.petition!.additionalSampleRequests = [sampleRequest(side, 'received')];
    state.parameters[0].multiEntry = true;
    state.results[0].sampleRoundId = 'round-' + side;
    state.results[0].entries = [{ ค่า: 20 }, { ค่า: 30 }];
    render(<Page />);
    const removeButtons = await screen.findAllByRole('button', { name: 'ลบรายการ' });
    fireEvent.click(removeButtons[0]);
    await waitFor(() => expect(api.saveQCEntries).toHaveBeenCalledWith(expect.objectContaining({ sampleRoundId: 'round-' + side, entries: [{ ค่า: 30 }] })));
    expect(api.completePetitionTrack).not.toHaveBeenCalled();
  });
});
