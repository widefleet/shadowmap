const EPOCH_SECONDS = /^\d{9,10}(?:\.\d+)?$/;

const EPOCH_MILLISECONDS = /^\d{12,13}$/;

const DAY_FIRST_DOTTED = /^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:[ ,T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/;

const SLASHED =
  /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ ,T]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?/i;

/**
 * Parses the timestamp formats found in log exports: ISO 8601, epoch seconds
 * or milliseconds, `DD.MM.YYYY HH:MM:SS` and `M/D/YYYY h:mm:ss AM`. Slashed
 * dates are read month-first unless the first number cannot be a month.
 * Times without a zone are local time.
 */
export function parseTime(value: string): Date | undefined {
  const text = value.trim();

  if (text.length === 0) {
    return undefined;
  }

  if (EPOCH_SECONDS.test(text)) {
    return validDate(new Date(Number(text) * 1000));
  }

  if (EPOCH_MILLISECONDS.test(text)) {
    return validDate(new Date(Number(text)));
  }

  const dotted = DAY_FIRST_DOTTED.exec(text);

  if (dotted !== null) {
    const [, day, month, year, hour, minute, second] = dotted;

    return localDate([year, month, day, hour, minute, second]);
  }

  const slashed = SLASHED.exec(text);

  if (slashed !== null) {
    const [, first, second, year, hour, minute, seconds, meridiem] = slashed;
    const dayFirst = Number(first) > 12;
    const hours = to24Hour(Number(hour ?? 0), meridiem);

    return localDate([
      year,
      dayFirst ? second : first,
      dayFirst ? first : second,
      String(hours),
      minute,
      seconds,
    ]);
  }

  return validDate(new Date(text));
}

/** Calendar day in local time, `YYYY-MM-DD`. */
export function dayOf(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${date.getFullYear()}-${month}-${day}`;
}

function to24Hour(hour: number, meridiem: string | undefined): number {
  const upper = meridiem?.toUpperCase();

  if (upper === "PM" && hour < 12) {
    return hour + 12;
  }

  if (upper === "AM" && hour === 12) {
    return 0;
  }

  return hour;
}

function localDate(parts: readonly (string | undefined)[]): Date | undefined {
  const [year, month, day, hour, minute, second] = parts.map((part) => Number(part ?? 0));

  if (
    year === undefined ||
    month === undefined ||
    day === undefined ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    return undefined;
  }

  return validDate(new Date(year, month - 1, day, hour, minute, second));
}

function validDate(date: Date): Date | undefined {
  return Number.isNaN(date.getTime()) ? undefined : date;
}
