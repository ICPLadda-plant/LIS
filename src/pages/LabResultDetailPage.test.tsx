import type { ReactNode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import LabResultDetailPage from './LabResultDetailPage';
import type { ParameterItem } from '@/lib/api';
import type { Petition } from '@/types/petition.types';

const basePetition = (): Petition => ({
  _id: 'petition-1',
  petitionNo: 'P-2607-001',
  dept: 'production',
  status: 'success',
  submittedBy: { name: 'Requester', submittedAt: '2026-07-13T01:00:00.000Z' },
  items: [{ seq: 1, sampleName: 'Sample A', commonName: 'ABAMECTIN 1.8% W/V EC', batchNo: 'BATCH-001', sampleId: 'sample-1' }],
  labApprovedAt: '2026-07-14T00:00:00.000Z',
  createdAt: '2026-07-13T01:00:00.000Z',
  updatedAt: '2026-07-13T01:00:00.000Z',
});

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  petition: {} as Petition,
  labRequests: [] as Array<{ _id: string }>,
  getParameters: vi.fn<() => Promise<ParameterItem[]>>(),
  getQCResults: vi.fn(),
  buildApprovalGroups: vi.fn(),
  buildLabResultReportPages: vi.fn(),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mocks.navigate,
  };
});

vi.mock('@/components/lis/AppLayout', () => ({
  default: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));

vi.mock('@/components/lis/PageHeader', () => ({
  default: ({ title, actions }: { title: ReactNode; actions?: ReactNode }) => (
    <header>
      <h1>{title}</h1>
      {actions}
    </header>
  ),
}));

vi.mock('@/components/lis/PrintPreviewDialog', () => ({
  default: ({ children }: { children: ReactNode }) => <div data-testid="print-preview">{children}</div>,
}));

vi.mock('@/components/petition/LabResultReportTemplate', () => ({
  default: () => <div data-testid="lab-result-report" />,
  LAB_REPORT_CSS: '',
}));

vi.mock('@/components/petition/LabResultGroups', () => ({
  default: () => <div data-testid="lab-result-groups" />,
}));

vi.mock('@/hooks/usePetition', () => ({
  usePetition: () => ({ data: mocks.petition, loading: false, error: null }),
  useLabRequestsByPetition: () => ({ data: mocks.labRequests, loading: false, error: null }),
}));

vi.mock('@/hooks/useItemGroupMembership', () => ({
  useItemGroupMembership: () => new Map(),
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { role: 'viewer' } }),
}));

vi.mock('@/lib/api', () => ({
  api: {
    getParameters: mocks.getParameters,
    getQCResults: mocks.getQCResults,
  },
}));

vi.mock('@/lib/qcApprovalRows', () => ({
  buildApprovalGroups: (...args: unknown[]) => mocks.buildApprovalGroups(...args),
}));

vi.mock('@/lib/labResultReport', () => ({
  buildLabResultReportPages: (...args: unknown[]) => mocks.buildLabResultReportPages(...args),
}));

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/lab-results/petition-1']} future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
      <Routes>
        <Route path="/lab-results/:id" element={<LabResultDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.petition = basePetition();
  mocks.labRequests = [{ _id: 'lab-request-1' }];
  mocks.getParameters.mockReturnValue(new Promise<ParameterItem[]>(() => {}));
  mocks.getQCResults.mockReturnValue(new Promise(() => {}));
  mocks.buildApprovalGroups.mockReturnValue([]);
  mocks.buildLabResultReportPages.mockReturnValue([{ reportNo: 'LR-1' }]);
});

describe('LabResultDetailPage print action', () => {
  it('disables the print lab-result button when QC has not confirmed Final Result', () => {
    renderPage();

    expect(screen.getByRole('button', { name: /พิมพ์ผลวิเคราะห์ Lab/ })).toBeDisabled();
  });

  it('enables the print lab-result button when QC has confirmed Final Result', () => {
    Object.assign(mocks.petition, {
      status: 'approved',
      approvedAt: '2026-07-15T00:00:00.000Z',
    });

    renderPage();

    expect(screen.getByRole('button', { name: /พิมพ์ผลวิเคราะห์ Lab/ })).toBeEnabled();
  });

  it('passes physical parameter to report pages but keeps lab result groups lab-only', async () => {
    const parameters = [
      { _id: 'lab-1', name: 'สารสำคัญ', scope: 'lab' },
      { _id: 'qc-1', name: 'ค่า ถพ.', scope: 'qc' },
      { _id: 'physical-1', name: 'กายภาพ', scope: 'qc' },
    ] as ParameterItem[];
    mocks.getParameters.mockResolvedValue(parameters);
    mocks.getQCResults.mockResolvedValue([]);

    renderPage();

    await waitFor(() => {
      const reportInput = mocks.buildLabResultReportPages.mock.calls.at(-1)?.[0] as { parameters: ParameterItem[] };
      expect(reportInput.parameters.map((parameter) => parameter._id)).toEqual(['lab-1', 'physical-1']);
    });
    const groupParameters = mocks.buildApprovalGroups.mock.calls.at(-1)?.[1] as ParameterItem[];
    expect(groupParameters.map((parameter) => parameter._id)).toEqual(['lab-1']);
    expect(mocks.buildApprovalGroups.mock.calls.at(-1)?.[4]).toMatchObject({ includeResultOnlyFields: true });
  });
});
