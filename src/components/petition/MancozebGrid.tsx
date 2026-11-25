import { Input } from "@/components/ui/input";
import { MCZ_BLANK, MCZ_CONC, MCZ_FACTOR, MCZ_SAMPLES, calculateMancozeb, mczFixed, mczKey } from "@/lib/mancozebFields";

type Props = {
  values: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
  disabled?: boolean;
  density?: number | null;
};

/** ช่องกรอกใบคำนวณ MANCOZEB (ไทเทรต 0.1 N I2) พร้อมผลคำนวณสด */
export function MancozebGrid({ values, onChange, disabled, density }: Props) {
  const calc = calculateMancozeb(values, density ?? null);
  const input = (key: string, label: string) => (
    <Input className="h-8" inputMode="decimal" aria-label={label} value={String(values[key] ?? "")} disabled={disabled} onChange={(e) => onChange(key, e.target.value)} />
  );

  return (
    <section className="space-y-3 rounded-lg border border-l-4 border-l-primary bg-card p-3 shadow-sm sm:col-span-6">
      <h4 className="text-base font-semibold text-foreground">ใบคำนวณ Mancozeb (ไทเทรต 0.1 N I2)</h4>
      <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
        <label className="flex items-center gap-2"><span className="text-muted-foreground">Conc 0.1 N I2</span><span className="w-28">{input(MCZ_CONC, "Conc 0.1 N I2")}</span><span className="text-muted-foreground">N</span></label>
        <label className="flex items-center gap-2"><span className="text-muted-foreground">mL of Blank</span><span className="w-28">{input(MCZ_BLANK, "mL of Blank")}</span><span className="text-muted-foreground">mL</span></label>
        <span className="flex items-center gap-2"><span className="text-muted-foreground">Factor</span><span className="font-medium">{MCZ_FACTOR}</span></span>
      </div>
      <div className="overflow-x-auto rounded-lg border bg-card shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-muted text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left font-medium" />
              <th className="px-3 py-2 text-left font-medium">wt/g</th>
              <th className="px-3 py-2 text-left font-medium">mL 0.1 N I2</th>
              <th className="px-3 py-2 text-left font-medium">mL 0.1 N I2 − Blank</th>
              <th className="px-3 py-2 text-left font-medium">%W/W</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {MCZ_SAMPLES.map((row, i) => (
              <tr key={row}>
                <th scope="row" className="px-3 py-2 text-left font-medium">{row}</th>
                <td className="px-2 py-1.5">{input(mczKey(row, "wt/g"), `${row} wt/g`)}</td>
                <td className="px-2 py-1.5">{input(mczKey(row, "mL 0.1 N I2"), `${row} mL 0.1 N I2`)}</td>
                <td className="px-3 py-2 tabular-nums">{mczFixed(calc.sample[i].net, 4)}</td>
                <td className="px-3 py-2 tabular-nums">{mczFixed(calc.sample[i].result, 4)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-sm text-muted-foreground">
        Average {mczFixed(calc.average, 4) || "-"} · Density {calc.density} · Report <span className="font-semibold text-foreground">{mczFixed(calc.report, 2) || "-"}</span>
      </p>
    </section>
  );
}
