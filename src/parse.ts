import { decodeDnsWireName, hostsIn } from "./hosts.ts";
import { parseTime } from "./time.ts";

/** One log entry reduced to what detection needs. */
export interface LogEvent {
  readonly hosts: readonly string[];
  /** Device, user or client IP, whichever the log provides first. */
  readonly client: string | undefined;
  readonly time: Date | undefined;
}

type Fields = ReadonlyMap<string, string>;

/**
 * Column and key names across Zscaler, Netskope, Cloudflare Gateway, Defender,
 * Cisco Umbrella, firewall syslog and generic exports, compared after lowercasing and removing
 * everything but letters and digits (`Query Name` -> `queryname`).
 */
const HOST_FIELDS = [
  "queryname",
  "query",
  "qname",
  "remoteurl",
  "url",
  "requesturl",
  "host",
  "httphost",
  "hostname",
  "domain",
  "fqdn",
  "dstdomain",
  "destinationhost",
  "sni",
  "servername",
  "destination",
] as const;

/** Ordered by preference: devices before users before IP addresses. */
const CLIENT_FIELDS = [
  "devicename",
  "srcname",
  "devicehostname",
  "device",
  "computername",
  "computer",
  "email",
  "useremail",
  "user",
  "username",
  "unauthuser",
  "userprincipalname",
  "upn",
  "accountname",
  "initiatingprocessaccountname",
  "mostgranularidentity",
  "policyidentitylabel",
  "policyorrulesetidentity",
  "policyidentity",
  "identity",
  "identities",
  "srcip",
  "sourceip",
  "clientip",
  "src",
  "sourceaddress",
  "sourceipaddress",
  "ipaddress",
  "clientaddress",
  "internalip",
  "internalclientip",
] as const;

const TIME_FIELDS = [
  "datetime",
  "timestamp",
  "time",
  "eventtime",
  "loggedtime",
  "timegenerated",
  "date",
  "ts",
  "starttime",
] as const;

const HEADER_SEARCH_LINES = 50;

const DELIMITERS = [",", ";", "\t"] as const;

const EMPTY_VALUES = new Set(["", "-", "null", "none", "n/a"]);

// Sophos Firewall names itself in `device` and `device_name`; its lines carry
// `log_type` and a device ID.
const FIREWALL_DEVICE_FIELDS: ReadonlySet<string> = new Set(["device", "devicename"]);

// Cloudflare Gateway logs traffic without a signed-in user under this address.
const ANONYMOUS_CLIENT = /^non_identity@/i;

const JSON_PAIR = /"([^"\\]+)"\s*:\s*("(?:[^"\\]|\\.)*"|-?\d[\d.eE+-]*|true|false|null)/g;

// Keys follow a space, the line start or a syslog priority such as `<189>`.
const KEY_VALUE_PAIR = /(?:^|[\s>])([A-Za-z_][\w.-]*)=("(?:[^"\\]|\\.)*"|\S*)/g;

const KEY_VALUE_MIN_PAIRS = 3;

const SQUID_NATIVE = /^(\d{9,10}\.\d{3})\s+\d+\s+(\S+)\s+\S+\s+\d+\s+\S+\s+(\S+)/;

const WINDOWS_DNS_PACKET =
  /^(\S+)\s+(\S+)(?:\s+(?:AM|PM))?\s+\S+\s+PACKET\s+\S+\s+(?:UDP|TCP)\s+(Rcv|Snd)\s+(\S+)\s+\S+\s+(R?)\s*Q\s+\[[^\]]*\]\s+\S+\s+(\S+)/;

const WINDOWS_DNS_TIME = /^(\S+\s+\S+(?:\s+(?:AM|PM))?)/;

interface CsvHeader {
  readonly delimiter: string;
  readonly columns: readonly string[];
}

/**
 * Turns log lines of any supported format into events. Keeps per-input state
 * for CSV headers, so use one parser per file.
 *
 * Returns undefined for lines without a hostname and for lines that carry no
 * client activity: headers and DNS server traffic other than client queries.
 */
export class LogParser {
  #header: CsvHeader | undefined;
  #lines = 0;

  parse(rawLine: string): LogEvent | undefined {
    const event = this.#parse(rawLine);

    return event === undefined || event.hosts.length === 0 ? undefined : event;
  }

  #parse(rawLine: string): LogEvent | undefined {
    this.#lines += 1;

    const line = (this.#lines === 1 ? rawLine.replace(/^\uFEFF/, "") : rawLine).trimEnd();

    if (line.length === 0) {
      return undefined;
    }

    if (this.#header !== undefined) {
      return eventFromFields(csvFields(line, this.#header));
    }

    if (line.startsWith("{")) {
      return eventFromFields(pairs(line, JSON_PAIR));
    }

    if (line.includes(" PACKET ")) {
      return windowsDnsEvent(line);
    }

    if (this.#lines <= HEADER_SEARCH_LINES) {
      const header = csvHeader(line);

      if (header !== undefined) {
        this.#header = header;

        return undefined;
      }
    }

    const squid = SQUID_NATIVE.exec(line);

    if (squid !== null) {
      const [, time = "", client, url = ""] = squid;

      return { hosts: hostsIn(url), client, time: parseTime(time) };
    }

    const keyValues = pairs(line, KEY_VALUE_PAIR);

    if (keyValues.size >= KEY_VALUE_MIN_PAIRS) {
      return eventFromFields(keyValues);
    }

    return { hosts: hostsIn(decodeDnsWireName(line)), client: undefined, time: undefined };
  }
}

/**
 * Windows DNS debug log, packet logging enabled. Only queries a client sent to
 * the server count; responses and the server's own queries to forwarders would
 * otherwise double-count or attribute lookups to the forwarder.
 */
function windowsDnsEvent(line: string): LogEvent | undefined {
  const packet = WINDOWS_DNS_PACKET.exec(line);

  if (packet === null) {
    return { hosts: hostsIn(decodeDnsWireName(line)), client: undefined, time: undefined };
  }

  const [, , , direction, client, response, name = ""] = packet;

  if (direction !== "Rcv" || response === "R") {
    return undefined;
  }

  const time = WINDOWS_DNS_TIME.exec(line)?.[1];

  return {
    hosts: hostsIn(decodeDnsWireName(name)),
    client,
    time: time === undefined ? undefined : parseTime(time),
  };
}

function eventFromFields(fields: Fields): LogEvent {
  const hostValues = HOST_FIELDS.flatMap((name) => valueOf(fields, name) ?? []);

  const hosts =
    hostValues.length > 0
      ? [...new Set(hostValues.flatMap((value) => hostsIn(value)))]
      : hostsIn([...fields.values()].join(" "));

  return {
    hosts,
    client: clientOf(fields),
    time: timeOf(fields),
  };
}

function timeOf(fields: Fields): Date | undefined {
  const date = valueOf(fields, "date");
  const time = valueOf(fields, "time");

  // Firewalls such as FortiGate split `date=2026-11-20 time=09:22:10`.
  if (date !== undefined && time !== undefined && /^\d{1,2}:\d{2}/.test(time)) {
    return parseTime(`${date} ${time}`);
  }

  const value = firstValue(fields, TIME_FIELDS);

  return value === undefined ? undefined : parseTime(value);
}

function clientOf(fields: Fields): string | undefined {
  const namesFirewall =
    fields.has("logtype") && (fields.has("deviceid") || fields.has("deviceserialid"));

  for (const name of CLIENT_FIELDS) {
    if (namesFirewall && FIREWALL_DEVICE_FIELDS.has(name)) {
      continue;
    }

    const value = valueOf(fields, name);

    if (value !== undefined && !ANONYMOUS_CLIENT.test(value)) {
      return value;
    }
  }

  return undefined;
}

function firstValue(fields: Fields, names: readonly string[]): string | undefined {
  for (const name of names) {
    const value = valueOf(fields, name);

    if (value !== undefined) {
      return value;
    }
  }

  return undefined;
}

function valueOf(fields: Fields, name: string): string | undefined {
  const value = fields.get(name)?.trim();

  return value === undefined || EMPTY_VALUES.has(value.toLowerCase()) ? undefined : value;
}

function fieldName(name: string): string {
  return name.toLowerCase().replaceAll(/[^a-z0-9]/g, "");
}

function pairs(line: string, pattern: RegExp): Fields {
  const fields = new Map<string, string>();

  for (const [, key = "", rawValue = ""] of line.matchAll(pattern)) {
    const name = fieldName(key.split(".").at(-1) ?? key);

    if (!fields.has(name)) {
      fields.set(name, unquote(rawValue));
    }
  }

  return fields;
}

function unquote(value: string): string {
  if (value.length < 2 || !value.startsWith('"') || !value.endsWith('"')) {
    return value;
  }

  return value.slice(1, -1).replaceAll(/\\(["\\/])/g, "$1");
}

/**
 * A header row names at least one host column and contains no hostnames
 * itself. Report exports often put a title or filter summary above it.
 */
function csvHeader(line: string): CsvHeader | undefined {
  const delimiter = DELIMITERS.map((candidate) => ({
    candidate,
    count: line.split(candidate).length - 1,
  })).toSorted((left, right) => right.count - left.count)[0];

  if (delimiter === undefined || delimiter.count === 0 || hostsIn(line).length > 0) {
    return undefined;
  }

  const columns = splitCsv(line, delimiter.candidate).map((column) => fieldName(column));
  const hostColumns: readonly string[] = HOST_FIELDS;

  return columns.some((column) => hostColumns.includes(column))
    ? { delimiter: delimiter.candidate, columns }
    : undefined;
}

function csvFields(line: string, header: CsvHeader): Fields {
  const fields = new Map<string, string>();
  const cells = splitCsv(line, header.delimiter);

  for (const [index, column] of header.columns.entries()) {
    const cell = cells[index];

    if (cell !== undefined && !fields.has(column)) {
      fields.set(column, cell);
    }
  }

  return fields;
}

/** RFC 4180 cells within one line; quoted line breaks are not supported. */
export function splitCsv(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];

    if (quoted) {
      if (character === '"' && line[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        cell += character;
      }
    } else if (character === '"' && cell.length === 0) {
      quoted = true;
    } else if (character === delimiter) {
      cells.push(cell);
      cell = "";
    } else {
      cell += character;
    }
  }

  cells.push(cell);

  return cells;
}
