import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { MachineItem } from '@/lib/api';
import type { Petition, PetitionAuditLogEntry } from '@/types/petition.types';
import type { SixMonthMedicineStockItem } from '@/types/stock';
import PetitionListPage from './PetitionListPage';
import PetitionAssignPage from './PetitionAssignPage';
import PetitionAuditLogPage from './PetitionAuditLogPage';
import LabTestingPage from './LabTestingPage';
import QCTestingPage from './QCTestingPage';
import LabResults from './LabResults';
import AnalysisResults from './AnalysisResults';

const mocks = vi.hoisted(() => ({
  items: [] as Petition[],
  logs: [] as PetitionAuditLogEntry[],
  stock: [] as SixMonthMedicineStockItem[],
  machines: [] as MachineItem[],
  user: { employeeId: 'E1', name: 'Reviewer', roles: ['admin'] },
  groups: new Map<string, string[]>(),
  refresh: vi.fn(),
  push: vi.fn(),
}));

vi.mock('@/components/lis/AppLayout', () => ({
  default: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock('@/hooks/useCanAccessPath', () => ({ useCanAccessPath: () => () => true }));
vi.mock('@/hooks/useArrivalFlash', () => ({ useArrivalFlashId: () => null }));
vi.mock('@/hooks/useItemGroupMembership', () => ({ useItemGroupMembership: () => mocks.groups }));
vi.mock('@/context/NotificationContext', () => ({ useNotifications: () => ({ push: mocks.push }) }));
vi.mock('@/lib/aiApi', () => ({ getMachineSuggestions: async () => [] }));
vi.mock('@/components/petition/QrReceiveModal', () => ({ default: () => null }));
vi.mock('@/components/petition/LabScanAcceptModal', () => ({
  default: ({ open }: { open: boolean }) => open ? <div role="dialog">รับตัวอย่าง Lab</div> : null,
}));
vi.mock('@/hooks/usePetition', () => ({
  usePetitionList: (params: { status?: string }) => {
    const items = mocks.items.filter((petition) => !params.status || params.status.split(',').includes(petition.status));
    return { data: { items, total: items.length }, loading: false, error: null, refresh: mocks.refresh };
  },
  usePetitionAuditLogList: () => ({
    data: { items: mocks.logs, total: 60 }, loading: false, error: null, refresh: mocks.refresh,
  }),
}));
vi.mock('@/lib/api', () => ({
  api: {
    getParameters: async () => [{ _id: 'lab', name: 'Lab test', scope: 'lab', applyAll: true, valueFields: [] }],
    getAbnormalFlags: async () => ({}),
    getReturnedFlags: async () => ({}),
    getMachines: async () => mocks.machines,
    getMethods: async () => [{ code: 'GC', label: 'GC', requiresMachine: true, machinePrefix: 'GC', active: true }],
    get: async (path: string) => ({ data: { data:
      path === '/employees/assignees' ? [{ employeeId: 'E2', name: 'Test Analyst', department: 'Lab' }]
        : path === '/master-items' ? [{ item_no: 'R100', commonName: 'Compound' }]
          : path === '/simple-methods' ? [{ itemNo: 'R100', methods: [['GC']] }] : [],
    } }),
    getSixMonthMedicineStock: async () => ({ items: mocks.stock, serverTime: '2026-09-19T00:00:00.000Z' }),
  },
}));

function petition(petitionNo: string, itemNo?: string, overrides: Partial<Petition> = {}): Petition {
  return {
    _id: petitionNo,
    petitionNo,
    dept: 'rm',
    status: 'inProgress',
    submittedBy: { employeeId: 'E1', name: 'R100', submittedAt: '2026-09-19T00:00:00.000Z' },
    items: [{ seq: 1, itemNo, sampleName: 'Sample', batchNo: 'Batch', sendToLab: true }],
    createdAt: '2026-09-19T00:00:00.000Z',
    updatedAt: '2026-09-19T00:00:00.000Z',
    ...overrides,
  };
}

function renderPage(component: ReactNode, entry = '/') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[entry]}>
        <TooltipProvider>{component}</TooltipProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function petitionOrder() {
  return screen.queryAllByText(/^ROW-/).map((element) => element.textContent);
}

beforeEach(() => {
  mocks.user = { employeeId: 'E1', name: 'Reviewer', roles: ['admin'] };
  mocks.logs = [];
  mocks.stock = [];
  mocks.machines = [];
  mocks.items = [
    petition('ROW-name', 'OTHER'),
    petition('ROW-prefix-first', 'R100-Z'),
    petition('ROW-substring-far', 'XXR100'),
    petition('ROW-substring-near', 'XR100'),
    petition('ROW-exact', 'R100'),
    petition('ROW-prefix-second', 'R100-A'),
  ];
});
afterEach(cleanup);

describe('petition search ranking', () => {
  it('moves the Lab sample receive action to the assignment board', () => {
    renderPage(<PetitionAssignPage />);

    fireEvent.click(screen.getByRole('button', { name: 'รับตัวอย่าง' }));

    expect(screen.getByRole('dialog')).toHaveTextContent('รับตัวอย่าง Lab');
  });

  it('does not show the sample receive action on the Lab testing queue', async () => {
    renderPage(<LabTestingPage />);

    await screen.findByText('ROW-exact');
    expect(screen.queryByRole('button', { name: 'รับตัวอย่าง' })).not.toBeInTheDocument();
  });

  it.each([
    ['assignment board', <PetitionAssignPage />, '/'],
    ['Lab results', <LabResults />, '/'],
    ['analysis results', <AnalysisResults />, '/'],
  ] as const)('%s ranks codes without changing matching or equal-score order', async (label, component, entry) => {
    if (label === 'analysis results') mocks.items = mocks.items.map((item) => ({ ...item, status: 'approved' }));
    renderPage(component, entry);
    await screen.findByText('ROW-exact');
    fireEvent.change(screen.getAllByPlaceholderText(/ค้นหาเลข/)[0], { target: { value: '  r100  ' } });
    await waitFor(() => expect(petitionOrder()).toEqual([
      'ROW-exact', 'ROW-prefix-first', 'ROW-prefix-second', 'ROW-substring-near', 'ROW-substring-far', 'ROW-name',
    ]));
    fireEvent.change(screen.getAllByPlaceholderText(/ค้นหาเลข/)[0], { target: { value: '' } });
    await waitFor(() => expect(petitionOrder()).toEqual(mocks.items.map((item) => item.petitionNo)));
  });

  it.each([
    ['petition list', <PetitionListPage />, '/?search=R100'],
    ['Lab queue', <LabTestingPage />, '/'],
  ] as const)('%s preserves server search order instead of reranking a partial page', async (label, component, entry) => {
    renderPage(component, entry);
    await screen.findByText('ROW-exact');
    if (label !== 'petition list') {
      fireEvent.change(screen.getByPlaceholderText(/ค้นหาเลข/), { target: { value: 'R100' } });
    }
    await waitFor(() => expect(petitionOrder()).toEqual(mocks.items.map((item) => item.petitionNo)));
  });

  it('ranks QC product codes across both result sets, preserving empty order and visibility', async () => {
    const received = { status: 'deliveringQC' as const, qcReceivedAt: '2026-09-19T00:00:00.000Z' };
    mocks.items = [
      petition('ROW-active-name', 'OTHER'),
      petition('ROW-active-prefix', 'R100-Z'),
      petition('ROW-active-substring', 'XXR100'),
      petition('ROW-stale-exact', 'R100', received),
      petition('ROW-stale-prefix', 'R100-A', received),
      petition('ROW-stale-substring', 'XR100', received),
      petition('ROW-unreceived', 'R100', { status: 'deliveringQC' }),
    ];
    renderPage(<QCTestingPage />);
    const defaultOrder = mocks.items.slice(0, 6).map((item) => item.petitionNo);
    expect(petitionOrder()).toEqual(defaultOrder);
    fireEvent.change(screen.getByPlaceholderText(/ค้นหาเลข/), { target: { value: '  r100  ' } });
    await waitFor(() => expect(petitionOrder()).toEqual([
      'ROW-stale-exact', 'ROW-active-prefix', 'ROW-stale-prefix',
      'ROW-stale-substring', 'ROW-active-substring', 'ROW-active-name',
    ]));
    expect(screen.queryByText('ROW-unreceived')).not.toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText(/ค้นหาเลข/), { target: { value: '' } });
    expect(petitionOrder()).toEqual(defaultOrder);
    fireEvent.change(screen.getByPlaceholderText(/ค้นหาเลข/), { target: { value: '   ' } });
    expect(petitionOrder()).toEqual(defaultOrder);
  });

  it('ranks QC petition identifiers across both result sets when product codes are absent', () => {
    mocks.items = [petition('ROW-name'), petition('ROW-100-Z'), petition('ROW-100'), petition('ROW-100-A')]
      .map((item, index) => ({
        ...item,
        status: index < 2 ? 'inProgress' as const : 'deliveringQC' as const,
        qcReceivedAt: '2026-09-19T00:00:00.000Z',
        submittedBy: { ...item.submittedBy, name: 'ROW-100' },
      }));
    renderPage(<QCTestingPage />);
    fireEvent.change(screen.getByPlaceholderText(/ค้นหาเลข/), { target: { value: 'ROW-100' } });
    expect(petitionOrder()).toEqual(['ROW-100', 'ROW-100-Z', 'ROW-100-A', 'ROW-name']);
  });

  it('preserves server ranking through visibility filtering and client pagination', async () => {
    mocks.user.roles = ['viewer'];
    mocks.user.name = 'R100';
    mocks.items = Array.from({ length: 22 }, (_, index) => petition('ROW-prefix-' + index, 'R100-Z'));
    mocks.items.unshift(petition('ROW-exact', 'R100'));
    mocks.items.unshift(petition('ROW-forbidden', 'R100', {
      submittedBy: { employeeId: 'OTHER', name: 'Other', submittedAt: '2026-09-19T00:00:00.000Z' },
    }));
    renderPage(<PetitionListPage />, '/?search=R100');
    await waitFor(() => expect(petitionOrder()[0]).toBe('ROW-exact'));
    expect(petitionOrder()).toHaveLength(20);
    expect(screen.queryByText('ROW-forbidden')).not.toBeInTheDocument();
  });

  it.each([<LabResults />, <AnalysisResults />])('uses petition numbers when codes are missing and keeps name matching', async (component) => {
    mocks.items = [petition('ROW-name'), petition('ROW-P100-prefix'), petition('ROW-P100')]
      .map((item) => ({ ...item, status: 'approved' as const, submittedBy: { ...item.submittedBy, name: 'ROW-P100' } }));
    mocks.items.push(petition('ROW-unmatched', undefined, {
      status: 'approved', submittedBy: { name: 'Unrelated', submittedAt: '2026-09-19T00:00:00.000Z' },
    }));
    renderPage(component);
    fireEvent.change(screen.getByPlaceholderText(/ค้นหาเลข/), { target: { value: 'ROW-P100' } });
    const rows = screen.getAllByRole('row').slice(1);
    expect(rows.map((row) => row.querySelector('td')?.textContent)).toEqual(['ROW-P100', 'ROW-P100-prefix', 'ROW-name']);
  });

  it('preserves server audit search order and pagination', () => {
    mocks.logs = ['ROW-name', 'ROW-100-prefix', 'ROW-100'].map((petitionNo) => ({
      _id: petitionNo, petitionId: petitionNo, petitionNo, event: 'updated',
      actor: 'ROW-100', note: 'ROW-100', createdAt: '2026-09-19T00:00:00.000Z',
    }));
    renderPage(<PetitionAuditLogPage />, '/?search=ROW-100&page=2');
    const rows = screen.getAllByRole('row').slice(1);
    expect(rows.map((row) => row.querySelectorAll('td')[1]?.textContent)).toEqual(mocks.logs.map((entry) => entry.petitionNo));
    expect(screen.getByText(/หน้า 2/)).toBeInTheDocument();
  });

  it('ranks using every product code but does not expand local result matching', () => {
    mocks.items = [petition('ROW-name', 'OTHER'), petition('ROW-multiple', 'OTHER')];
    mocks.items[1].items.push({ seq: 2, itemNo: 'R100', sampleName: 'Second sample', batchNo: 'Batch' });
    mocks.items.push(petition('ROW-code-only', 'R100', {
      submittedBy: { name: 'Unrelated', submittedAt: '2026-09-19T00:00:00.000Z' },
    }));
    renderPage(<LabResults />);
    fireEvent.change(screen.getByPlaceholderText(/ค้นหาเลข/), { target: { value: 'R100' } });
    expect(petitionOrder()).toEqual(['ROW-multiple', 'ROW-name']);
  });

  it('keeps analysis conclusion filtering before ranking', () => {
    mocks.items = [
      petition('ROW-name', 'OTHER', { status: 'approved' }),
      petition('ROW-prefix', 'R100-Z', { status: 'approved' }),
      petition('ROW-rejected', 'R100', { status: 'rejected' }),
    ];
    renderPage(<AnalysisResults />);
    fireEvent.change(screen.getByPlaceholderText(/ค้นหาเลข/), { target: { value: 'R100' } });
    fireEvent.click(screen.getByRole('button', { name: /^ผ่าน$/ }));
    expect(petitionOrder()).toEqual(['ROW-prefix', 'ROW-name']);
  });

  it('ranks six-month stock codes before common names and lots, preserving kind filtering', async () => {
    mocks.user.roles = ['qc-head'];
    mocks.items = [];
    mocks.stock = ['F-other', 'R100-Z', 'XXR100', 'XR100', 'R100', 'R100-A'].map((itemNo, index) => ({
      itemNo, commonName: 'R100', lotNo: 'LOT-' + index, companySource: 'TEST', locationCode: 'Warehouse',
      binCode: 'Shelf', registeringDate: '2025-01-01', unit: 'kg', stockQty: 1, stockQtyBase: 1, ageMonths: 20,
    }));
    renderPage(<PetitionListPage />);
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'List ยา 6 เดือน' }), { button: 0, ctrlKey: false });
    await screen.findByText('F-other');
    fireEvent.change(screen.getByPlaceholderText('ค้นหา item / lot / commonname'), { target: { value: 'R100' } });
    const stockOrder = () => screen.getAllByRole('row').slice(1)
      .map((row) => row.querySelector('td')?.textContent);
    expect(stockOrder()).toEqual(['R100', 'R100-Z', 'R100-A', 'XR100', 'XXR100', 'F-other']);
    fireEvent.click(screen.getByRole('combobox', { name: 'ประเภทสินค้า' }));
    fireEvent.click(await screen.findByRole('option', { name: 'RM' }));
    expect(stockOrder()).toEqual(['R100', 'R100-Z', 'R100-A']);
    fireEvent.change(screen.getByPlaceholderText('ค้นหา item / lot / commonname'), { target: { value: '' } });
    expect(stockOrder()).toEqual(['R100-Z', 'R100', 'R100-A']);
  });

  it('ranks machine codes without admitting retired or incompatible machines', async () => {
    mocks.items = [petition('ROW-picker', 'R100')];
    mocks.items[0].items[0].commonName = 'Compound';
    mocks.machines = ['OTHER', 'GC100-Z', 'XXGC100', 'XGC100', 'GC100', 'GC100-A'].map((code) => ({
      code, name: 'GC analyzer', location: 'GC100',
    }));
    mocks.machines.push(
      { code: 'GC100-retired', name: 'GC analyzer', status: 'retired' },
      { code: 'GC100-incompatible', name: 'HPLC analyzer' },
    );
    renderPage(<PetitionAssignPage />);
    const card = (await screen.findByText('ROW-picker')).closest('[draggable]');
    const employee = (await screen.findByText('Test Analyst')).parentElement?.parentElement?.parentElement;
    expect(card).not.toBeNull();
    expect(employee).toBeTruthy();
    fireEvent.dragStart(card!, { dataTransfer: { setData: vi.fn() } });
    fireEvent.drop(employee!);
    fireEvent.click(await screen.findByRole('button', { name: /เลือกเครื่อง/ }));
    fireEvent.change(screen.getByPlaceholderText('ค้นหาเครื่อง (รหัส/ชื่อ/ตำแหน่ง)'), { target: { value: 'GC100' } });
    const machineOrder = () => screen.getAllByRole('button', { name: / - GC analyzer/ })
      .map((button) => button.querySelector('.font-medium')?.textContent?.split(' - ')[0]);
    expect(machineOrder()).toEqual(['GC100', 'GC100-Z', 'GC100-A', 'XGC100', 'XXGC100', 'OTHER']);
    fireEvent.change(screen.getByPlaceholderText('ค้นหาเครื่อง (รหัส/ชื่อ/ตำแหน่ง)'), { target: { value: '' } });
    expect(machineOrder()).toEqual(['OTHER', 'GC100-Z', 'XXGC100', 'XGC100', 'GC100', 'GC100-A']);
  });
});
