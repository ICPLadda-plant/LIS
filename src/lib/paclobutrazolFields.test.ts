import { describe, expect, it } from "vitest";
import { calculatePaclobutrazol, pbzFixed, pbzKey, PBZ_DIL_SAMPLE, PBZ_DIL_STD, PBZ_STD_PCT } from "./paclobutrazolFields";

describe("calculatePaclobutrazol", () => {
  it("ได้ค่าตรงกับใบคำนวณตัวอย่าง 2976/69", () => {
    const values: Record<string, unknown> = {
      [PBZ_STD_PCT]: "99.38", [PBZ_DIL_STD]: "50", [PBZ_DIL_SAMPLE]: "50",
      [pbzKey("Std 1", "wt/mg")]: "52.34", [pbzKey("Std 1", "Peak area 1")]: "351.3769", [pbzKey("Std 1", "Internal std 1")]: "572.8224",
      [pbzKey("Std 1", "Peak area 2")]: "350.1408", [pbzKey("Std 1", "Internal std 2")]: "571.5262",
      [pbzKey("Std 2", "wt/mg")]: "53.24", [pbzKey("Std 2", "Peak area 1")]: "383.4706", [pbzKey("Std 2", "Internal std 1")]: "615.314",
      [pbzKey("Std 2", "Peak area 2")]: "385.3633", [pbzKey("Std 2", "Internal std 2")]: "617.7249",
      [pbzKey("Sample 1", "wt/mg")]: "196.5", [pbzKey("Sample 1", "Peak area 1")]: "305.407", [pbzKey("Sample 1", "Internal std 1")]: "561.0736",
      [pbzKey("Sample 1", "Peak area 2")]: "305.407", [pbzKey("Sample 1", "Internal std 2")]: "561.0736",
      [pbzKey("Sample 2", "wt/mg")]: "206", [pbzKey("Sample 2", "Peak area 1")]: "323.911", [pbzKey("Sample 2", "Internal std 1")]: "568.9565",
      [pbzKey("Sample 2", "Peak area 2")]: "323.911", [pbzKey("Sample 2", "Internal std 2")]: "568.9565",
    };
    const r = calculatePaclobutrazol(values, 1.055);
    expect(pbzFixed(r.std[0].conc, 3)).toBe("1.047");
    expect(r.std.flatMap((s) => s.inj.map((i) => pbzFixed(i.fi, 4)))).toEqual(["1.7065", "1.7087", "1.7086", "1.7068"]);
    expect(pbzFixed(r.meanFactor, 4)).toBe("1.7076");
    expect(pbzFixed(r.sample[0].conc, 3)).toBe("3.930");
    // ค่าดิบจากชีต Data ต้องได้ Content ตรงคอลัมน์ M ของ Excel
    expect(r.sample[0].meanContent).toBeCloseTo(23.5052008, 6);
    expect(r.sample[1].meanContent).toBeCloseTo(23.4502124, 6);
    expect(r.average).toBeCloseTo(23.4777066, 6);
    expect(pbzFixed(r.report, 2)).toBe("24.77");
  });
});
