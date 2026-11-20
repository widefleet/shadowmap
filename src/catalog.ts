import { normalizeHost } from "./hosts.ts";
import { platforms as builtinPlatforms } from "./platforms.ts";

/**
 * - `builder`: someone builds an app on the platform
 * - `hosted_app`: someone uses a deployed app
 * - `backend`: backend service that generated apps commonly use
 */
export type Kind = "builder" | "hosted_app" | "backend";

export const kinds: readonly Kind[] = ["builder", "hosted_app", "backend"];

export interface Signal {
  readonly kind: Kind;
  readonly domains: readonly string[];
}

export interface Platform {
  readonly id: string;
  readonly name: string;
  readonly url: string;
  readonly signals: readonly Signal[];
}

export interface HostMatch {
  readonly platform: Platform;
  readonly kind: Kind;
  /** Catalog domain that matched, e.g. `lovable.app`. */
  readonly domain: string;
  /**
   * App or project name for `hosted_app` and `backend` matches: everything
   * left of the catalog domain, so `api.acme.workers.dev` keeps the worker
   * name `api` and the account `acme`. Undefined when the host is the
   * catalog domain itself.
   */
  readonly instance: string | undefined;
}

interface IndexEntry {
  readonly platform: Platform;
  readonly kind: Kind;
}

export class Catalog {
  readonly platforms: readonly Platform[];
  readonly #index = new Map<string, IndexEntry>();

  constructor(platforms: readonly Platform[]) {
    const ids = new Set<string>();

    for (const platform of platforms) {
      if (ids.has(platform.id)) {
        throw new Error(`Duplicate platform id "${platform.id}"`);
      }

      ids.add(platform.id);

      for (const signal of platform.signals) {
        for (const domain of signal.domains) {
          if (normalizeHost(domain) !== domain) {
            throw new Error(
              `Domain "${domain}" in "${platform.id}" must be a lowercase hostname without wildcard or trailing dot`,
            );
          }

          const existing = this.#index.get(domain);

          if (existing !== undefined) {
            throw new Error(
              `Domain "${domain}" is listed in both "${existing.platform.id}" and "${platform.id}"`,
            );
          }

          this.#index.set(domain, { platform, kind: signal.kind });
        }
      }
    }

    this.platforms = platforms;
  }

  /** All catalog domains, sorted. */
  domains(): string[] {
    return [...this.#index.keys()].toSorted();
  }

  /**
   * Matches whole DNS labels from the longest suffix down, so
   * `x.frame.claudeusercontent.com` can be listed apart from a shorter parent
   * and `evillovable.app` never matches `lovable.app`.
   */
  match(host: string): HostMatch | undefined {
    const normalized = normalizeHost(host);

    if (normalized === undefined) {
      return undefined;
    }

    let start = 0;

    while (start < normalized.length) {
      const domain = normalized.slice(start);
      const entry = this.#index.get(domain);

      if (entry !== undefined) {
        const hasInstance = start > 0 && (entry.kind === "hosted_app" || entry.kind === "backend");

        return {
          platform: entry.platform,
          kind: entry.kind,
          domain,
          instance: hasInstance ? normalized.slice(0, start - 1) : undefined,
        };
      }

      const dot = normalized.indexOf(".", start);

      if (dot === -1) {
        return undefined;
      }

      start = dot + 1;
    }

    return undefined;
  }
}

export const defaultCatalog = new Catalog(builtinPlatforms);
