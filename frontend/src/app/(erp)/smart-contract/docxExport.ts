import { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, AlignmentType, BorderStyle, ShadingType, HeadingLevel } from "docx";
import { COMPANY, type Block, type Bi, type DocModel } from "./docModels";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const GREEN = "1C3F2B", RED = "A52A2A", GRAY = "6B7280", SOFT = "F3F1EA";

const run = (text: string, o: { bold?: boolean; italics?: boolean; color?: string; size?: number } = {}) => new TextRun({ text, bold: o.bold, italics: o.italics, color: o.color, size: o.size ?? 19, font: "Calibri" });
const bi = (t: Bi, bold = true) => [run(t[0], { bold }), run(` / ${t[1]}`, { color: GRAY })];
const cell = (children: TextRun[], o: { shade?: boolean; width?: number; span?: number } = {}) => new TableCell({
  children: [new Paragraph({ children })], columnSpan: o.span,
  width: o.width ? { size: o.width, type: WidthType.PERCENTAGE } : undefined,
  shading: o.shade ? { type: ShadingType.CLEAR, color: "auto", fill: SOFT } : undefined,
  margins: { top: 60, bottom: 60, left: 90, right: 90 },
});
const title = (t?: Bi) => (t ? [new Paragraph({ spacing: { before: 240, after: 80 }, children: [run(t[0].toUpperCase(), { bold: true, color: GREEN }), run(` / ${t[1]}`, { color: GRAY })] })] : []);

function blockToDocx(b: Block): (Paragraph | Table)[] {
  if (b.kind === "kv") return [...title(b.title), new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: b.rows.map(([k, v]) => new TableRow({ children: [cell(bi(k), { shade: true, width: 34 }), cell([run(v)], { width: 66 })] })) })];
  if (b.kind === "table") return [...title(b.title), new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({ tableHeader: true, children: b.head.map((h) => cell([run(h[0], { bold: true }), run(` / ${h[1]}`, { color: GRAY, size: 16 })], { shade: true })) }),
      ...b.rows.map((r) => new TableRow({ children: r.map((c) => cell([run(c)])) })),
      ...(b.foot ?? []).map(([k, v]) => new TableRow({ children: [cell(bi(k), { span: b.head.length - 1 }), cell([run(v, { bold: true })])] })),
    ],
  })];
  if (b.kind === "text") return [...title(b.title), ...b.paragraphs.map((p) => new Paragraph({ spacing: { after: 120 }, children: [run(p, { size: 21 })] }))];
  if (b.kind === "clauses") return [...title(b.title), ...b.items.flatMap((c) => [
    new Paragraph({ spacing: { before: 120 }, children: bi(c.title) }),
    new Paragraph({ children: [run(c.en)] }),
    new Paragraph({ spacing: { after: 80 }, children: [run(c.es, { italics: true, color: GRAY })] }),
  ])];
  return [new Paragraph({ spacing: { before: 600 } }), ...b.parties.map((p) => new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 400 }, border: { top: { style: BorderStyle.SINGLE, size: 6, color: "1F2937", space: 4 } }, children: [run(p, { size: 18 })] }))];
}

/** Genera el modelo como Word editable (.docx). */
export async function modelToDocx(model: DocModel): Promise<Blob> {
  const doc = new Document({
    creator: "Don Pimentón ERP", title: `${model.title[0]} — ${model.ref}`,
    sections: [{
      properties: { page: { margin: { top: 900, bottom: 900, left: 1000, right: 1000 } } },
      children: [
        new Paragraph({ children: [run(COMPANY.name, { bold: true, color: GREEN, size: 30 })] }),
        new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: RED, space: 4 } }, children: [run(`${COMPANY.ruc} · ${COMPANY.address} · ${COMPANY.email}`, { color: GRAY, size: 16 })] }),
        new Paragraph({ heading: HeadingLevel.HEADING_1, alignment: AlignmentType.RIGHT, spacing: { before: 200 }, children: [run(model.title[0].toUpperCase(), { bold: true, size: 26 }), run(` / ${model.title[1]}`, { color: GRAY, size: 22 })] }),
        new Paragraph({ alignment: AlignmentType.RIGHT, children: [run(`Ref. ${model.ref}`, { size: 16 })] }),
        ...(model.issuedBy ? [new Paragraph({ spacing: { before: 120 }, children: [run(model.issuedBy, { italics: true, color: "B26B00", size: 17 })] })] : []),
        ...model.blocks.flatMap(blockToDocx),
        new Paragraph({ spacing: { before: 400 }, alignment: AlignmentType.CENTER, children: [run("Modelo de referencia generado por Don Pimentón ERP con datos de demostración — no es un documento oficial. Revise y complete los campos marcados [completar].", { color: GRAY, size: 15 })] }),
      ],
    }],
  });
  const blob = await Packer.toBlob(doc);
  return new Blob([blob], { type: DOCX_MIME });
}

/** Huella SHA-256 (hex) del archivo generado, la misma que calcula el backend al adjuntarlo. */
export async function sha256Hex(blob: Blob) {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

export const docxFile = (blob: Blob, name: string) => new File([blob], name, { type: DOCX_MIME });
