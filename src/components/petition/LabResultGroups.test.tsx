import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import LabResultGroups from "./LabResultGroups";
import { mediaUrlsFromValue } from "@/lib/mediaUrls";
import type { ApprovalItemGroup } from "@/lib/qcApprovalRows";

const photo = "/LIS/uploads/qc-photos/7accf17e-59df-4788-8204-f93e6cfefaa9.jpg";

describe("mediaUrlsFromValue", () => {
  it("returns uploaded media paths and ignores ordinary values", () => {
    expect(mediaUrlsFromValue([photo])).toEqual([photo]);
    expect(mediaUrlsFromValue(photo)).toEqual([photo]);
    expect(mediaUrlsFromValue("12.5")).toEqual([]);
    expect(mediaUrlsFromValue([photo, "note"])).toEqual([]);
  });
});

describe("LabResultGroups photo values", () => {
  it("shows a thumbnail instead of the path and opens it large on click", () => {
    const groups: ApprovalItemGroup[] = [{
      seq: 1,
      sampleName: "Sample",
      unmatched: false,
      params: [{
        parameterId: "p1",
        parameterName: "ลักษณะภายนอก",
        scope: "qc",
        hasPhases: false,
        rows: [{ key: "r1", label: "รูป", value: photo, mediaUrls: [photo], standardText: "", abnormal: false, note: "", phase: 1 }],
      }],
    }];
    render(<LabResultGroups groups={groups} />);

    expect(screen.queryByText(photo)).not.toBeInTheDocument();
    expect(screen.getByAltText("QC photo")).toHaveAttribute("src", `${photo}?lis_media=1`);

    fireEvent.click(screen.getByRole("button", { name: "ดูรูปขนาดใหญ่" }));
    expect(screen.getByAltText("QC photo full")).toHaveAttribute("src", `${photo}?lis_media=1`);
  });
});
