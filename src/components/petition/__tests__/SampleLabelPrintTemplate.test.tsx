import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import SampleLabelPrintTemplate from '../SampleLabelPrintTemplate';
import type { Petition } from '@/types/petition.types';

const petition: Petition = {
  _id: 'petition-1',
  petitionNo: 'P-2607-0001',
  dept: 'production',
  status: 'sampleSent',
  submittedBy: {
    employeeId: 'dev-admin',
    name: 'Dev Administrator',
    submittedAt: '2026-07-13T00:00:00.000Z',
  },
  items: [
    {
      seq: 1,
      sampleId: '69',
      sampleName: '25 PACLOBUTRAZOL 25% SC',
      commonName: '',
      batchNo: '26S-PCB25SC-HI-026',
      lotNo: '1',
      productionDate: '2026-07-13',
      labelSampledDate: '2026-07-13',
      labelSampledBy: 'Dev Administrator',
    },
  ],
  createdAt: '2026-07-13T00:00:00.000Z',
  updatedAt: '2026-07-13T00:00:00.000Z',
};

describe('SampleLabelPrintTemplate', () => {
  it('prints the batch number as text below the small batch QR code', () => {
    render(<SampleLabelPrintTemplate petition={petition} />);

    expect(screen.getByTestId('sample-label-batch-qr-text')).toHaveTextContent('26S-PCB25SC-HI-026');
  });

  it('prints both QR codes at the same scannable size', () => {
    const { container } = render(<SampleLabelPrintTemplate petition={petition} />);
    const qrs = container.querySelectorAll('svg[aria-label^="QR "]');

    expect(qrs).toHaveLength(2);
    qrs.forEach((qr) => {
      expect(qr).toHaveClass('h-[18mm]', 'w-[18mm]');
    });
  });

  it('keeps the document number out of the title flow instead of absolutely overlaying it', () => {
    const { container } = render(<SampleLabelPrintTemplate petition={petition} />);

    expect(container.querySelector('.label-card .absolute.right-0.top-0')).not.toBeInTheDocument();
  });

  it('renders the requested one-line label header and keeps the document number smaller', () => {
    render(<SampleLabelPrintTemplate petition={petition} />);

    expect(screen.getByTestId('sample-label-header-title')).toBeInTheDocument();
    expect(screen.getByTestId('sample-label-title-line')).toHaveTextContent(
      'ป้ายนำส่งตัวอย่าง บริษัท ไอ ซี พี ลัดดา จำกัด',
    );
    expect(screen.getByTestId('sample-label-title-line')).toHaveClass('whitespace-nowrap');
    expect(screen.getByTestId('sample-label-document-number')).toHaveClass('text-[7px]');
  });

  it('shows the full batch number instead of truncating it with an ellipsis', () => {
    render(<SampleLabelPrintTemplate petition={petition} />);

    const batchNumber = screen.getByTestId('sample-label-batch-number-value');
    expect(batchNumber).toHaveTextContent('26S-PCB25SC-HI-026');
    expect(batchNumber).not.toHaveClass('text-ellipsis');
    expect(batchNumber).not.toHaveClass('overflow-hidden');
  });

  it('keeps the plain F-LAB-01-12 label for products that are not อย. or ปศุสัตว์', () => {
    render(<SampleLabelPrintTemplate petition={petition} />);

    expect(screen.queryByTestId('sample-label-hazard-form')).not.toBeInTheDocument();
    expect(screen.getByText('F-LAB-01-12 Rev : 00 02/11/69')).toBeInTheDocument();
  });

  it.each([
    ['อย.', 'โบรมาดิโอการ์ด - อ.ย.'],
    ['ปศุสัตว์', 'ไซเปอร์เมทริน ปศุสัตว์'],
  ])('uses the F-LAB-01-10 hazard label for %s products', (_type, sampleName) => {
    const hazardPetition = { ...petition, items: [{ ...petition.items[0], sampleName }] };
    render(<SampleLabelPrintTemplate petition={hazardPetition} />);

    expect(screen.getByTestId('sample-label-hazard-form')).toBeInTheDocument();
    expect(screen.getByText('F-LAB-01-10 Rev : 02 11/07/69')).toBeInTheDocument();
    expect(screen.getAllByRole('img', { name: /^(?!QR )/ })).toHaveLength(9);
    expect(screen.getByText('วันที่หมดอายุ')).toBeInTheDocument();
    expect(screen.getByTestId('sample-label-batch-qr-text')).toHaveTextContent('26S-PCB25SC-HI-026');
  });
});
