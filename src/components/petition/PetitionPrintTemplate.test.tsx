import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import PetitionPrintTemplate from './PetitionPrintTemplate';
import { expandItemsBySampleQuantity } from '@/lib/petitionPrintItems';
import type { Petition, PetitionItem } from '@/types/petition.types';
import type { LabRequest } from '@/types/labRequest.types';

describe('expandItemsBySampleQuantity', () => {
  it('creates one print row per entered sample quantity', () => {
    const rows = expandItemsBySampleQuantity([
      { seq: 1, sampleName: 'Sample A', batchNo: 'B-001', sampleQuantity: 3 } as PetitionItem,
      { seq: 2, sampleName: 'Sample B', batchNo: 'B-002', sampleQuantity: 1 } as PetitionItem,
    ]);

    expect(rows.map((row) => row.rowSeq)).toEqual([1, 2, 3, 4]);
    expect(rows.map((row) => row.item.seq)).toEqual([1, 1, 1, 2]);
  });
});

describe('PetitionPrintTemplate QC + Lab samples', () => {
  it('lists only the Lab sample when an old petition entered the QC and Lab samples as two rows', () => {
    const base = { sampleName: 'FIPRONIL 0.3% GR', batchNo: '26S-FPN0.3-156', sendToLab: true, sampleQuantity: 1 };
    const petition = {
      _id: 'p1',
      petitionNo: 'P-2610-0003',
      dept: 'production',
      submittedBy: { name: 'x', department: 'IT', submittedAt: '' },
      items: [
        { ...base, seq: 1, labelQuantity: '100 G', labelQuantities: ['100 G'] },
        { ...base, seq: 2, labelQuantity: '500 G', labelQuantities: ['500 G'] },
      ],
    } as unknown as Petition;

    render(<PetitionPrintTemplate petition={petition} labRequest={{ sampleSeq: 1, requester: {} } as unknown as LabRequest} />);

    expect(screen.getAllByText('26S-FPN0.3-156')).toHaveLength(1);
  });
});
