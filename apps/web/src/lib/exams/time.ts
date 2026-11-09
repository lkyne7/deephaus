const DATE_PARTS = ["year", "month", "day"] as const;

function partsInTimeZone(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const values = Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );
  return values as Record<(typeof DATE_PARTS)[number] | "hour" | "minute" | "second", number>;
}

export function localDateKey(date: Date, timeZone: string): string {
  const parts = partsInTimeZone(date, timeZone);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

/** Convert a local wall-clock time in an IANA zone to its UTC instant. */
export function zonedDateTimeToUtc(
  fields: {
    year: number;
    month: number;
    day: number;
    hour?: number;
    minute?: number;
    second?: number;
  },
  timeZone: string,
): Date {
  const desired = Date.UTC(
    fields.year,
    fields.month - 1,
    fields.day,
    fields.hour ?? 0,
    fields.minute ?? 0,
    fields.second ?? 0,
  );
  let candidate = desired;

  // Two passes resolve normal offsets and DST boundaries without a timezone
  // dependency. The browser already validates the IANA zone via Intl.
  for (let pass = 0; pass < 2; pass++) {
    const actual = partsInTimeZone(new Date(candidate), timeZone);
    const represented = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
      actual.second,
    );
    candidate += desired - represented;
  }
  return new Date(candidate);
}

export function startOfLocalDay(date: Date, timeZone: string): Date {
  const parts = partsInTimeZone(date, timeZone);
  return zonedDateTimeToUtc(
    { year: parts.year, month: parts.month, day: parts.day },
    timeZone,
  );
}

export function nextLocalDayStart(date: Date, timeZone: string): Date {
  const parts = partsInTimeZone(date, timeZone);
  const next = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + 1));
  return zonedDateTimeToUtc(
    {
      year: next.getUTCFullYear(),
      month: next.getUTCMonth() + 1,
      day: next.getUTCDate(),
    },
    timeZone,
  );
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone }).format();
    return true;
  } catch {
    return false;
  }
}
