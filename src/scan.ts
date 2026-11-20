import type { Catalog } from "./catalog.ts";
import { defaultCatalog } from "./catalog.ts";
import { LogParser } from "./parse.ts";
import type { Report } from "./report.ts";
import { ReportBuilder } from "./report.ts";

/**
 * Scans one or more log inputs into a single report. Runs in Node.js and in
 * browsers; callers supply lines, for example from {@link linesOf}.
 */
export class Scanner {
  readonly #report: ReportBuilder;

  constructor(catalog: Catalog = defaultCatalog) {
    this.#report = new ReportBuilder(catalog);
  }

  /** Scans one input, such as a file. Each input may have its own format. */
  async scan(lines: AsyncIterable<string> | Iterable<string>): Promise<void> {
    const parser = new LogParser();

    for await (const line of lines) {
      this.#report.countLine();

      const event = parser.parse(line);

      if (event !== undefined) {
        this.#report.add(event);
      }
    }
  }

  report(): Report {
    return this.#report.build();
  }
}

/**
 * Decodes raw bytes into lines. Detects UTF-16 byte order marks, which
 * PowerShell and some Windows exports write, and falls back to UTF-8.
 */
export async function* linesOf(chunks: AsyncIterable<Uint8Array>): AsyncGenerator<string> {
  let decoder: TextDecoder | undefined;
  let rest = "";

  for await (const chunk of chunks) {
    decoder ??= new TextDecoder(encodingOf(chunk));
    rest += decoder.decode(chunk, { stream: true });

    const lines = rest.split("\n");

    rest = lines.pop() ?? "";
    yield* lines;
  }

  rest += decoder?.decode() ?? "";

  if (rest.length > 0) {
    yield rest;
  }
}

function encodingOf(chunk: Uint8Array): string {
  if (chunk[0] === 0xff && chunk[1] === 0xfe) {
    return "utf-16le";
  }

  if (chunk[0] === 0xfe && chunk[1] === 0xff) {
    return "utf-16be";
  }

  return "utf-8";
}
