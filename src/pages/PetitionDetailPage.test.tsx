import type { ReactNode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import PetitionDetailPage from './PetitionDetailPage';
import type { Petition } from '@/types/petition.types';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  refresh: vi.fn(),
  petition: {
    _id: 'petition-1',
    petitionNo: 'P-2507-0001',
    dept: 'production',
    status: 'inProgress',
    submittedBy: {
      employeeId: 'E001',
      name: 'สมชาย ทดสอบ',
      department: 'ฝ่าย QA',
      submittedAt: '2026-07-13T02:00:00.000Z',
    },
    deliveredBy: {
      employeeId: 'E002',
      name: 'มาลี นำส่ง',
    },
    assignedTo: {
      employeeId: 'E003',
      name: 'หัวหน้า QC',
    },
    items: [
      {
        seq: 1,
        sampleName: 'ตัวอย่าง A',
        commonName: 'สารตัวอย่าง',
        batchNo: 'BATCH-001',
      },
    ],
    sampleSentAt: '2026-07-13T03:00:00.000Z',
    reviewHistory: [],
    createdAt: '2026-07-13T01:30:00.000Z',
    updatedAt: '2026-07-13T01:30:00.000Z',
  } as Petition,
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
  default: ({
    title,
    actions,
    onBack,
  }: {
    title: ReactNode;
    actions?: ReactNode;
    onBack?: () => void;
  }) => (
    <header>
      {onBack && <button type="button">กลับ</button>}
      <h1>{title}</h1>
      {actions}
    </header>
  ),
}));

vi.mock('@/components/lis/PetitionStatusTimeline', () => ({
  default: () => <div data-testid="status-timeline" />,
}));

vi.mock('@/components/petition/DevStatusStepper', () => ({
  DevStatusStepper: () => <div data-testid="dev-status-stepper" />,
}));

vi.mock('@/components/lis/PrintPreviewDialog', () => ({
  default: () => null,
}));

vi.mock('@/components/lis/StickyActionBar', () => ({
  default: () => null,
}));

vi.mock('@/hooks/usePetition', () => ({
  usePetition: () => ({
    data: mocks.petition,
    loading: false,
    error: null,
    refresh: mocks.refresh,
  }),
  deletePetition: vi.fn(),
  useLabRequestsByPetition: () => ({ data: [] }),
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { name: 'ผู้ใช้งาน', email: 'user@example.test', roles: ['viewer'] } }),
}));

vi.mock('@/context/SampleContext', () => ({
  useSamples: () => ({ refetch: vi.fn() }),
}));

vi.mock('@/hooks/useItemGroupMembership', () => ({
  useItemGroupMembership: () => new Map(),
}));

vi.mock('@/lib/api', () => ({
  api: {
    getParameters: vi.fn(() => new Promise<never>(() => {})),
    getQCResults: vi.fn(() => new Promise<never>(() => {})),
  },
}));

vi.mock('@/lib/qcApprovalRows', () => ({
  buildApprovalGroups: () => [],
}));

vi.mock('@/lib/laLisAssistant', () => ({
  buildLaLisAssistant: () => null,
}));

vi.mock('@/lib/petitionPrintability', () => ({
  canPrintPreReport: () => false,
  canPrintSampleLabel: () => false,
  canPrintLabResult: (petition: { status?: string; labApprovedAt?: string; labCompletedAt?: string }) =>
    petition?.status === 'approved' && !!(petition?.labApprovedAt || petition?.labCompletedAt),
}));

vi.mock('@/lib/labResultReport', () => ({
  buildLabResultReportPages: () => [{ reportNo: 'LR-1' }],
}));

function renderPage() {
  return render(
    <MemoryRouter
      initialEntries={['/petitions/petition-1']}
      future={{ v7_relativeSplatPath: true, v7_startTransition: true }}
    >
      <Routes>
        <Route path="/petitions/:id" element={<PetitionDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(mocks.petition, {
    status: 'inProgress',
    labCompletedAt: undefined,
    labApprovedAt: undefined,
    approvedAt: undefined,
  });
});

describe('PetitionDetailPage request summary', () => {
  it('consolidates request metadata into the top summary and does not repeat the request-info card', () => {
    renderPage();

    expect(screen.queryByRole('heading', { name: 'ข้อมูลคำขอ' })).not.toBeInTheDocument();
    expect(screen.getByText('แผนกผู้ยื่น')).toBeInTheDocument();
    expect(screen.getAllByText('ฝ่าย QA').length).toBeGreaterThan(0);
    expect(screen.getByText('ผู้นำส่ง')).toBeInTheDocument();
    expect(screen.getByText('มาลี นำส่ง')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'รายการตัวอย่าง (1)' })).toBeInTheDocument();
  });

  it('hides the print lab-result action when QC has not confirmed Final Result', () => {
    Object.assign(mocks.petition, {
      status: 'success',
      labApprovedAt: '2026-07-14T00:00:00.000Z',
    });

    renderPage();

    expect(screen.queryByRole('button', { name: /พิมพ์ผลวิเคราะห์ Lab/ })).not.toBeInTheDocument();
  });

  it('shows the print lab-result action when Lab has issued results and QC has confirmed Final Result', async () => {
    Object.assign(mocks.petition, {
      status: 'approved',
      approvedAt: '2026-07-15T00:00:00.000Z',
      labApprovedAt: '2026-07-14T00:00:00.000Z',
    });

    renderPage();

    await waitFor(() => expect(screen.getByRole('button', { name: /พิมพ์ผลวิเคราะห์ Lab/ })).toBeInTheDocument());
  });
});
