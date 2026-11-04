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

describe('PetitionPrintTemplate header fields', () => {
  const makePetition = (count: number) => ({
    _id: 'p2',
    petitionNo: 'P-2611-0001',
    dept: 'production',
    createdAt: '2026-11-03T03:00:00.000Z',
    submittedBy: { name: 'x', department: 'ผลิต 2', submittedAt: '' },
    items: Array.from({ length: count }, (_, i) => ({ seq: i + 1, sampleName: `S${i + 1}`, batchNo: `B-${i + 1}`, sendToLab: true, sampleQuantity: 1, submissionNo: 'TA-999' })),
  }) as unknown as Petition;
  const labRequest = { sampleSeq: 1, labRequestNo: 'L-2611-0001', requester: {} } as unknown as LabRequest;

  it('numbers the service request sheets and leaves the request numbers blank', () => {
    const { container } = render(<PetitionPrintTemplate petition={makePetition(9)} labRequest={labRequest} />);
    const sheets = [...container.querySelectorAll('.pr-p2-sheet')].map((el) => el.textContent);
    expect(sheets).toEqual(['แผ่นที่1/2', 'แผ่นที่2/2']);
    expect(container.textContent).not.toContain('L-2611-0001');
    expect(container.querySelector('.pr-p1-meta-row .pr-line')?.textContent).toBe('');
    expect(screen.getByText('TI P02/69')).toBeTruthy();
  });

  it('prints 1/1 when all samples fit on one sheet', () => {
    const { container } = render(<PetitionPrintTemplate petition={makePetition(2)} labRequest={labRequest} />);
    expect([...container.querySelectorAll('.pr-p2-sheet')].map((el) => el.textContent)).toEqual(['แผ่นที่1/1']);
  });
});
