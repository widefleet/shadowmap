import type { Catalog, Kind, Platform } from "./catalog.ts";
import { kinds } from "./catalog.ts";
import type { LogEvent } from "./parse.ts";
import { dayOf } from "./time.ts";

/** One platform signal, or one app or project on a hosting platform. */
export interface Finding {
  readonly platform: Platform;
  readonly kind: Kind;
  /** App or project name for hosted apps and backends. */
  readonly instance: string | undefined;
  /** Hostname as seen in the logs, e.g. `crm-dashboard.lovable.app`. */
  readonly host: string;
  readonly events: number;
  /** Distinct devices, users or client IPs. */
  readonly clients: readonly string[];
  readonly days: number;
  readonly firstSeen: Date | undefined;
  readonly lastSeen: Date | undefined;
}

/** Totals per platform and kind, e.g. Lovable hosted apps: 23 apps on 12 devices. */
export interface PlatformTotal {
  readonly platform: Platform;
  readonly kind: Kind;
  readonly apps: number;
  readonly clients: number;
  readonly days: number;
  readonly events: number;
}

export interface Report {
  readonly lines: number;
  readonly events: number;
  /** Events whose log line named a device, user or client IP. */
  readonly eventsWithClient: number;
  readonly totals: readonly PlatformTotal[];
  readonly findings: readonly Finding[];
}

interface Tally {
  readonly platform: Platform;
  readonly kind: Kind;
  readonly instance: string | undefined;
  readonly host: string;
  events: number;
  readonly clients: Set<string>;
  readonly days: Set<string>;
  firstSeen: Date | undefined;
  lastSeen: Date | undefined;
}

export class ReportBuilder {
  readonly #catalog: Catalog;
  readonly #tallies = new Map<string, Tally>();
  #lines = 0;
  #events = 0;
  #eventsWithClient = 0;

  constructor(catalog: Catalog) {
    this.#catalog = catalog;
  }

  countLine(): void {
    this.#lines += 1;
  }

  add(event: LogEvent): void {
    const keys = new Set<string>();

    for (const host of event.hosts) {
      const match = this.#catalog.match(host);

      if (match === undefined) {
        continue;
      }

      const key = `${match.platform.id}\u0000${match.kind}\u0000${match.instance ?? ""}`;

      // A line that names the same app twice (query and CNAME) is one event.
      if (keys.has(key)) {
        continue;
      }

      keys.add(key);

      const tally = this.#tallies.get(key) ?? {
        platform: match.platform,
        kind: match.kind,
        instance: match.instance,
        host: match.instance === undefined ? match.domain : `${match.instance}.${match.domain}`,
        events: 0,
        clients: new Set<string>(),
        days: new Set<string>(),
        firstSeen: undefined,
        lastSeen: undefined,
      };

      tally.events += 1;

      if (event.client !== undefined) {
        tally.clients.add(event.client.toLowerCase());
      }

      if (event.time !== undefined) {
        tally.days.add(dayOf(event.time));

        if (tally.firstSeen === undefined || event.time < tally.firstSeen) {
          tally.firstSeen = event.time;
        }

        if (tally.lastSeen === undefined || event.time > tally.lastSeen) {
          tally.lastSeen = event.time;
        }
      }

      this.#tallies.set(key, tally);
    }

    if (keys.size > 0) {
      this.#events += 1;

      if (event.client !== undefined) {
        this.#eventsWithClient += 1;
      }
    }
  }

  build(): Report {
    const tallies = [...this.#tallies.values()].toSorted(
      (left, right) =>
        kinds.indexOf(left.kind) - kinds.indexOf(right.kind) ||
        right.clients.size - left.clients.size ||
        right.events - left.events ||
        left.host.localeCompare(right.host),
    );

    return {
      lines: this.#lines,
      events: this.#events,
      eventsWithClient: this.#eventsWithClient,
      totals: totalsOf(tallies),
      findings: tallies.map((tally) => ({
        platform: tally.platform,
        kind: tally.kind,
        instance: tally.instance,
        host: tally.host,
        events: tally.events,
        clients: [...tally.clients].toSorted(),
        days: tally.days.size,
        firstSeen: tally.firstSeen,
        lastSeen: tally.lastSeen,
      })),
    };
  }
}

interface Total {
  readonly platform: Platform;
  readonly kind: Kind;
  apps: number;
  readonly clients: Set<string>;
  readonly days: Set<string>;
  events: number;
}

function totalsOf(tallies: readonly Tally[]): PlatformTotal[] {
  const totals = new Map<string, Total>();

  for (const tally of tallies) {
    const key = `${tally.platform.id}\u0000${tally.kind}`;

    const total = totals.get(key) ?? {
      platform: tally.platform,
      kind: tally.kind,
      apps: 0,
      clients: new Set<string>(),
      days: new Set<string>(),
      events: 0,
    };

    if (tally.instance !== undefined) {
      total.apps += 1;
    }

    for (const client of tally.clients) {
      total.clients.add(client);
    }

    for (const day of tally.days) {
      total.days.add(day);
    }

    total.events += tally.events;
    totals.set(key, total);
  }

  return [...totals.values()]
    .map((total) => ({
      platform: total.platform,
      kind: total.kind,
      apps: total.apps,
      clients: total.clients.size,
      days: total.days.size,
      events: total.events,
    }))
    .toSorted(
      (left, right) =>
        kinds.indexOf(left.kind) - kinds.indexOf(right.kind) ||
        right.clients - left.clients ||
        right.events - left.events,
    );
}
