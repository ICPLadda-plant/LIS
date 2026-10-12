import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("App routes", () => {
  it("opens the Lab testing queue from /lab-testing", () => {
    const source = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8");

    expect(source).toContain(
      '<Route path="/lab-testing" element={<PrivateRoute><LabTestingPage /></PrivateRoute>} />',
    );
  });

  it("keeps QC Head result editing under /record-results/:id", () => {
    const source = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8");

    expect(source).toContain('searchParams.get("edit") === "1"');
    expect(source).toContain('<Route path="/record-results/:id" element={<PrivateRoute><ResultDetailRoute /></PrivateRoute>} />');
  });
});
