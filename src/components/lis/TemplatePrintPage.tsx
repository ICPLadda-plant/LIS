import type { CSSProperties } from "react";
import { PAPER_MM } from "@/lib/documentRegistry";
import { renderTemplate, type TemplateData } from "@/lib/formTemplate";
import type { ActiveTemplate } from "@/hooks/useActiveTemplates";

export default function TemplatePrintPage({ template, data }: { template: ActiveTemplate; data: TemplateData }) {
  const mm = PAPER_MM[template.paper] ?? PAPER_MM["A4 แนวตั้ง"];
  return (
    <section
      className="doc-page doc-template-print bg-white text-black"
      style={{ "--page-w": mm.w + "mm", "--page-h": mm.h + "mm", "--page-pad": mm.pad + "mm", backgroundImage: "none", breakAfter: "page" } as CSSProperties}
      dangerouslySetInnerHTML={{ __html: renderTemplate(template.html, data) }}
    />
  );
}
