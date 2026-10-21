import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PetitionListPage from './PetitionListPage';
import type { Petition } from '@/types/petition.types';

const mocks = vi.hoisted(() => {
  const petition = (
    id: string,
    status: Petition['status'],
    overrides: Partial<Petition> = {},
  ): Petition => ({
    _id: id,
    petitionNo: id,
    dept: 'production',
    status,
    submittedBy: {
      employeeId: 'E001',
      name: 'ผู้ทดสอบ',
      submittedAt: '2026-07-13T01:00:00.000Z',
    },
    items: [
      {
        seq: 1,
        sampleName: `ตัวอย่าง ${id}`,
        batchNo: 'BATCH-002',
      },
    ],
    reviewHistory: [],
    createdAt: '2026-07-13T01:00:00.000Z',
    updatedAt: '2026-07-13T01:00:00.000Z',
    ...overrides,
  });

  const petitions = [
    petition('P-2607-0001', 'success'),
    petition('P-2607-0002', 'inProgress'),
    petition('P-2607-0003', 'rejected'),
    petition('P-2607-0004', 'sampleSent'),
    petition('P-2607-0005', 'pendingReview', {
      assignedTo: { employeeId: 'E002', name: 'ผู้รับงาน' },
    }),
    petition('P-2607-0006', 'deliveringQC'),
    petition('P-2607-0007', 'approved'),
  ];

  const fgQualityAlerts = [
    petition('P-FG-QC-0001', 'deliveringQC', {
      dept: 'fg',
      submittedBy: {
        employeeId: 'E890',
        name: 'FG Requester',
        submittedAt: '2026-09-10T02:30:00.000Z',
      },
      items: [
        {
          seq: 1,
          sampleName: 'FG Product A',
          batchNo: 'FG260910-001',
          lotNo: 'LOT-FG-001',
        },
      ],
    }),
  ];

  const masterItems = [
    {
      item_no: 'F-TEST-001',
      item_name1: 'ยาทดสอบ FG',
      commonname: 'อะบาเมกติน 1.8% EC',
    },
    {
      item_no: 'R-TEST-002',
      item_name1: 'ยาทดสอบ RM',
      commonname: 'แมนโคเซบ 80% WP',
    },
  ];

  return {
    canAccess: vi.fn(() => true),
    makePetition: petition,
    get: vi.fn((path: string) => {
      if (path === '/master-items') {
        return Promise.resolve({ data: { data: masterItems } });
      }
      return Promise.reject(new Error(`Unexpected GET ${path}`));
    }),
    getSixMonthMedicineStock: vi.fn().mockResolvedValue({
      serverTime: '2026-09-04T00:00:00.000Z',
      referenceMonth: '2026-09',
      items: [
        {
          companySource: 'ICPL',
          commonName: '',
          itemName: 'ยาทดสอบ FG',
          itemNo: 'F-TEST-001',
          locationCode: 'NORMAL',
          binCode: 'DEFAULT',
          lotNo: 'FG260301-001',
          registeringDate: '2026-03-31T00:00:00.000Z',
          unit: 'KG',
          stockQty: 10,
          stockQtyBase: 10,
          ageMonths: 7,
        },
        {
          companySource: 'ICPL',
          commonName: '',
          itemName: 'ยาทดสอบ RM',
          itemNo: 'R-TEST-002',
          locationCode: 'NORMAL',
          binCode: 'DEFAULT',
          lotNo: 'RM260201-002',
          registeringDate: '2026-02-28T00:00:00.000Z',
          unit: 'KG',
          stockQty: 5,
          stockQtyBase: 5,
          ageMonths: 7,
        },
      ],
    }),
    getParameters: vi.fn().mockResolvedValue([]),
    createPetition: vi.fn(async (payload: Partial<Petition>) => {
      const created = petition('P-FG-QC-0002', 'deliveringQC', {
        _id: 'P-FG-QC-0002',
        dept: 'fg',
        submittedBy: {
          employeeId: payload.submittedBy?.employeeId,
          name: payload.submittedBy?.name || 'Admin',
          department: payload.submittedBy?.department,
          submittedAt: '2026-09-17T00:00:00.000Z',
        },
        items: payload.items ?? [],
      });
      fgQualityAlerts.push(created);
      return created;
    }),
    petitions,
    fgQualityAlerts,
    push: vi.fn(),
    refresh: vi.fn(),
    user: {
      employeeId: 'E999',
      email: 'admin@example.test',
      name: 'Admin',
      roles: ['admin'],
    },
  };
});

vi.mock('@/components/lis/AppLayout', () => ({
  default: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: mocks.user }),
}));

vi.mock('@/hooks/useCanAccessPath', () => ({
  useCanAccessPath: () => mocks.canAccess,
}));

vi.mock('@/hooks/useItemGroupMembership', () => ({
  useItemGroupMembership: () => new Map(),
}));

vi.mock('@/hooks/usePetition', () => ({
  createPetition: mocks.createPetition,
  usePetitionList: (params: { status?: string; search?: string; dept?: string }) => {
    const search = params.search?.trim().toLowerCase();
    const source = params.dept === 'fg'
      ? mocks.fgQualityAlerts
      : mocks.petitions;
    const items = source
      .filter((petition) => (params.dept ? petition.dept === params.dept : true))
      .filter((petition) =>
        params.status ? params.status.split(',').includes(petition.status) : true,
      )
      .filter((petition) => {
        if (!search) return true;
        return [
          petition.petitionNo,
          petition.submittedBy?.name,
          ...petition.items.map((item) => item.sampleName),
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(search);
      });
    return {
      data: { items, total: items.length },
      loading: false,
      error: null,
      refresh: mocks.refresh,
    };
  },
}));

vi.mock('@/context/NotificationContext', () => ({
  useNotifications: () => ({ push: mocks.push }),
}));

vi.mock('@/lib/api', () => ({
  api: {
    get: mocks.get,
    getSixMonthMedicineStock: mocks.getSixMonthMedicineStock,
    getParameters: mocks.getParameters,
  },
}));

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}{location.search}</output>;
}

function renderPage(props: React.ComponentProps<typeof PetitionListPage> = {}, initialEntry = '/petitions') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter
        initialEntries={[initialEntry]}
        future={{ v7_relativeSplatPath: true, v7_startTransition: true }}
      >
        <PetitionListPage {...props} />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const defaultMatchMedia = window.matchMedia;

function setTouchViewport(matches: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })),
  });
}

describe('PetitionListPage action cues', () => {
  beforeEach(() => {
    mocks.canAccess.mockClear();
    mocks.canAccess.mockImplementation(() => true);
    mocks.get.mockClear();
    mocks.createPetition.mockClear();
    mocks.getSixMonthMedicineStock.mockClear();
    mocks.fgQualityAlerts.splice(1);
    mocks.user = {
      employeeId: 'E999',
      email: 'admin@example.test',
      name: 'Admin',
      roles: ['admin'],
    };
    setTouchViewport(false);
  });

  afterEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: defaultMatchMedia,
    });
  });

  it('does not show the per-card action labels on the petitions list', async () => {
    renderPage();

    expect(await screen.findByText('P-2607-0001')).toBeInTheDocument();

    for (const label of [
      'ดูสรุปผล',
      'ดูความคืบหน้า',
      'ดูเหตุผล',
      'Assign ผู้รับงาน',
      'ดูผู้รับงาน',
      'ดูรายละเอียด',
    ]) {
      expect(screen.queryByText(label)).not.toBeInTheDocument();
    }
  });

  it('does not show the next-step helper box on petition cards', async () => {
    renderPage();

    expect(await screen.findByText('P-2607-0006')).toBeInTheDocument();
    expect(screen.queryByText(/สิ่งที่ต้องทำ:/)).not.toBeInTheDocument();
  });

  it('uses a configured destination when a petition row is opened', async () => {
    renderPage({ petitionDetailPath: (petition) => `/petition/${petition._id}` });

    fireEvent.click(await screen.findByText('P-2607-0001'));

    expect(screen.getByTestId('location')).toHaveTextContent('/petition/P-2607-0001');
  });

  it('shows common names instead of product names on petition cards', async () => {
    const originalPetitions = mocks.petitions;
    mocks.petitions = [
      {
        ...mocks.petitions[0],
        _id: 'P-COMMON-NAME',
        petitionNo: 'P-COMMON-NAME',
        items: [
          {
            seq: 1,
            sampleName: 'พินิก้า',
            commonName: 'อะบาเมกติน 1.8% W/V EC',
            batchNo: 'BATCH-002',
          },
        ],
      },
    ];

    try {
      renderPage();

      expect(await screen.findByText('อะบาเมกติน 1.8% W/V EC')).toBeInTheDocument();
      expect(screen.queryByText('พินิก้า')).not.toBeInTheDocument();
    } finally {
      mocks.petitions = originalPetitions;
    }
  });

  it('shows the new petition button for viewer users who can open the canonical form', async () => {
    mocks.user = {
      employeeId: 'E777',
      email: 'viewer@example.test',
      name: 'Viewer',
      roles: ['viewer'],
    };
    mocks.canAccess.mockImplementation((path: string) => path === '/petitions/new');

    renderPage();

    const button = await screen.findByRole('button', { name: 'ยื่นคำร้องใหม่' });
    expect(button.querySelector('svg')).not.toBeNull();

    fireEvent.click(button);

    expect(mocks.canAccess).toHaveBeenCalledWith('/petitions/new');
    expect(screen.getByTestId('location')).toHaveTextContent('/petitions/new');
  });

  it('asks QC department users where to send before opening the new petition form', async () => {
    mocks.user = {
      employeeId: 'E778',
      email: 'qc@example.test',
      name: 'QC User',
      roles: ['viewer'],
      department: 'ควบคุมคุณภาพ',
    };
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'ยื่นคำร้องใหม่' }));
    expect(screen.getByRole('dialog', { name: 'เลือกประเภทการส่งตรวจ' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'ส่งทั้ง 2' }));

    expect(screen.getByTestId('location')).toHaveTextContent('/petitions/new?routeTargets=qc,lab');
  });

  it('shows approved petitions as completed instead of final-result wording', async () => {
    renderPage();

    expect(await screen.findByText('P-2607-0007')).toBeInTheDocument();
    expect(screen.getByText('เสร็จสิ้น')).toBeInTheDocument();
    expect(screen.queryByText('ออก Final Result แล้ว')).not.toBeInTheDocument();
  });

  it('shows completed approved petitions to QC head users', async () => {
    mocks.user = {
      employeeId: 'E888',
      email: 'qc-head@example.test',
      name: 'QC Head',
      roles: ['qc-head'],
    };

    renderPage({}, '/petitions?status=approved');

    expect(await screen.findByText('P-2607-0007')).toBeInTheDocument();
    expect(screen.queryByText('ยังไม่มีคำร้องที่คุณยื่นหรือได้รับมอบหมาย')).not.toBeInTheDocument();
  });

  it('keeps summary card counts based on all visible petitions when a status card filters the list', async () => {
    renderPage();

    expect(await screen.findByText('P-2607-0001')).toBeInTheDocument();

    const allCard = screen.getByText('ทั้งหมด').closest('[role="button"]');
    const waitingCard = screen.getByText(/รอตรวจ/).closest('[role="button"]');
    const inProgressCard = screen.getAllByText('กำลังดำเนินการ')[0].closest('[role="button"]');
    const rejectedCard = screen.getAllByText(/ส่งกลับ/)[0].closest('[role="button"]');

    expect(allCard).toHaveTextContent('7');
    expect(waitingCard).toHaveTextContent('1');
    expect(inProgressCard).toHaveTextContent('2');
    expect(rejectedCard).toHaveTextContent('1');

    fireEvent.click(screen.getByText(/รอตรวจ/));

    expect(await screen.findByText('P-2607-0004')).toBeInTheDocument();
    expect(screen.queryByText('P-2607-0001')).not.toBeInTheDocument();
    expect(allCard).toHaveTextContent('7');
    expect(waitingCard).toHaveTextContent('1');
    expect(inProgressCard).toHaveTextContent('2');
    expect(rejectedCard).toHaveTextContent('1');
  });

  it('shows six-month medicine stock rows from the stock API', async () => {
    mocks.user = {
      employeeId: 'E888',
      email: 'qc-head@example.test',
      name: 'QC Head',
      roles: ['qc-head'],
    };
    renderPage();

    expect(await screen.findByText('P-2607-0001')).toBeInTheDocument();

    const petitionsTab = screen.getByRole('tab', { name: 'รายการคำร้อง' });
    const sixMonthMedicineTab = screen.getByRole('tab', { name: 'List ยา 6 เดือน' });

    expect(petitionsTab).toHaveAttribute('aria-selected', 'true');
    expect(sixMonthMedicineTab).toHaveAttribute('aria-selected', 'false');

    fireEvent.mouseDown(sixMonthMedicineTab, { button: 0, ctrlKey: false });

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'List ยา 6 เดือน' })).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByText('F-TEST-001')).toBeInTheDocument();
      expect(screen.getByText('อะบาเมกติน 1.8% EC')).toBeInTheDocument();
      expect(screen.getByText('FG260301-001')).toBeInTheDocument();
      expect(screen.getByText('10 KG')).toBeInTheDocument();
      expect(screen.queryByRole('columnheader', { name: 'Location' })).not.toBeInTheDocument();
      expect(screen.queryByRole('columnheader', { name: 'Company' })).not.toBeInTheDocument();
      expect(screen.queryByText('P-2607-0001')).not.toBeInTheDocument();
    });
    expect(mocks.getSixMonthMedicineStock).toHaveBeenCalledTimes(1);
  });

  it('hides six-month stock lots already submitted for quality within six months', async () => {
    mocks.fgQualityAlerts.push(mocks.makePetition('P-FG-QC-0002', 'deliveringQC', {
      dept: 'fg',
      submittedBy: {
        employeeId: 'E890',
        name: 'FG Requester',
        submittedAt: '2026-08-15T00:00:00.000Z',
      },
      items: [
        {
          seq: 1,
          sampleName: 'ยาทดสอบ FG',
          batchNo: 'FG260301-001',
          lotNo: 'FG260301-001',
        },
      ],
    }));
    renderPage({}, '/petition');

    fireEvent.mouseDown(screen.getByRole('tab', { name: 'List ยา 6 เดือน' }), { button: 0, ctrlKey: false });

    expect(await screen.findByText('R-TEST-002')).toBeInTheDocument();
    expect(screen.queryByText('F-TEST-001')).not.toBeInTheDocument();
  });

  it('shows submitted six-month stock lots again after six months', async () => {
    mocks.getSixMonthMedicineStock.mockResolvedValueOnce({
      serverTime: '2027-03-16T00:00:00.000Z',
      referenceMonth: '2027-03',
      items: [
        {
          companySource: 'ICPL',
          commonName: '',
          itemName: 'ยาทดสอบ FG',
          itemNo: 'F-TEST-001',
          locationCode: 'NORMAL',
          binCode: 'DEFAULT',
          lotNo: 'FG260301-001',
          registeringDate: '2026-03-31T00:00:00.000Z',
          unit: 'KG',
          stockQty: 10,
          stockQtyBase: 10,
          ageMonths: 13,
        },
      ],
    });
    mocks.fgQualityAlerts.push(mocks.makePetition('P-FG-QC-0002', 'deliveringQC', {
      dept: 'fg',
      submittedBy: {
        employeeId: 'E890',
        name: 'FG Requester',
        submittedAt: '2026-09-15T00:00:00.000Z',
      },
      items: [
        {
          seq: 1,
          sampleName: 'ยาทดสอบ FG',
          batchNo: 'FG260301-001',
          lotNo: 'FG260301-001',
        },
      ],
    }));
    renderPage({}, '/petition');

    fireEvent.mouseDown(screen.getByRole('tab', { name: 'List ยา 6 เดือน' }), { button: 0, ctrlKey: false });

    expect(await screen.findByText('F-TEST-001')).toBeInTheDocument();
  });

  it('opens six-month medicine details in a side drawer', async () => {
    mocks.user = {
      employeeId: 'E888',
      email: 'qc-head@example.test',
      name: 'QC Head',
      roles: ['qc-head'],
    };
    renderPage();

    fireEvent.mouseDown(screen.getByRole('tab', { name: 'List ยา 6 เดือน' }), { button: 0, ctrlKey: false });
    fireEvent.click(await screen.findByText('F-TEST-001'));

    const drawer = await screen.findByRole('dialog', { name: 'F-TEST-001' });
    expect(within(drawer).getByText('ยาทดสอบ FG')).toBeInTheDocument();
    expect(within(drawer).getByText('อะบาเมกติน 1.8% EC')).toBeInTheDocument();
    expect(within(drawer).getByText('FG260301-001')).toBeInTheDocument();
    expect(within(drawer).getByText('NORMAL / DEFAULT')).toBeInTheDocument();
  });

  it('does not show the six-month medicine refresh button', async () => {
    mocks.user = {
      employeeId: 'E888',
      email: 'qc-head@example.test',
      name: 'QC Head',
      roles: ['qc-head'],
    };
    renderPage();

    fireEvent.mouseDown(screen.getByRole('tab', { name: 'List ยา 6 เดือน' }), { button: 0, ctrlKey: false });

    expect(await screen.findByText('F-TEST-001')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'รีเฟรช' })).not.toBeInTheDocument();
  });

  it('filters six-month medicine rows by RM and FG item prefixes', async () => {
    mocks.user = {
      employeeId: 'E888',
      email: 'qc-head@example.test',
      name: 'QC Head',
      roles: ['qc-head'],
    };
    renderPage();

    fireEvent.mouseDown(screen.getByRole('tab', { name: 'List ยา 6 เดือน' }), { button: 0, ctrlKey: false });

    expect(await screen.findByText('F-TEST-001')).toBeInTheDocument();
    expect(screen.getByText('R-TEST-002')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('combobox', { name: 'ประเภทสินค้า' }));
    fireEvent.click(await screen.findByRole('option', { name: 'RM' }));

    expect(screen.getByText('R-TEST-002')).toBeInTheDocument();
    expect(screen.queryByText('F-TEST-001')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('combobox', { name: 'ประเภทสินค้า' }));
    fireEvent.click(await screen.findByRole('option', { name: 'FG' }));

    expect(screen.getByText('F-TEST-001')).toBeInTheDocument();
    expect(screen.queryByText('R-TEST-002')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('combobox', { name: 'ประเภทสินค้า' }));
    fireEvent.click(await screen.findByRole('option', { name: 'ทั้งหมด' }));

    expect(screen.getByText('F-TEST-001')).toBeInTheDocument();
    expect(screen.getByText('R-TEST-002')).toBeInTheDocument();
  });

  it('refreshes six-month medicine stock after pulling down from the top on touch screens', async () => {
    setTouchViewport(true);
    mocks.user = {
      employeeId: 'E888',
      email: 'qc-head@example.test',
      name: 'QC Head',
      roles: ['qc-head'],
    };
    renderPage();

    fireEvent.mouseDown(screen.getByRole('tab', { name: 'List ยา 6 เดือน' }), { button: 0, ctrlKey: false });

    const stockItem = await screen.findByText('F-TEST-001');
    expect(mocks.getSixMonthMedicineStock).toHaveBeenCalledTimes(1);

    fireEvent.touchStart(stockItem, { touches: [{ clientY: 8 }] });
    fireEvent.touchMove(stockItem, { touches: [{ clientY: 96 }] });
    fireEvent.touchEnd(stockItem);

    await waitFor(() => {
      expect(mocks.getSixMonthMedicineStock).toHaveBeenCalledTimes(2);
    });
  });

  it('shows the six-month medicine tab for admin users', async () => {
    renderPage();

    expect(await screen.findByText('P-2607-0001')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'List ยา 6 เดือน' })).toBeInTheDocument();
  });

  it('shows FG quality inspection alerts as a sub-tab for admin users', async () => {
    renderPage({}, '/petition');

    fireEvent.mouseDown(screen.getByRole('tab', { name: 'List ยา 6 เดือน' }), { button: 0, ctrlKey: false });
    fireEvent.mouseDown(await screen.findByRole('tab', { name: 'แจ้งเตือนส่งตรวจคุณภาพ' }), { button: 0, ctrlKey: false });

    expect(await screen.findByText('P-FG-QC-0001')).toBeInTheDocument();
    expect(screen.getByText('FG Product A')).toBeInTheDocument();
    expect(screen.getByText('ส่งตรวจคุณภาพ')).toBeInTheDocument();
  });

  it.each(['FG260301-001', 'FG260301-002', 'FG260301-006'])('sends six-month FG stock to Lab for batch %s and switches to quality alerts', async (batchNo) => {
    const stock = await mocks.getSixMonthMedicineStock();
    mocks.getSixMonthMedicineStock.mockResolvedValueOnce({
      ...stock,
      items: stock.items.map((item) => item.itemNo === 'F-TEST-001' ? { ...item, lotNo: batchNo } : item),
    });
    renderPage({}, '/petition');

    fireEvent.mouseDown(screen.getByRole('tab', { name: 'List ยา 6 เดือน' }), { button: 0, ctrlKey: false });

    fireEvent.click(await screen.findByRole('checkbox', { name: `เลือก F-TEST-001 ${batchNo}` }));
    fireEvent.click(screen.getByRole('button', { name: 'ส่งตรวจคุณภาพ (1)' }));

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'แจ้งเตือนส่งตรวจคุณภาพ', selected: true })).toBeInTheDocument();
    });
    expect(await screen.findByText('P-FG-QC-0002')).toBeInTheDocument();
    expect(screen.getByText('ยาทดสอบ FG')).toBeInTheDocument();
    expect(mocks.createPetition).toHaveBeenCalledWith(expect.objectContaining({
      dept: 'fg',
      items: [expect.objectContaining({
        itemNo: 'F-TEST-001',
        sampleName: 'ยาทดสอบ FG',
        batchNo,
        sendToLab: true,
      })],
    }));
  });

  it('submits all visible six-month stock rows when select all is checked', async () => {
    renderPage({}, '/petition');

    fireEvent.mouseDown(screen.getByRole('tab', { name: 'List ยา 6 เดือน' }), { button: 0, ctrlKey: false });

    fireEvent.click(await screen.findByRole('checkbox', { name: 'เลือกทั้งหมดในรายการยาเกิน 6 เดือน' }));
    fireEvent.click(screen.getByRole('button', { name: 'ส่งตรวจคุณภาพ (2)' }));

    await waitFor(() => expect(mocks.createPetition).toHaveBeenCalledTimes(1));
    expect(mocks.createPetition).toHaveBeenCalledWith(expect.objectContaining({
      items: [
        expect.objectContaining({ itemNo: 'F-TEST-001', batchNo: 'FG260301-001', sendToLab: true }),
        expect.objectContaining({ itemNo: 'R-TEST-002', batchNo: 'RM260201-002', sendToLab: false }),
      ],
    }));
    expect(await screen.findByText('ยาทดสอบ FG +1 รายการ')).toBeInTheDocument();
  });

  it('shows FG quality inspection alerts before six-month medicine stock', async () => {
    renderPage({}, '/petition');

    fireEvent.mouseDown(screen.getByRole('tab', { name: 'List ยา 6 เดือน' }), { button: 0, ctrlKey: false });

    const tabLabels = (await screen.findAllByRole('tab')).map((tab) => tab.textContent);
    expect(tabLabels.indexOf('แจ้งเตือนส่งตรวจคุณภาพ')).toBeLessThan(
      tabLabels.indexOf('รายการยาเกิน 6 เดือน'),
    );
  });

  it('shows the six-month medicine tab for FG warehouse department users', async () => {
    mocks.user = {
      employeeId: 'E890',
      email: 'fg-warehouse@example.test',
      name: 'FG Warehouse',
      roles: ['viewer'],
      department: 'คลังสินค้า FG',
    };
    renderPage();

    expect(screen.getByRole('tab', { name: 'List ยา 6 เดือน' })).toBeInTheDocument();
  });

  it('shows FG quality inspection alerts as a sub-tab inside six-month medicine for FG warehouse users', async () => {
    mocks.user = {
      employeeId: 'E890',
      email: 'fg-warehouse@example.test',
      name: 'FG Warehouse',
      roles: ['viewer'],
      department: 'คลังสินค้า FG',
    };
    renderPage({}, '/petition');

    fireEvent.mouseDown(screen.getByRole('tab', { name: 'List ยา 6 เดือน' }), { button: 0, ctrlKey: false });
    fireEvent.mouseDown(await screen.findByRole('tab', { name: 'แจ้งเตือนส่งตรวจคุณภาพ' }), { button: 0, ctrlKey: false });

    expect(await screen.findByText('P-FG-QC-0001')).toBeInTheDocument();
    expect(screen.getByText('FG Product A')).toBeInTheDocument();
    expect(screen.getByText('FG260910-001 / LOT-FG-001')).toBeInTheDocument();
    expect(screen.getByText('ส่งตรวจคุณภาพ')).toBeInTheDocument();
  });

  it('hides FG quality inspection alerts sub-tab from non-FG users', async () => {
    mocks.user = {
      employeeId: 'E888',
      email: 'qc-head@example.test',
      name: 'QC Head',
      roles: ['qc-head'],
    };
    renderPage({}, '/petition');

    fireEvent.mouseDown(screen.getByRole('tab', { name: 'List ยา 6 เดือน' }), { button: 0, ctrlKey: false });

    expect(await screen.findByText('F-TEST-001')).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'แจ้งเตือนส่งตรวจคุณภาพ' })).not.toBeInTheDocument();
  });

  it('hides the six-month medicine tab for users without admin or QC head', async () => {
    mocks.user = {
      employeeId: 'E889',
      email: 'qc-staff@example.test',
      name: 'QC Staff',
      roles: ['qc-staff'],
    };
    renderPage();

    expect(await screen.findByText('P-2607-0001')).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'List ยา 6 เดือน' })).not.toBeInTheDocument();
    expect(mocks.getSixMonthMedicineStock).not.toHaveBeenCalled();
  });

  it('uses production petition_no query as the list search term', async () => {
    renderPage({}, '/petitions?petition_no=P-2607-0003');

    expect(await screen.findByText('P-2607-0003')).toBeInTheDocument();
    expect(screen.queryByText('P-2607-0001')).not.toBeInTheDocument();
  });

  it('filters the list as soon as the search field changes', async () => {
    renderPage();

    expect(await screen.findByText('P-2607-0001')).toBeInTheDocument();

    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'P-2607-0004' },
    });

    await waitFor(() => {
      expect(screen.getByText('P-2607-0004')).toBeInTheDocument();
      expect(screen.queryByText('P-2607-0001')).not.toBeInTheDocument();
    });
  });
});
