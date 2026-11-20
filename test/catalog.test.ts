import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { Catalog, defaultCatalog, defenderQuery } from "../src/index.ts";
import { version } from "../src/version.ts";

describe("Catalog", () => {
  it("matches subdomains on label boundaries only", () => {
    expect(defaultCatalog.match("My-Tool.Lovable.App.")).toMatchObject({
      platform: { id: "lovable" },
      kind: "hosted_app",
      domain: "lovable.app",
      instance: "my-tool",
    });
    expect(defaultCatalog.match("evillovable.app")).toBeUndefined();
    expect(defaultCatalog.match("example.com")).toBeUndefined();
  });

  it("names the app by the full host left of the platform domain", () => {
    expect(defaultCatalog.match("preview.team-app.vercel.app")?.instance).toBe("preview.team-app");
    expect(defaultCatalog.match("status-worker.acme.workers.dev")?.instance).toBe(
      "status-worker.acme",
    );
    expect(defaultCatalog.match("abcd1234.supabase.co")).toMatchObject({
      kind: "backend",
      instance: "abcd1234",
    });
  });

  it("reports builders without an app name", () => {
    expect(defaultCatalog.match("www.lovable.dev")).toMatchObject({
      kind: "builder",
      instance: undefined,
    });
  });

  it("finds ChatGPT Sites and ignores ChatGPT itself", () => {
    expect(defaultCatalog.match("team-wiki.chatgpt.site")).toMatchObject({
      platform: { id: "chatgpt" },
      kind: "hosted_app",
      instance: "team-wiki",
    });
    expect(defaultCatalog.match("chatgpt.com")).toBeUndefined();
    expect(defaultCatalog.match("claude.ai")).toBeUndefined();
  });

  it("prefers the longest catalog domain", () => {
    expect(defaultCatalog.match("0f3a.frame.claudeusercontent.com")).toMatchObject({
      platform: { id: "claude" },
      domain: "frame.claudeusercontent.com",
      instance: "0f3a",
    });
    expect(defaultCatalog.match("www.claudeusercontent.com")).toBeUndefined();
  });

  it("rejects a domain listed twice", () => {
    expect(
      () =>
        new Catalog([
          {
            id: "a",
            name: "A",
            url: "https://a.test",
            signals: [{ kind: "builder", domains: ["x.dev"] }],
          },
          {
            id: "b",
            name: "B",
            url: "https://b.test",
            signals: [{ kind: "builder", domains: ["x.dev"] }],
          },
        ]),
    ).toThrow('listed in both "a" and "b"');
  });

  it("rejects wildcards and uppercase domains", () => {
    expect(
      () =>
        new Catalog([
          {
            id: "a",
            name: "A",
            url: "https://a.test",
            signals: [{ kind: "hosted_app", domains: ["*.x.app"] }],
          },
        ]),
    ).toThrow("lowercase hostname");
    expect(
      () =>
        new Catalog([
          {
            id: "a",
            name: "A",
            url: "https://a.test",
            signals: [{ kind: "hosted_app", domains: ["X.app"] }],
          },
        ]),
    ).toThrow("lowercase hostname");
  });
});

describe("defenderQuery", () => {
  it("filters on every catalog domain for the requested days", () => {
    const query = defenderQuery(14);

    expect(query).toContain("ago(14d)");

    for (const domain of defaultCatalog.domains()) {
      expect(query).toContain(`"${domain}"`);
    }
  });
});

describe("version", () => {
  it("matches package.json", async () => {
    const manifest = await readFile(new URL("../package.json", import.meta.url), "utf8");

    expect(manifest).toContain(`"version": "${version}"`);
  });
});
