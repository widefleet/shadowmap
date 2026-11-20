import type { Catalog } from "./catalog.ts";
import { defaultCatalog } from "./catalog.ts";

/** Microsoft Sentinel keeps 90 days of data at no extra retention cost. */
export const sentinelMaxDays = 90;

/**
 * KQL query for Microsoft Sentinel or a Log Analytics workspace with the
 * Advanced Security Information Model (ASIM). `_Im_Dns` and `_Im_WebSession`
 * normalize DNS and web logs from the connected firewalls, proxies and DNS
 * servers, so one query covers every source the workspace collects.
 * `isfuzzy` skips a parser that has no data. Columns are renamed to names
 * shadowmap reads, and the time is formatted explicitly because exported
 * column headers and date formats vary.
 */
export function sentinelQuery(days: number, catalog: Catalog = defaultCatalog): string {
  const domains = catalog
    .domains()
    .map((domain) => `"${domain}"`)
    .join(", ");

  return [
    `let domains = dynamic([${domains}]);`,
    `let start = ago(${days}d);`,
    "union isfuzzy=true",
    "    (_Im_Dns(starttime=start) | project TimeGenerated, Target = DnsQuery, SrcUsername, SrcHostname, SrcIpAddr),",
    "    (_Im_WebSession(starttime=start) | project TimeGenerated, Target = coalesce(HttpHost, DstFQDN, Url), SrcUsername, SrcHostname, SrcIpAddr)",
    "| where Target has_any (domains)",
    '| extend Host = tolower(trim_end(@"\\.", extract(@"^(?:[a-z][a-z0-9+.-]*://)?([^/:?#]+)", 1, Target)))',
    "| extend Client = coalesce(SrcUsername, SrcHostname, SrcIpAddr)",
    "| summarize Timestamp = min(TimeGenerated) by Client, Host, Day = bin(TimeGenerated, 1d)",
    '| project Timestamp = format_datetime(Timestamp, "yyyy-MM-dd HH:mm:ss"), User = Client, Host',
    "| order by Timestamp asc",
  ].join("\n");
}
