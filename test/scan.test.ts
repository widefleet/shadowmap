import { describe, expect, it } from "vitest";

import { Scanner, linesOf } from "../src/index.ts";
import { formatReport } from "../src/format.ts";

async function* chunks(...parts: Uint8Array[]): AsyncGenerator<Uint8Array> {
  yield* parts;
}

async function collect(lines: AsyncIterable<string>): Promise<string[]> {
  const result: string[] = [];

  for await (const line of lines) {
    result.push(line);
  }

  return result;
}

describe("linesOf", () => {
  it("splits lines across chunk boundaries", async () => {
    const encoder = new TextEncoder();

    expect(
      await collect(linesOf(chunks(encoder.encode("a.lov"), encoder.encode("able.app\nb\n")))),
    ).toEqual(["a.lovable.app", "b"]);
  });

  it("decodes UTF-16LE with a byte order mark", async () => {
    const text = "﻿x.vercel.app\ny";
    const bytes = new Uint8Array(text.length * 2);

    for (let index = 0; index < text.length; index += 1) {
      const code = text.charCodeAt(index);

      bytes[index * 2] = code & 0xff;
      bytes[index * 2 + 1] = code >> 8;
    }

    expect(await collect(linesOf(chunks(bytes)))).toEqual(["x.vercel.app", "y"]);
  });
});

describe("Scanner", () => {
  it("counts apps, devices and days across inputs", async () => {
    const scanner = new Scanner();

    await scanner.scan([
      "Timestamp,DeviceName,Host",
      "2026-11-18T08:00:00Z,LAPTOP-1,crm-dashboard.lovable.app",
      "2026-11-19T08:00:00Z,LAPTOP-2,crm-dashboard.lovable.app",
      "2026-11-19T09:00:00Z,LAPTOP-2,lovable.dev",
      "2026-11-19T09:00:00Z,LAPTOP-3,www.google.com",
    ]);
    await scanner.scan([
      '{"Datetime":"2026-11-20T09:00:00Z","QueryName":"crm-dashboard.lovable.app","DeviceName":"laptop-1"}',
      '{"Datetime":"2026-11-20T09:00:00Z","QueryName":"xyz.supabase.co","DeviceName":"laptop-1"}',
    ]);

    const report = scanner.report();

    expect(report).toMatchObject({ lines: 7, events: 5, eventsWithClient: 5 });
    expect(
      report.totals.map((total) => [
        total.platform.id,
        total.kind,
        total.apps,
        total.clients,
        total.days,
      ]),
    ).toEqual([
      ["lovable", "builder", 0, 1, 1],
      ["lovable", "hosted_app", 1, 2, 3],
      ["supabase", "backend", 1, 1, 1],
    ]);
    expect(report.findings[1]).toMatchObject({
      host: "crm-dashboard.lovable.app",
      events: 3,
      clients: ["laptop-1", "laptop-2"],
      days: 3,
      firstSeen: new Date("2026-11-18T08:00:00Z"),
      lastSeen: new Date("2026-11-20T09:00:00Z"),
    });
  });

  it("counts an app once per line", async () => {
    const scanner = new Scanner();

    await scanner.scan(["my-tool.vercel.app CNAME my-tool.vercel.app"]);

    expect(scanner.report().findings[0]?.events).toBe(1);
  });

  it("prints summary and app tables", async () => {
    const scanner = new Scanner();

    await scanner.scan([
      "Timestamp,DeviceName,Host",
      "2026-11-19T08:00:00Z,LAPTOP-1,crm-dashboard.lovable.app",
    ]);

    expect(formatReport(scanner.report())).toBe(
      [
        "PLATFORM  ACTIVITY     APPS  DEVICES  DAYS  EVENTS",
        "Lovable   hosted apps  1     1        1     1",
        "",
        "APP                        PLATFORM  DEVICES  DAYS  FIRST SEEN  LAST SEEN",
        "crm-dashboard.lovable.app  Lovable   1        1     2026-11-19  2026-11-19",
        "",
        "Scanned 2 lines, 1 matching events.",
        "",
      ].join("\n"),
    );
  });

  it("shows unknown devices for rows whose logs name no client", async () => {
    const scanner = new Scanner();

    await scanner.scan([
      '{"count":3,"dimensions":{"date":"2026-11-19","queryName":"lovable.dev"}}',
      '{"dimensions":{"datetime":"2026-11-19T00:00:00Z","httpHost":"x.vercel.app","email":"anna@example.com"}}',
    ]);

    expect(formatReport(scanner.report())).toContain("Lovable   builds apps  -     ?");
    expect(formatReport(scanner.report())).toContain('Devices show as "?"');
  });
});
