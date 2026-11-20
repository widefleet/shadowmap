import type { Catalog } from "./catalog.ts";
import { defaultCatalog } from "./catalog.ts";

/**
 * Gateway DNS and network analytics reach back 31 days, and network queries
 * span at most 30.
 */
export const cloudflareMaxDays = 30;

const MILLISECONDS_PER_DAY = 86_400_000;

// Network queries may span exactly 30 days when they arrive, so start an hour
// later than asked for.
const START_MARGIN_MILLISECONDS = 3_600_000;

// Each dataset returns at most this many rows per request.
const ROW_LIMIT = 10_000;

const QUERY = `query ($account: String!, $since: Time!, $dns: [AccountGatewayResolverQueriesAdaptiveGroupsFilter_InputObject!], $network: [AccountGatewayL4SessionsAdaptiveGroupsFilter_InputObject!]) {
  viewer {
    accounts(filter: { accountTag: $account }) {
      dns: gatewayResolverQueriesAdaptiveGroups(limit: ${ROW_LIMIT}, filter: { datetime_geq: $since, OR: $dns }, orderBy: [date_ASC]) {
        count
        dimensions { date queryName }
      }
      network: gatewayL4SessionsAdaptiveGroups(limit: ${ROW_LIMIT}, filter: { datetime_geq: $since, OR: $network }, orderBy: [date_ASC]) {
        count
        dimensions { date sni email sourceIp }
      }
    }
  }
}`;

/**
 * Request body for Cloudflare's GraphQL Analytics API that returns Gateway DNS
 * queries (domain and day, no user) and Gateway network sessions (TLS server
 * name, user and day, without TLS decryption) for the catalog's domains. The
 * `like` filters also let through hosts such as `lovable.app.example.com`;
 * shadowmap matches exactly when it scans the result.
 */
export function cloudflareQuery(
  account: string,
  days: number,
  now: Date = new Date(),
  catalog: Catalog = defaultCatalog,
): string {
  const patterns = catalog.domains().map((domain) => `%${domain}%`);

  return JSON.stringify({
    query: QUERY,
    variables: {
      account,
      since: new Date(
        now.getTime() - days * MILLISECONDS_PER_DAY + START_MARGIN_MILLISECONDS,
      ).toISOString(),
      dns: patterns.map((pattern) => ({ queryName_like: pattern })),
      network: patterns.map((pattern) => ({ sni_like: pattern })),
    },
  });
}
