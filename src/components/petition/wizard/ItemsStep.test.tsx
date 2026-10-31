import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ItemsStep, { type ItemRowValues } from './ItemsStep';

vi.mock('./SubmitterPicker', () => ({
  default: () => <div data-testid="submitter-picker" />,
}));

const baseItem: ItemRowValues = {
  seq: 1,
  sampleName: '',
  commonName: '',
  batchNo: 'BATCH001',
  lotNo: '',
  productionDate: '2026-07-14',
  packageUnit: '',
  submissionNo: '',
  testUnit: '',
  testItems: '',
  note: '',
};

function renderStep(overrides: Partial<React.ComponentProps<typeof ItemsStep>> = {}) {
  const onChange = vi.fn();
  render(
    <ItemsStep
      value={[baseItem]}
      onChange={onChange}
      submitter={{ name: 'Requester' }}
      onSubmitterChange={vi.fn()}
      deliverer={{ name: 'Deliverer' }}
      onDelivererChange={vi.fn()}
      masterItemOptions={[
        {
          itemNo: 'P001',
          sampleName: 'Product A 1.8 EC',
          commonName: 'ABAMECTIN 1.8% W/V EC',
          packageUnit: '1 L x 12 bottles',
        },
      ]}
      {...overrides}
    />,
  );
  return { onChange };
}

describe('ItemsStep master item selection', () => {
  it.each([false, true])('ranks codes and retains fuzzy matches in manual picker=%s', (allowManualItemFields) => {
    renderStep({
      allowManualItemFields,
      masterItemOptions: [
        { itemNo: 'AA', sampleName: 'Rising name', commonName: 'Alpha', packageUnit: '1 L' },
        { itemNo: 'RI-200', sampleName: 'Prefix first', commonName: 'Alpha', packageUnit: '1 L' },
        { itemNo: 'RI-100', sampleName: 'Prefix second', commonName: 'Alpha', packageUnit: '1 L' },
        { itemNo: 'RI', sampleName: 'Exact code', commonName: 'Alpha', packageUnit: '1 L' },
        { itemNo: 'BB', sampleName: 'Alpha Beta', commonName: 'Alpha', packageUnit: '1 L' },
      ],
    });
    fireEvent.click(allowManualItemFields
      ? screen.getByLabelText('ชื่อสามัญ / Active Ingredient')
      : screen.getByRole('combobox', { name: /ชื่อตัวอย่าง/ }));
    const search = screen.getByPlaceholderText('ค้นหาชื่อตัวอย่างจาก Master Item...');
    fireEvent.change(search, { target: { value: 'ri' } });
    const options = screen.getAllByRole('option');
    expect(options.slice(0, 4).map((option) => option.textContent)).toEqual([
      expect.stringContaining('Exact code'),
      expect.stringContaining('Prefix first'),
      expect.stringContaining('Prefix second'),
      expect.stringContaining('Rising name'),
    ]);
    fireEvent.change(search, { target: { value: 'albt' } });
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([expect.stringContaining('Alpha Beta')]);
    fireEvent.change(search, { target: { value: '' } });
    expect(screen.getAllByRole('option')[0]).toHaveTextContent('Rising name');
  });

  it('requires selecting sample name from master item and fills common name plus package size', () => {
    const { onChange } = renderStep();

    fireEvent.click(screen.getByRole('combobox', { name: /ชื่อตัวอย่าง/ }));
    fireEvent.click(screen.getByText('Product A 1.8 EC'));

    expect(onChange).toHaveBeenCalledWith([
      {
        ...baseItem,
        itemNo: 'P001',
        sampleName: 'Product A 1.8 EC',
        commonName: 'ABAMECTIN 1.8% W/V EC',
        packageUnit: '1 L x 12 bottles',
      },
    ]);
  });

  it('does not render Lot No. or submission number fields', () => {
    renderStep();

    expect(screen.queryByText(/Lot No\./)).not.toBeInTheDocument();
    expect(screen.queryByText(/ใบนำส่ง/)).not.toBeInTheDocument();
  });

  it('lets R&D type a sample name and fills empty fields from a matching master item', () => {
    const { onChange } = renderStep({
      allowManualItemFields: true,
      requireDeliveryAndBatch: false,
    });

    fireEvent.change(screen.getByLabelText('ชื่อตัวอย่าง'), {
      target: { value: 'Product A 1.8 EC' },
    });

    expect(onChange).toHaveBeenCalledWith([
      {
        ...baseItem,
        itemNo: 'P001',
        sampleName: 'Product A 1.8 EC',
        commonName: 'ABAMECTIN 1.8% W/V EC',
        packageUnit: '1 L x 12 bottles',
      },
    ]);
  });

  it('keeps typed R&D names but uses package size from the selected master item', () => {
    const { onChange } = renderStep({
      value: [{
        ...baseItem,
        sampleName: 'Typed sample',
        commonName: 'Typed common',
        packageUnit: 'Typed package',
      }],
      allowManualItemFields: true,
      requireDeliveryAndBatch: false,
    });

    fireEvent.click(screen.getByLabelText('ชื่อสามัญ / Active Ingredient'));
    fireEvent.click(screen.getByText('Product A 1.8 EC'));

    // itemNo คือตัวตนของ master item ที่เลือก ไม่ใช่ค่าที่คนพิมพ์เอง — ต้องตามของที่เลือกเสมอ
    expect(onChange).toHaveBeenCalledWith([
      {
        ...baseItem,
        itemNo: 'P001',
        sampleName: 'Typed sample',
        commonName: 'Typed common',
        packageUnit: '1 L x 12 bottles',
      },
    ]);
  });

  it('shows submitted quantity from integration payload as a single sent quantity field', () => {
    renderStep({
      value: [{
        ...baseItem,
        labelQuantity: '9478.67 Kg/L',
        submittedQuantity: '9478.67',
        submittedUnit: 'Kg/L',
      }],
      itemsReadOnly: true,
    });

    expect(screen.getByLabelText('ปริมาณที่ส่ง')).toHaveValue('9478.67 Kg/L');
    expect(screen.queryByLabelText('หน่วยที่นำส่ง')).not.toBeInTheDocument();
  });

  it('renames package size field and keeps sent quantity as a separate value', () => {
    const { onChange } = renderStep({
      value: [{ ...baseItem, packageUnit: '500 ml', labelQuantity: '12 ml' }],
    });

    expect(screen.getByLabelText('ขนาดบรรจุ')).toHaveValue('500 ml');
    expect(screen.queryByText('ขนาดบรรจุ / จำนวน')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('ปริมาณที่ส่ง'), {
      target: { value: '25 ml' },
    });

    expect(onChange).toHaveBeenCalledWith([{ ...baseItem, packageUnit: '500 ml', labelQuantity: '25 ml', labelQuantities: ['25 ml'] }]);
  });

  it('shows one sent quantity input per sample quantity', () => {
    const { onChange } = renderStep({
      value: [{
        ...baseItem,
        sampleQuantity: 3,
        labelQuantity: '5 g, 6 g',
        labelQuantities: ['5 g', '6 g'],
      }],
    });

    expect(screen.getByLabelText('ปริมาณที่ส่ง 1')).toHaveValue('5 g');
    expect(screen.getByLabelText('ปริมาณที่ส่ง 2')).toHaveValue('6 g');
    expect(screen.getByLabelText('ปริมาณที่ส่ง 3')).toHaveValue('');

    fireEvent.change(screen.getByLabelText('ปริมาณที่ส่ง 3'), {
      target: { value: '7 g' },
    });

    expect(onChange).toHaveBeenCalledWith([{
      ...baseItem,
      sampleQuantity: 3,
      labelQuantity: '5 g, 6 g, 7 g',
      labelQuantities: ['5 g', '6 g', '7 g'],
    }]);
  });

  it('lets users enter sample quantity for one item', () => {
    const { onChange } = renderStep();

    fireEvent.change(screen.getByLabelText('จำนวนตัวอย่าง'), {
      target: { value: '3' },
    });

    expect(onChange).toHaveBeenCalledWith([{ ...baseItem, sampleQuantity: 3 }]);
  });

  it('lets users clear sample quantity before typing a new number', () => {
    const { onChange } = renderStep({ value: [{ ...baseItem, sampleQuantity: 12 }] });

    fireEvent.change(screen.getByLabelText('จำนวนตัวอย่าง'), {
      target: { value: '' },
    });

    expect(onChange).toHaveBeenCalledWith([{ ...baseItem, sampleQuantity: undefined }]);
  });

  it('shows LAB routing as automatic instead of user-selectable buttons', () => {
    renderStep();

    expect(screen.queryByRole('button', { name: 'ส่ง LAB' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'ไม่ส่ง LAB' })).not.toBeInTheDocument();
    expect(screen.getByText(/ระบบกำหนดการส่ง LAB จากเลขแบชหรือกลุ่ม/)).toHaveTextContent('ส่ง LAB');
  });

  it('updates LAB choice to true when batch changes into the legacy Lab suffix', () => {
    const { onChange } = renderStep({ value: [{ ...baseItem, batchNo: 'BATCH002', sendToLab: false }] });

    fireEvent.change(screen.getByPlaceholderText('เช่น BN240601'), { target: { value: 'BATCH001' } });

    expect(onChange).toHaveBeenCalledWith([{ ...baseItem, batchNo: 'BATCH001', sendToLab: true }]);
  });

  it('shows automatic not-send LAB routing for other batch suffixes', () => {
    renderStep({ value: [{ ...baseItem, batchNo: 'BATCH002' }] });

    expect(screen.getByText(/ระบบกำหนดการส่ง LAB จากเลขแบชหรือกลุ่ม/)).toHaveTextContent('ไม่ส่ง LAB');
  });

  it('changes PUBLIC HEALTH master item selection to sendToLab true', () => {
    const { onChange } = renderStep({
      value: [{ ...baseItem, batchNo: 'BATCH002', sendToLab: false }],
      masterItemOptions: [
        {
          itemNo: 'P002',
          sampleName: 'Public Health Product',
          commonName: 'DELTAMETHRIN 1% W/V EC (PUBLIC HEALTH)',
          packageUnit: '1 L x 12 bottles',
        },
      ],
    });

    fireEvent.click(screen.getByRole('combobox', { name: /ชื่อตัวอย่าง/ }));
    fireEvent.click(screen.getByText('Public Health Product'));

    expect(onChange).toHaveBeenCalledWith([
      {
        ...baseItem,
        itemNo: 'P002',
        sampleName: 'Public Health Product',
        commonName: 'DELTAMETHRIN 1% W/V EC (PUBLIC HEALTH)',
        packageUnit: '1 L x 12 bottles',
        batchNo: 'BATCH002',
        sendToLab: true,
      },
    ]);
  });

  it('changes MF gap master item selection to sendToLab true for the five-batch hold', () => {
    const { onChange } = renderStep({
      value: [{ ...baseItem, batchNo: 'BATCH002', sendToLab: false }],
      masterItemOptions: [
        {
          itemNo: 'P003',
          sampleName: 'Restarted Product',
          commonName: 'ABAMECTIN 1.8% W/V EC',
          packageUnit: '1 L x 12 bottles',
          MF_Before: '2026-08-01',
          MF_Lasted: '2026-09-01',
          MF_GapDays: 31,
          MF_BatchAfterGap: 3,
        },
      ],
    });

    fireEvent.click(screen.getByRole('combobox', { name: /ชื่อตัวอย่าง/ }));
    fireEvent.click(screen.getByText('Restarted Product'));

    expect(onChange).toHaveBeenCalledWith([
      {
        ...baseItem,
        itemNo: 'P003',
        sampleName: 'Restarted Product',
        commonName: 'ABAMECTIN 1.8% W/V EC',
        packageUnit: '1 L x 12 bottles',
        batchNo: 'BATCH002',
        sendToLab: true,
        MF_Before: '2026-08-01',
        MF_Lasted: '2026-09-01',
        MF_GapDays: 31,
        MF_BatchAfterGap: 3,
      },
    ]);
  });

  it('changes LIVE STOCK manual active ingredient to sendToLab true', () => {
    const { onChange } = renderStep({
      value: [{ ...baseItem, batchNo: 'BATCH002', sendToLab: false }],
      allowManualItemFields: true,
    });

    fireEvent.change(screen.getByLabelText('ชื่อสามัญ / Active Ingredient'), {
      target: { value: 'BIFENTHRIN 10% W/V EC (LIVE STOCK)' },
    });

    expect(onChange).toHaveBeenCalledWith([
      {
        ...baseItem,
        commonName: 'BIFENTHRIN 10% W/V EC (LIVE STOCK)',
        batchNo: 'BATCH002',
        sendToLab: true,
      },
    ]);
  });

  it('keeps note as a normal field even when sendToLab differs from the default', () => {
    renderStep({ value: [{ ...baseItem, sendToLab: false }] });

    expect(screen.queryByText('เลือกต่างจากค่าเริ่มต้น')).not.toBeInTheDocument();
    expect(screen.queryByText('ต้องระบุหมายเหตุเมื่อเลือกส่ง LAB ต่างจากค่าเริ่มต้น')).not.toBeInTheDocument();
    expect(screen.getByText('หมายเหตุ')).not.toHaveClass('text-red-500');
    expect(screen.queryByPlaceholderText('โปรดระบุเหตุผล')).not.toBeInTheDocument();
  });

  // itemNo ขับ "หมวดหมู่ย่อย (prefix code)" + "กลุ่ม Item" ของ parameter — ถ้าค้างรหัสเก่าไว้
  // ตอนคนพิมพ์ชื่อที่ไม่ตรง master item ไหนเลย พารามิเตอร์จะขึ้นผิดตัว
  it('clears itemNo when a typed sample name matches no master item', () => {
    const { onChange } = renderStep({
      value: [{ ...baseItem, itemNo: 'P001', sampleName: 'Product A 1.8 EC' }],
      allowManualItemFields: true,
      requireDeliveryAndBatch: false,
    });

    fireEvent.change(screen.getByLabelText('ชื่อตัวอย่าง'), {
      target: { value: 'Something nobody sells' },
    });

    expect(onChange).toHaveBeenCalledWith([
      { ...baseItem, itemNo: '', sampleName: 'Something nobody sells' },
    ]);
  });

  it('uses the R&D active ingredient field as the master item picker trigger', () => {
    renderStep({
      allowManualItemFields: true,
      requireDeliveryAndBatch: false,
    });

    expect(screen.queryByText('Master')).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('ชื่อสามัญ / Active Ingredient'));

    expect(screen.getByText('Product A 1.8 EC')).toBeInTheDocument();
  });
});

describe('ItemsStep production send targets', () => {
  const productionItem: ItemRowValues = { ...baseItem, batchNo: 'BATCH002', commonName: 'DELTAMETHRIN 1% W/V EC (PUBLIC HEALTH)', sendToQc: true, sendToLab: true };

  it('lets production untick Lab (AI) on a PUBLIC HEALTH batch without forcing it back', () => {
    const { onChange } = renderStep({ showSendTargets: true, value: [productionItem] });

    expect(screen.getByText('ส่งวิเคราะห์')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: 'ส่งวิเคราะห์ Lab (AI) ตัวอย่างที่ 1' }));

    expect(onChange).toHaveBeenCalledWith([{ ...productionItem, sendToLab: false, sendToQc: true }]);
  });

  it('lets production untick QC while keeping the Lab choice explicit', () => {
    const { onChange } = renderStep({ showSendTargets: true, value: [productionItem] });

    fireEvent.click(screen.getByRole('checkbox', { name: 'ส่งวิเคราะห์ QC ตัวอย่างที่ 1' }));

    expect(onChange).toHaveBeenCalledWith([{ ...productionItem, sendToQc: false, sendToLab: true }]);
  });
});

