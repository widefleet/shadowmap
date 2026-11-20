import type { Catalog } from "./catalog.ts";
import { defaultCatalog } from "./catalog.ts";

/** Advanced Hunting keeps 30 days of data. */
export const defenderMaxDays = 30;

/**
 * Advanced Hunting query for Microsoft Defender for Endpoint. `has_any` is a
 * fast term pre-filter that also lets through hosts like
 * `lovable.app.example.com`; shadowmap matches exactly when it scans the
 * export. One row per device, host and day keeps a week well under the
 * portal's 100,000-row limit.
 */
export function defenderQuery(days: number, catalog: Catalog = defaultCatalog): string {
  const domains = catalog
    .domains()
    .map((domain) => `"${domain}"`)
    .join(", ");

  return [
    `let domains = dynamic([${domains}]);`,
    "DeviceNetworkEvents",
    `| where Timestamp > ago(${days}d)`,
    "| where RemoteUrl has_any (domains)",
    '| extend Host = tolower(extract(@"^(?:[a-z][a-z0-9+.-]*://)?([^/:?#]+)", 1, RemoteUrl))',
    "| summarize Timestamp = min(Timestamp) by DeviceName, Host, Day = bin(Timestamp, 1d)",
    "| project Timestamp, DeviceName, Host",
    "| order by Timestamp asc",
  ].join("\n");
}
