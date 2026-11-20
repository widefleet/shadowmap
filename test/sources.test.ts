import { describe, expect, it } from "vitest";

import { LogParser, cloudflareQuery } from "../src/index.ts";

// Synthetic exports using the column names each vendor documents.

interface CloudflareRequest {
  readonly variables: {
    readonly account: string;
    readonly since: string;
    readonly dns: readonly unknown[];
    readonly network: readonly unknown[];
  };
}

function parseAll(lines: readonly string[]) {
  const parser = new LogParser();

  return lines.flatMap((line) => parser.parse(line) ?? []);
}

describe("vendor exports", () => {
  it("reads a Zscaler Web Insights CSV export", () => {
    expect(
      parseAll([
        "Logged Time,Event Time,User,Device Hostname,Client IP,URL,Action",
        '"Fri Nov 20 09:30:05 2026","Fri Nov 20 09:30:00 2026",anna@example.com,LAPTOP-17,10.0.4.17,crm-dashboard.lovable.app/login,Allowed',
      ]),
    ).toEqual([
      {
        hosts: ["crm-dashboard.lovable.app"],
        client: "LAPTOP-17",
        time: new Date("2026-11-20T09:30:00Z"),
      },
    ]);
  });

  it("reads a Netskope page events CSV export", () => {
    expect(
      parseAll([
        "Time,Username,Host Name,Source IP Address,Site,Domain,URL",
        "2026-11-20 09:40:00,ben@example.com,LAPTOP-22,10.0.4.22,Vercel,invoice-helper.vercel.app,https://invoice-helper.vercel.app/",
      ]),
    ).toEqual([
      {
        hosts: ["invoice-helper.vercel.app"],
        client: "ben@example.com",
        time: new Date("2026-11-20T09:40:00Z"),
      },
    ]);
  });

  it("reads Cloudflare Gateway DNS and HTTP Logpush lines", () => {
    expect(
      parseAll([
        '{"Datetime":"2026-11-20T09:50:00Z","QueryName":"team-wiki.pages.dev.","SrcIP":"10.0.4.30","Email":"cara@example.com","DeviceName":"MBP-cara"}',
        '{"Datetime":"2026-11-20T09:51:00Z","HTTPHost":"bolt.new","URL":"https://bolt.new/","SourceIP":"10.0.4.31","Email":"non_identity@acme.cloudflareaccess.com","DeviceName":""}',
      ]),
    ).toEqual([
      {
        hosts: ["team-wiki.pages.dev"],
        client: "MBP-cara",
        time: new Date("2026-11-20T09:50:00Z"),
      },
      { hosts: ["bolt.new"], client: "10.0.4.31", time: new Date("2026-11-20T09:51:00Z") },
    ]);
  });

  it("reads Cloudflare GraphQL analytics rows as printed by jq", () => {
    expect(
      parseAll([
        '{"count":42,"dimensions":{"date":"2026-11-19","queryName":"team-wiki.pages.dev"}}',
        '{"count":5,"dimensions":{"date":"2026-11-19","sni":"bolt.new","email":"cara@example.com","sourceIp":"203.0.113.30"}}',
        '{"count":2,"dimensions":{"date":"2026-11-19","sni":"x.vercel.app","email":"","sourceIp":"203.0.113.31"}}',
      ]),
    ).toEqual([
      { hosts: ["team-wiki.pages.dev"], client: undefined, time: new Date("2026-11-19T00:00:00Z") },
      { hosts: ["bolt.new"], client: "cara@example.com", time: new Date("2026-11-19T00:00:00Z") },
      { hosts: ["x.vercel.app"], client: "203.0.113.31", time: new Date("2026-11-19T00:00:00Z") },
    ]);
  });

  it("builds a Cloudflare GraphQL request for every catalog domain", () => {
    // SAFETY: cloudflareQuery serializes exactly this shape.
    const { variables } = JSON.parse(
      cloudflareQuery("abc123", 30, new Date("2026-11-20T12:00:00Z")),
    ) as CloudflareRequest;

    expect(variables.account).toBe("abc123");
    expect(variables.since).toBe("2026-10-21T13:00:00.000Z");
    expect(variables.dns).toContainEqual({ queryName_like: "%lovable.app%" });
    expect(variables.network).toContainEqual({ sni_like: "%bolt.new%" });
  });

  it("reads a Defender result saved as CSV from Excel with German settings", () => {
    expect(
      parseAll([
        "﻿Timestamp;DeviceName;Host",
        "20.11.2026 09:14;laptop-17.corp.example.com;crm-dashboard.lovable.app",
      ]),
    ).toEqual([
      {
        hosts: ["crm-dashboard.lovable.app"],
        client: "laptop-17.corp.example.com",
        time: new Date("2026-11-20T09:14:00Z"),
      },
    ]);
  });

  it("reads FortiGate web filter and DNS logs", () => {
    expect(
      parseAll([
        'date=2026-11-20 time=09:34:31 eventtime=1795167271720798942 tz="+0100" logid="0316013056" type="utm" subtype="webfilter" eventtype="ftgd_allow" srcip=10.1.100.123 srcmac="00:0c:29:06:7e:5b" srcname="PC-ANNA" unauthuser="anna" hostname="crm-dashboard.lovable.app" url="https://crm-dashboard.lovable.app/" action="passthrough"',
        'date=2026-11-20 time=09:35:02 logid="1501054802" type="utm" subtype="dns" srcip=10.1.100.22 qname="team-wiki.chatgpt.site" qtype="A" action="pass"',
      ]),
    ).toEqual([
      {
        hosts: ["crm-dashboard.lovable.app"],
        client: "PC-ANNA",
        time: new Date("2026-11-20T09:34:31Z"),
      },
      {
        hosts: ["team-wiki.chatgpt.site"],
        client: "10.1.100.22",
        time: new Date("2026-11-20T09:35:02Z"),
      },
    ]);
  });

  it("reads Sophos Firewall logs without taking the firewall for the client", () => {
    expect(
      parseAll([
        'device="SFW" date=2026-11-20 time=09:30:33 timezone="CET" device_name="SFVUNL" device_id=C01001K234RXPA1 log_id=050902616002 log_type="Content Filtering" log_component="HTTP" log_subtype="Allowed" user_name="anna" src_ip=192.168.73.220 dst_ip=208.69.252.169 url="https://planner.vercel.app/" domain=planner.vercel.app',
        'device_name="SFW" timestamp="2026-11-20T09:39:43+0100" device_model="XGS2100" device_serial_id="X21000ABC" log_id="123" log_type="SSL" log_subtype="Do not decrypt" src_ip="10.146.6.42" sni="notes.pages.dev"',
      ]),
    ).toEqual([
      {
        hosts: ["planner.vercel.app"],
        client: "anna",
        time: new Date("2026-11-20T09:30:33Z"),
      },
      {
        hosts: ["notes.pages.dev"],
        client: "10.146.6.42",
        time: new Date("2026-11-20T08:39:43Z"),
      },
    ]);
  });

  it("reads a Windows DNS debug log line with a 64-bit packet id", () => {
    expect(
      parseAll([
        "8/24/2026 10:42:15 PM 1A2 PACKET  0000026E3A1F3D20 UDP Rcv 10.0.0.15       c0de   Q [0001   D   NOERROR] A      (3)app(4)fly(3)dev(0)",
      ]),
    ).toEqual([
      { hosts: ["app.fly.dev"], client: "10.0.0.15", time: new Date("2026-08-24T22:42:15Z") },
    ]);
  });
});
