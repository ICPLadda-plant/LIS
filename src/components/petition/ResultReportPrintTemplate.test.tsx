import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import ResultReportPrintTemplate from './ResultReportPrintTemplate';
import type { Petition, QCTestResult } from '@/types/petition.types';

const petition = {
  petitionNo: 'P-001',
  items: [{ seq: 1, sampleName: 'ตัวอย่าง A' }],
} as unknown as Petition;

describe('ResultReportPrintTemplate', () => {
  it('แสดงรูปผลทดสอบเป็นภาพแทน path ข้อความ', () => {
    const photo = '/LIS/uploads/qc-photos/da127545-3ae1-44cd-9be8-6cce8b1e6db1.jpg';
    const qcResults = [{
      itemSeq: 1,
      parameterId: 'appearance',
      parameterName: 'ลักษณะ',
      values: { รูปถ่าย: [photo], สี: 'ขาว' },
    }] as unknown as QCTestResult[];

    render(<ResultReportPrintTemplate kind="final" petition={petition} qcResults={qcResults} />);

    expect(screen.getByAltText('รูปผลการทดสอบ').getAttribute('src')).toContain(photo);
    expect(screen.queryByText(photo)).toBeNull();
    expect(screen.getByText('ขาว')).toBeTruthy();
  });
});
