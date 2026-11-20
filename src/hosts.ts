const LABEL = /^[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?$/;

const NON_HOST_CHARACTERS = /[^A-Za-z0-9._-]+/;

const DNS_WIRE_LENGTH = /\(\d+\)/g;

/** Lowercases, strips one trailing dot and rejects anything that is not a DNS name with at least two labels. */
export function normalizeHost(value: string): string | undefined {
  const host = (value.endsWith(".") ? value.slice(0, -1) : value).toLowerCase();

  if (host.length === 0 || host.length > 253) {
    return undefined;
  }

  const labels = host.split(".");

  if (labels.length < 2 || !labels.every((label) => LABEL.test(label))) {
    return undefined;
  }

  return host;
}

/**
 * Finds hostname candidates in free text: URLs, `host:port`, CSV cells,
 * JSON strings and key=value pairs all split on characters that cannot be
 * part of a hostname.
 */
export function hostsIn(text: string): string[] {
  const hosts = new Set<string>();

  for (const token of text.split(NON_HOST_CHARACTERS)) {
    if (!token.includes(".")) {
      continue;
    }

    const host = normalizeHost(token.replace(/^[.-]+/, "").replace(/-+$/, ""));

    if (host !== undefined) {
      hosts.add(host);
    }
  }

  return [...hosts];
}

/**
 * Windows DNS debug logs write names in wire format with length prefixes:
 * `(7)my-tool(7)lovable(3)app(0)` becomes `.my-tool.lovable.app.`.
 */
export function decodeDnsWireName(text: string): string {
  return text.replaceAll(DNS_WIRE_LENGTH, ".");
}
