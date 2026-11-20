/**
 * Minimal reader for the first worksheet of an `.xlsx` workbook, enough for
 * report exports such as Microsoft Defender's. Uses only `DecompressionStream`,
 * which Node.js and current browsers provide, so it adds no dependency.
 *
 * Rows come back as CSV lines so the regular log parser handles them.
 */

const LOCAL_FILE_HEADER = 0x04034b50;

const CENTRAL_DIRECTORY_HEADER = 0x02014b50;

const END_OF_CENTRAL_DIRECTORY = 0x06054b50;

const STORED = 0;

const DEFLATED = 8;

// Built-in number formats that display dates or times.
const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);

const EXCEL_EPOCH_OFFSET_DAYS = 25_569;

const MILLISECONDS_PER_DAY = 86_400_000;

const XML_ENTITIES = new Map([
  ["amp", "&"],
  ["lt", "<"],
  ["gt", ">"],
  ["quot", '"'],
  ["apos", "'"],
]);

interface ZipEntry {
  readonly method: number;
  readonly compressedSize: number;
  readonly localHeaderOffset: number;
}

/** True when the bytes start like a ZIP archive, which every `.xlsx` is. */
export function isZip(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 &&
    new DataView(bytes.buffer, bytes.byteOffset).getUint32(0, true) === LOCAL_FILE_HEADER
  );
}

export async function xlsxLines(bytes: Uint8Array): Promise<string[]> {
  const entries = zipEntries(bytes);

  const read = async (name: string): Promise<string | undefined> => {
    const entry = entries.get(name);

    return entry === undefined ? undefined : await entryText(bytes, entry);
  };

  const sheetPath = await firstSheetPath(read, entries);

  if (sheetPath === undefined) {
    throw new Error("The workbook contains no worksheet");
  }

  const sheet = (await read(sheetPath)) ?? "";
  const sharedStrings = parseSharedStrings((await read("xl/sharedStrings.xml")) ?? "");
  const dateStyles = parseDateStyles((await read("xl/styles.xml")) ?? "");

  return parseRows(sheet, sharedStrings, dateStyles).map((row) =>
    row.map((cell) => csvCell(cell)).join(","),
  );
}

function zipEntries(bytes: Uint8Array): Map<string, ZipEntry> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();
  let end = -1;

  // The end record sits in the last 22 bytes plus an optional comment.
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65_557); offset -= 1) {
    if (view.getUint32(offset, true) === END_OF_CENTRAL_DIRECTORY) {
      end = offset;
      break;
    }
  }

  if (end === -1) {
    throw new Error("Not a valid .xlsx file: ZIP directory not found");
  }

  const entries = new Map<string, ZipEntry>();
  const count = view.getUint16(end + 10, true);
  let offset = view.getUint32(end + 16, true);

  for (let index = 0; index < count; index += 1) {
    if (view.getUint32(offset, true) !== CENTRAL_DIRECTORY_HEADER) {
      throw new Error("Not a valid .xlsx file: broken ZIP directory");
    }

    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));

    entries.set(name, {
      method: view.getUint16(offset + 10, true),
      compressedSize: view.getUint32(offset + 20, true),
      localHeaderOffset: view.getUint32(offset + 42, true),
    });
    offset += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

async function entryText(bytes: Uint8Array, entry: ZipEntry): Promise<string> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const header = entry.localHeaderOffset;
  const start = header + 30 + view.getUint16(header + 26, true) + view.getUint16(header + 28, true);
  const data = bytes.slice(start, start + entry.compressedSize);

  if (entry.method === STORED) {
    return new TextDecoder().decode(data);
  }

  if (entry.method !== DEFLATED) {
    throw new Error(`Unsupported ZIP compression method ${entry.method}`);
  }

  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));

  return await new Response(stream).text();
}

async function firstSheetPath(
  read: (name: string) => Promise<string | undefined>,
  entries: ReadonlyMap<string, ZipEntry>,
): Promise<string | undefined> {
  const workbook = (await read("xl/workbook.xml")) ?? "";
  const relationships = (await read("xl/_rels/workbook.xml.rels")) ?? "";
  const sheetId = /<sheet\b[^>]*\br:id="([^"]+)"/.exec(workbook)?.[1];

  if (sheetId !== undefined) {
    for (const [, attributes = ""] of relationships.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
      if (attribute(attributes, "Id") === sheetId) {
        const target = attribute(attributes, "Target") ?? "";
        const path = target.startsWith("/") ? target.slice(1) : `xl/${target}`;

        if (entries.has(path)) {
          return path;
        }
      }
    }
  }

  return [...entries.keys()]
    .filter((name) => /^xl\/worksheets\/[^/]+\.xml$/.test(name))
    .toSorted()[0];
}

function parseSharedStrings(xml: string): string[] {
  return [...xml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map(([, item = ""]) =>
    textOf(item.replaceAll(/<rPh\b[\s\S]*?<\/rPh>/g, "")),
  );
}

/** Indexes into `cellXfs` whose number format shows a date or time. */
function parseDateStyles(xml: string): Set<number> {
  const customDateFormats = new Set<number>();

  for (const [, attributes = ""] of xml.matchAll(/<numFmt\b([^>]*)\/?>/g)) {
    const id = Number(attribute(attributes, "numFmtId"));
    // Drop quoted literals and colors before looking for date tokens.
    const code = (attribute(attributes, "formatCode") ?? "").replaceAll(/"[^"]*"|\[[^\]]*\]/g, "");

    if (/[dmyhs]/i.test(code)) {
      customDateFormats.add(id);
    }
  }

  const cellFormats = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(xml)?.[1] ?? "";
  const dateStyles = new Set<number>();

  for (const [index, [, attributes = ""]] of [
    ...cellFormats.matchAll(/<xf\b([^>]*)\/?>/g),
  ].entries()) {
    const id = Number(attribute(attributes, "numFmtId"));

    if (BUILTIN_DATE_FORMATS.has(id) || customDateFormats.has(id)) {
      dateStyles.add(index);
    }
  }

  return dateStyles;
}

function parseRows(
  sheet: string,
  sharedStrings: readonly string[],
  dateStyles: ReadonlySet<number>,
): string[][] {
  const rows: string[][] = [];

  // Empty rows may be self-closing: `<row r="5"/>`.
  for (const [, , rowXml = ""] of sheet.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const row: string[] = [];

    for (const [, attributes = "", body = ""] of rowXml.matchAll(
      /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g,
    )) {
      const column = columnIndex(attribute(attributes, "r")) ?? row.length;

      while (row.length < column) {
        row.push("");
      }

      row[column] = cellValue(attributes, body, sharedStrings, dateStyles);
    }

    rows.push(row);
  }

  return rows;
}

function cellValue(
  attributes: string,
  body: string,
  sharedStrings: readonly string[],
  dateStyles: ReadonlySet<number>,
): string {
  const type = attribute(attributes, "t");

  if (type === "inlineStr") {
    return textOf(body);
  }

  const value = decodeXml(/<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? "");

  if (type === "s") {
    return sharedStrings[Number(value)] ?? "";
  }

  if (type === undefined || type === "n") {
    const style = Number(attribute(attributes, "s") ?? "0");

    if (dateStyles.has(style) && value !== "") {
      return excelDate(Number(value));
    }
  }

  return value;
}

/**
 * Excel stores dates as days since 1899-12-30 without a time zone. Return the
 * wall-clock time without an offset, which parsers read as local time, the
 * same way the workbook displays it.
 */
function excelDate(serial: number): string {
  const date = new Date(Math.round((serial - EXCEL_EPOCH_OFFSET_DAYS) * MILLISECONDS_PER_DAY));

  return date.toISOString().slice(0, 19);
}

function columnIndex(reference: string | undefined): number | undefined {
  const letters = /^([A-Z]+)/.exec(reference ?? "")?.[1];

  if (letters === undefined) {
    return undefined;
  }

  let index = 0;

  for (const letter of letters) {
    index = index * 26 + letter.charCodeAt(0) - 64;
  }

  return index - 1;
}

function textOf(xml: string): string {
  return [...xml.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)]
    .map(([, text = ""]) => decodeXml(text))
    .join("");
}

function attribute(attributes: string, name: string): string | undefined {
  const value = new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(attributes)?.[1];

  return value === undefined ? undefined : decodeXml(value);
}

function decodeXml(text: string): string {
  return text.replaceAll(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, name: string) => {
    if (name.startsWith("#x") || name.startsWith("#X")) {
      return String.fromCodePoint(Number.parseInt(name.slice(2), 16));
    }

    if (name.startsWith("#")) {
      return String.fromCodePoint(Number(name.slice(1)));
    }

    return XML_ENTITIES.get(name) ?? entity;
  });
}

function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}
