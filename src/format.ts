import type { Kind } from "./catalog.ts";
import type { Report } from "./report.ts";
import { dayOf } from "./time.ts";

const kindLabels: Readonly<Record<Kind, string>> = {
  builder: "builds apps",
  hosted_app: "hosted apps",
  backend: "app backend",
};

/** Plain-text summary for the terminal. */
export function formatReport(report: Report): string {
  if (report.findings.length === 0) {
    return `No vibe-coding platforms or apps found in ${report.lines} lines.\n`;
  }

  // Every row has events, so zero devices means its log lines named none.
  const clients = (count: number): string => (count === 0 ? "?" : String(count));

  const unknownClients =
    report.totals.some((total) => total.clients === 0) ||
    report.findings.some((finding) => finding.clients.length === 0);

  const output: string[] = [];

  output.push(
    table(
      ["PLATFORM", "ACTIVITY", "APPS", "DEVICES", "DAYS", "EVENTS"],
      report.totals.map((total) => [
        total.platform.name,
        kindLabels[total.kind],
        total.kind === "hosted_app" || total.kind === "backend" ? String(total.apps) : "-",
        clients(total.clients),
        String(total.days),
        String(total.events),
      ]),
    ),
  );

  const apps = report.findings.filter((finding) => finding.instance !== undefined);

  if (apps.length > 0) {
    output.push(
      table(
        ["APP", "PLATFORM", "DEVICES", "DAYS", "FIRST SEEN", "LAST SEEN"],
        apps.map((finding) => [
          finding.host,
          finding.platform.name,
          clients(finding.clients.length),
          String(finding.days),
          finding.firstSeen === undefined ? "-" : dayOf(finding.firstSeen),
          finding.lastSeen === undefined ? "-" : dayOf(finding.lastSeen),
        ]),
      ),
    );
  }

  const summary = `Scanned ${report.lines} lines, ${report.events} matching events.`;

  output.push(
    unknownClients
      ? `${summary} Devices show as "?" where the logs name no device, user or client IP.`
      : summary,
  );

  return `${output.join("\n\n")}\n`;
}

/** JSON view of a report with platform ids instead of full catalog entries. */
export function reportJson(report: Report) {
  return {
    lines: report.lines,
    events: report.events,
    eventsWithClient: report.eventsWithClient,
    totals: report.totals.map((total) => ({ ...total, platform: total.platform.id })),
    findings: report.findings.map((finding) => ({
      ...finding,
      platform: finding.platform.id,
      firstSeen: finding.firstSeen?.toISOString(),
      lastSeen: finding.lastSeen?.toISOString(),
    })),
  };
}

function table(headers: readonly string[], rows: readonly (readonly string[])[]): string {
  const widths = headers.map((header, column) =>
    Math.max(header.length, ...rows.map((row) => row[column]?.length ?? 0)),
  );

  const render = (cells: readonly string[]): string =>
    cells
      .map((cell, column) => cell.padEnd(widths[column] ?? 0))
      .join("  ")
      .trimEnd();

  return [render(headers), ...rows.map((row) => render(row))].join("\n");
}
