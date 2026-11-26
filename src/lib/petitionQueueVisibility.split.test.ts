import { describe, expect, it } from 'vitest';
import type { Petition } from '@/types/petition.types';
import { splitPetitionBySendDay } from './petitionQueueVisibility';

const item = (seq: number, labelSampledDate?: string) => ({ seq, sampleName: 'A', commonName: 'X', batchNo: 'B' + seq, labelSampledDate });
const petition = (items: ReturnType<typeof item>[]) => ({ _id: 'p1', items } as unknown as Petition);

describe('splitPetitionBySendDay', () => {
  it('รวมตัวอย่างที่ส่งวันเดียวกันไว้ card เดียว', () => {
    expect(splitPetitionBySendDay(petition([item(1, '2026-11-26'), item(2, '2026-11-26')]))).toHaveLength(1);
  });
  it('แยก card เมื่อส่งคนละวัน', () => {
    const cards = splitPetitionBySendDay(petition([item(1, '2026-11-27'), item(2, '2026-11-26'), item(3)]));
    expect(cards.map((c) => c.sendDayKey)).toEqual(['2026-11-26', '2026-11-27']);
    expect(cards[0].items.map((i) => i.seq)).toEqual([2, 3]);
    expect(cards[1].items.map((i) => i.seq)).toEqual([1]);
  });
});
