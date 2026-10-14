import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import PetitionView from './PetitionView';
import type { Petition } from '@/types/petition.types';
import type { ParameterItem } from '@/lib/api';

const fixtures = vi.hoisted(() => ({
  petition: {
    _id: 'petition-rd',
    petitionNo: 'P-RD-001',
    dept: 'production',
    status: 'inProgress',
    submittedBy: {
      name: 'นักวิจัย',
      department: 'R & D',
      submittedAt: '2026-07-31T01:00:00.000Z',
    },
    items: [
      {
        seq: 1,
        sampleName: 'R&D Sample',
        commonName: 'R&D Active',
        itemNo: 'FC-QPA50-1X16',
        batchNo: '',
      },
    ],
    createdAt: '2026-07-31T01:00:00.000Z',
    updatedAt: '2026-07-31T01:00:00.000Z',
  } as Petition,
  parameters: [
    {
      _id: 'lab-only',
      name: 'ทดสอบ Lab',
      scope: 'lab',
      applyAll: true,
      valueFields: [{ label: 'ผล Lab', type: 'text' }],
    },
    {
      _id: 'qc-physical',
      name: 'กายภาพ',
      scope: 'qc',
      shareWithLab: true,
      applyAll: true,
      valueFields: [{ label: 'ผล QC', type: 'text' }],
    },
  ] as ParameterItem[],
  getParameters: vi.fn(),
  getQCResults: vi.fn(),
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { name: 'Lab User', roles: ['admin'] } }),
}));

vi.mock('@/hooks/useItemGroupMembership', () => ({
  useItemGroupMembership: () => new Map(),
}));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      getParameters: fixtures.getParameters,
      getQCResults: fixtures.getQCResults,
    },
  };
});

beforeEach(() => {
  fixtures.getParameters.mockResolvedValue(fixtures.parameters);
  fixtures.getQCResults.mockResolvedValue([]);
});

describe('PetitionView R&D parameter visibility', () => {
  it('shows only Lab-scope parameters for R&D petitions', async () => {
    render(<PetitionView petition={fixtures.petition} />);

    await waitFor(() => expect(screen.getByText('ทดสอบ Lab')).toBeInTheDocument());
    expect(screen.queryByText('กายภาพ')).not.toBeInTheDocument();
  });

  it('shows the item code bubble under common name', async () => {
    render(<PetitionView petition={fixtures.petition} />);

    await waitFor(() => expect(screen.getByText('ทดสอบ Lab')).toBeInTheDocument());
    expect(screen.getByText('R&D Active')).toBeInTheDocument();
    expect(screen.getByText('รหัสสินค้า')).toBeInTheDocument();
    expect(screen.getByText('FC-QPA50-1X16')).toBeInTheDocument();
  });

  it('shows saved substance-mode Lab results by substance storage key', async () => {
    fixtures.getParameters.mockResolvedValue([
      {
        _id: 'lab-ai',
        name: 'Lab%AI',
        scope: 'lab',
        applyAll: true,
        valueFields: [{ label: '%AI', type: 'float', unit: '%', substanceMode: true }],
      },
    ] as ParameterItem[]);
    fixtures.getQCResults.mockResolvedValue([
      {
        petitionId: fixtures.petition._id,
        itemSeq: 1,
        parameterId: 'lab-ai',
        parameterName: 'Lab%AI',
        values: { '%AI::abamectin': '1.7' },
      },
    ]);
    render(
      <PetitionView
        petition={{
          ...fixtures.petition,
          items: [
            {
              ...fixtures.petition.items[0],
              commonName: 'ABAMECTIN 1.8% W/V EC',
            },
          ],
        }}
      />,
    );

    await waitFor(() => expect(screen.getByText('Lab%AI')).toBeInTheDocument());
    expect(screen.queryByText('ยังไม่บันทึก')).not.toBeInTheDocument();
    expect(screen.getByText('1.7')).toBeInTheDocument();
  });

  it('shows a dash without the missing-standard badge in result mode', async () => {
    fixtures.getQCResults.mockResolvedValue([
      {
        petitionId: fixtures.petition._id,
        itemSeq: 1,
        parameterId: 'lab-only',
        parameterName: 'ทดสอบ Lab',
        values: { 'ผล Lab': 'ผ่าน' },
      },
    ]);

    render(<PetitionView petition={fixtures.petition} hideMissingStandardBadge />);

    await waitFor(() => expect(screen.getByText('ทดสอบ Lab')).toBeInTheDocument());
    expect(screen.queryByText('ไม่มีเกณฑ์')).not.toBeInTheDocument();
    expect(screen.getByText('เกณฑ์:')).toHaveTextContent('เกณฑ์: -');
  });
});
