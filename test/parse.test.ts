import { describe, expect, it } from "vitest";

import { LogParser, hostsIn } from "../src/index.ts";
import { parseTime } from "../src/time.ts";

function parseAll(lines: readonly string[]) {
  const parser = new LogParser();

  return lines.flatMap((line) => parser.parse(line) ?? []);
}

describe("hostsIn", () => {
  it("extracts hosts from URLs, ports and quoted values", () => {
    expect(hostsIn('GET https://app.vercel.app:443/a/b.js?x=1 "Host":"x.netlify.app"')).toEqual([
      "app.vercel.app",
      "b.js",
      "x.netlify.app",
    ]);
  });

  it("ignores single labels", () => {
    expect(hostsIn("localhost intranet")).toEqual([]);
  });
});

describe("parseTime", () => {
  it.each([
    ["2026-11-20T09:14:02Z", "2026-11-20T09:14:02.000Z"],
    ["1763630000.123", "2025-11-20T09:13:20.123Z"],
    ["1763630000123", "2025-11-20T09:13:20.123Z"],
    ["20.11.2026 09:14:02", "2026-11-20T09:14:02.000Z"],
    ["11/20/2026 9:14:02 PM", "2026-11-20T21:14:02.000Z"],
    ["20/11/2026 09:14:02", "2026-11-20T09:14:02.000Z"],
    ["2026-11-20 09:22:10", "2026-11-20T09:22:10.000Z"],
  ])("parses %s", (input, expected) => {
    expect(parseTime(input)?.toISOString()).toBe(expected);
  });

  it("rejects text that is not a date", () => {
    expect(parseTime("pass")).toBeUndefined();
    expect(parseTime("31.13.2026")).toBeUndefined();
  });
});

describe("LogParser", () => {
  it("reads Windows DNS debug logs and keeps only client queries", () => {
    const events = parseAll([
      "DNS Server log file creation at 11/20/2026 9:00:00 AM",
      "11/20/2026 9:14:02 AM 0A3C PACKET  000001D2 UDP Rcv 10.0.4.17       a1b2   Q [0001   D   NOERROR] A      (13)crm-dashboard(7)lovable(3)app(0)",
      "11/20/2026 9:14:02 AM 0A3C PACKET  000001D3 UDP Snd 10.0.0.1        77c1   Q [0001   D   NOERROR] A      (13)crm-dashboard(7)lovable(3)app(0)",
      "11/20/2026 9:14:02 AM 0A3C PACKET  000001D4 UDP Snd 10.0.4.17       a1b2 R Q [8081   DR  NOERROR] A      (13)crm-dashboard(7)lovable(3)app(0)",
    ]);

    expect(events).toEqual([
      {
        hosts: ["crm-dashboard.lovable.app"],
        client: "10.0.4.17",
        time: new Date("2026-11-20T09:14:02Z"),
      },
    ]);
  });

  it("reads Squid native access logs", () => {
    expect(
      parseAll([
        "1763630000.123    512 10.0.4.22 TCP_TUNNEL/200 3401 CONNECT lovable.dev:443 - HIER_DIRECT/203.0.113.4 -",
      ]),
    ).toEqual([{ hosts: ["lovable.dev"], client: "10.0.4.22", time: new Date(1763630000123) }]);
  });

  it("reads key=value firewall syslog", () => {
    expect(
      parseAll([
        '<189>date=2026-11-20 time=09:22:10 devname="fw01" srcip=10.0.4.30 user="anna" hostname="crm-dashboard.lovable.app" url="/login" action="passthrough"',
      ]),
    ).toEqual([
      {
        hosts: ["crm-dashboard.lovable.app"],
        client: "anna",
        time: new Date("2026-11-20T09:22:10Z"),
      },
    ]);
  });

  it("reads JSON lines, including nested fields", () => {
    expect(
      parseAll([
        '{"Datetime":"2026-11-20T09:20:00Z","QueryName":"8c1f2e.frame.claudeusercontent.com","Email":"ben@example.com","SrcIP":"10.0.4.40"}',
        '{"timestamp":1763630000,"user":{"email":"cara@example.com"},"request":{"host":"invoice.vercel.app"}}',
      ]),
    ).toEqual([
      {
        hosts: ["8c1f2e.frame.claudeusercontent.com"],
        client: "ben@example.com",
        time: new Date("2026-11-20T09:20:00Z"),
      },
      { hosts: ["invoice.vercel.app"], client: "cara@example.com", time: new Date(1763630000000) },
    ]);
  });

  it("finds a CSV header below a report preamble", () => {
    expect(
      parseAll([
        "Report generated,2026-11-20",
        "",
        "Logged Time,User,URL,Action",
        '"Fri Nov 20 09:30:00 2026",dana@example.com,"https://team-wiki.netlify.app/",Allowed',
      ]),
    ).toEqual([
      {
        hosts: ["team-wiki.netlify.app"],
        client: "dana@example.com",
        time: new Date("2026-11-20T09:30:00Z"),
      },
    ]);
  });

  it("reads semicolon CSV with a byte order mark and quoted delimiters", () => {
    expect(
      parseAll(["﻿Timestamp;DeviceName;Host", '2026-11-20T10:00:00Z;"LAPTOP;7";app.base44.app']),
    ).toEqual([
      { hosts: ["app.base44.app"], client: "LAPTOP;7", time: new Date("2026-11-20T10:00:00Z") },
    ]);
  });

  it("falls back to hostnames in free text", () => {
    expect(parseAll(["something happened with demo.pages.dev today"])).toEqual([
      { hosts: ["demo.pages.dev"], client: undefined, time: undefined },
    ]);
  });
});
