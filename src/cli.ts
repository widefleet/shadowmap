#!/usr/bin/env node
import { createReadStream } from "node:fs";
import { open, readFile } from "node:fs/promises";
import { parseArgs } from "node:util";

import { defaultCatalog } from "./catalog.ts";
import { cloudflareMaxDays, cloudflareQuery } from "./cloudflare.ts";
import { defenderMaxDays, defenderQuery } from "./defender.ts";
import { formatReport, reportJson } from "./format.ts";
import { Scanner, linesOf } from "./scan.ts";
import { version } from "./version.ts";
import { isZip, xlsxLines } from "./xlsx.ts";

const usage = `Usage:
  shadowmap scan [file ...] [--json]   Scan log files or .xlsx exports, or stdin when no file is given
  shadowmap defender-query [--days N]  Print the Microsoft Defender Advanced Hunting query
  shadowmap cloudflare-query --account ID [--days N]
                                       Print the Cloudflare Gateway GraphQL request body
  shadowmap catalog [--json]           List known platforms and domains

Options:
  --json        Print machine-readable JSON
  --days N      Days of history, 1 to 30 (default 7)
  --account ID  Cloudflare account ID for cloudflare-query
  -h, --help    Show this help
  -v, --version Show the version`;

async function main(argv: readonly string[]): Promise<number> {
  const { positionals, values } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    options: {
      json: { type: "boolean", default: false },
      days: { type: "string", default: "7" },
      account: { type: "string" },
      help: { type: "boolean", short: "h", default: false },
      version: { type: "boolean", short: "v", default: false },
    },
  });

  if (values.version) {
    process.stdout.write(`${version}\n`);

    return 0;
  }

  const [command, ...files] = positionals;

  if (values.help || command === undefined) {
    process.stdout.write(`${usage}\n`);

    return values.help ? 0 : 1;
  }

  switch (command) {
    case "scan": {
      const scanner = new Scanner();
      const inputs = files.length === 0 ? ["-"] : files;

      for (const file of inputs) {
        if (file === "-") {
          await scanner.scan(linesOf(process.stdin));
        } else if (await startsLikeZip(file)) {
          await scanner.scan(await xlsxLines(await readFile(file)));
        } else {
          await scanner.scan(linesOf(createReadStream(file)));
        }
      }

      const report = scanner.report();

      process.stdout.write(
        values.json
          ? `${JSON.stringify(reportJson(report), undefined, 2)}\n`
          : formatReport(report),
      );

      return 0;
    }

    case "defender-query": {
      const days = Number(values.days);

      if (!Number.isInteger(days) || days < 1 || days > defenderMaxDays) {
        process.stderr.write(`--days must be a whole number from 1 to ${defenderMaxDays}\n`);

        return 1;
      }

      process.stdout.write(`${defenderQuery(days)}\n`);

      return 0;
    }

    case "cloudflare-query": {
      const days = Number(values.days);

      if (values.account === undefined || values.account === "") {
        process.stderr.write("--account is required\n");

        return 1;
      }

      if (!Number.isInteger(days) || days < 1 || days > cloudflareMaxDays) {
        process.stderr.write(`--days must be a whole number from 1 to ${cloudflareMaxDays}\n`);

        return 1;
      }

      process.stdout.write(`${cloudflareQuery(values.account, days)}\n`);

      return 0;
    }

    case "catalog": {
      if (values.json) {
        process.stdout.write(`${JSON.stringify(defaultCatalog.platforms, undefined, 2)}\n`);

        return 0;
      }

      for (const platform of defaultCatalog.platforms) {
        for (const signal of platform.signals) {
          process.stdout.write(
            `${platform.name.padEnd(30)} ${signal.kind.padEnd(11)} ${signal.domains.join(", ")}\n`,
          );
        }
      }

      return 0;
    }

    default: {
      process.stderr.write(`Unknown command "${command}"\n\n${usage}\n`);

      return 1;
    }
  }
}

async function startsLikeZip(path: string): Promise<boolean> {
  const file = await open(path);

  try {
    const { buffer, bytesRead } = await file.read(new Uint8Array(4), 0, 4, 0);

    return isZip(buffer.subarray(0, bytesRead));
  } finally {
    await file.close();
  }
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  process.stderr.write(`shadowmap: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
