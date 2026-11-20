import { describe, expect, it } from "vitest";

import { Scanner, isZip, xlsxLines } from "../src/index.ts";

/** Builds a ZIP archive with deflated entries; CRCs stay zero because the reader ignores them. */
async function zip(files: ReadonlyMap<string, string>): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const locals: Uint8Array<ArrayBuffer>[] = [];
  const centrals: Uint8Array<ArrayBuffer>[] = [];
  let offset = 0;

  for (const [name, content] of files) {
    const nameBytes = encoder.encode(name);
    const raw = encoder.encode(content);

    const compressed = new Uint8Array(
      await new Response(
        new Blob([raw]).stream().pipeThrough(new CompressionStream("deflate-raw")),
      ).arrayBuffer(),
    );

    const local = new Uint8Array(30 + nameBytes.length + compressed.length);
    const localView = new DataView(local.buffer);

    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(8, 8, true);
    localView.setUint32(18, compressed.length, true);
    localView.setUint32(22, raw.length, true);
    localView.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    local.set(compressed, 30 + nameBytes.length);

    const central = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(central.buffer);

    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(10, 8, true);
    centralView.setUint32(20, compressed.length, true);
    centralView.setUint32(24, raw.length, true);
    centralView.setUint16(28, nameBytes.length, true);
    centralView.setUint32(42, offset, true);
    central.set(nameBytes, 46);

    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }

  const directorySize = centrals.reduce((size, central) => size + central.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);

  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, files.size, true);
  endView.setUint16(10, files.size, true);
  endView.setUint32(12, directorySize, true);
  endView.setUint32(16, offset, true);

  return new Uint8Array(await new Blob([...locals, ...centrals, end]).arrayBuffer());
}

const workbook = new Map([
  [
    "xl/workbook.xml",
    '<workbook xmlns:r="r"><sheets><sheet name="Results" sheetId="1" r:id="rId1"/></sheets></workbook>',
  ],
  [
    "xl/_rels/workbook.xml.rels",
    '<Relationships><Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
  ],
  [
    "xl/sharedStrings.xml",
    "<sst><si><t>Timestamp</t></si><si><t>DeviceName</t></si><si><t>Host</t></si><si><r><t>laptop-</t></r><r><t>17</t></r></si></sst>",
  ],
  [
    "xl/styles.xml",
    '<styleSheet><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="22"/></cellXfs></styleSheet>',
  ],
  [
    "xl/worksheets/sheet1.xml",
    [
      "<worksheet><sheetData>",
      '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row>',
      '<row r="2"/>',
      '<row r="3"><c r="A3" s="1"><v>46346.385416666664</v></c><c r="B3" t="s"><v>3</v></c><c r="C3" t="inlineStr"><is><t>crm-dashboard.lovable.app</t></is></c></row>',
      '<row r="4"><c r="B4" t="str"><v>a &amp; b, c</v></c><c r="C4" t="inlineStr"><is><t>x.vercel.app</t></is></c></row>',
      "</sheetData></worksheet>",
    ].join(""),
  ],
]);

describe("xlsx", () => {
  it("detects ZIP archives", async () => {
    expect(isZip(await zip(workbook))).toBe(true);
    expect(isZip(new TextEncoder().encode("Timestamp,Host"))).toBe(false);
  });

  it("returns the first sheet as CSV lines with dates and shared strings resolved", async () => {
    expect(await xlsxLines(await zip(workbook))).toEqual([
      "Timestamp,DeviceName,Host",
      "",
      "2026-11-20T09:15:00,laptop-17,crm-dashboard.lovable.app",
      ',"a & b, c",x.vercel.app',
    ]);
  });

  it("feeds a Defender workbook into the scanner", async () => {
    const scanner = new Scanner();

    await scanner.scan(await xlsxLines(await zip(workbook)));

    expect(scanner.report().findings[0]).toMatchObject({
      host: "crm-dashboard.lovable.app",
      clients: ["laptop-17"],
      firstSeen: new Date("2026-11-20T09:15:00Z"),
    });
  });

  it("rejects files that are not workbooks", async () => {
    await expect(xlsxLines(new TextEncoder().encode("PK\u0003\u0004 broken"))).rejects.toThrow(
      "ZIP directory not found",
    );
  });
});
