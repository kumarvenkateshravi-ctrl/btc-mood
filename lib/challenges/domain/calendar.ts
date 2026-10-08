import { instantMs, type DayBoundaryPolicy, type DayId, type InstantMs } from "./types";

export const UTC_DAY_MILLISECONDS = 86_400_000;

export const UTC_DAY_BOUNDARY_POLICY: Readonly<DayBoundaryPolicy> = Object.freeze({
  timezone: "UTC",
  localResetTime: "00:00:00",
  timezoneDataVersion: "UTC-fixed-v1",
  intervals: "startInclusiveEndExclusive",
  ambiguousTime: "earlier",
  nonexistentTime: "nextValid",
});

export interface DayBoundary {
  dayId: DayId;
  startInclusive: InstantMs;
  endExclusive: InstantMs;
}

function assertValidInstant(value: number): InstantMs {
  const branded = instantMs(value);
  if (!Number.isFinite(new Date(value).getTime())) {
    throw new RangeError("Instant is outside the supported ECMAScript date range.");
  }
  return branded;
}

export function utcDayId(value: string): DayId {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new TypeError("UTC day ID must use YYYY-MM-DD.");
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new RangeError("UTC day ID is not a valid calendar date.");
  }
  return value as DayId;
}

export function startOfUtcDay(value: InstantMs | number): InstantMs {
  const checked = assertValidInstant(Number(value));
  return instantMs(Math.floor(checked / UTC_DAY_MILLISECONDS) * UTC_DAY_MILLISECONDS);
}

export function utcDayIdAt(value: InstantMs | number): DayId {
  const start = startOfUtcDay(value);
  return utcDayId(new Date(start).toISOString().slice(0, 10));
}

export function utcDayBoundaryAt(value: InstantMs | number): Readonly<DayBoundary> {
  const startInclusive = startOfUtcDay(value);
  return Object.freeze({
    dayId: utcDayIdAt(startInclusive),
    startInclusive,
    endExclusive: instantMs(startInclusive + UTC_DAY_MILLISECONDS),
  });
}

export function nextUtcDayBoundary(value: InstantMs | number): InstantMs {
  return utcDayBoundaryAt(value).endExclusive;
}

export function isUtcDayBoundary(value: InstantMs | number): boolean {
  const checked = assertValidInstant(Number(value));
  return checked % UTC_DAY_MILLISECONDS === 0;
}

export function buildUtcDayBoundaryTable(
  startInclusive: InstantMs | number,
  endExclusive: InstantMs | number,
): readonly Readonly<DayBoundary>[] {
  const start = assertValidInstant(Number(startInclusive));
  const end = assertValidInstant(Number(endExclusive));
  if (end <= start) {
    throw new RangeError("Calendar table end must be after its start.");
  }

  const firstBoundary = startOfUtcDay(start);
  const dayCount = Math.ceil((end - firstBoundary) / UTC_DAY_MILLISECONDS);
  if (dayCount > 100_000) {
    throw new RangeError("Calendar table exceeds the 100,000-day safety limit.");
  }

  const result: Readonly<DayBoundary>[] = [];
  for (let index = 0; index < dayCount; index += 1) {
    const dayStart = instantMs(firstBoundary + index * UTC_DAY_MILLISECONDS);
    result.push(
      Object.freeze({
        dayId: utcDayIdAt(dayStart),
        startInclusive: dayStart,
        endExclusive: instantMs(dayStart + UTC_DAY_MILLISECONDS),
      }),
    );
  }
  return Object.freeze(result);
}

export function dayContains(boundary: DayBoundary, value: InstantMs | number): boolean {
  const checked = assertValidInstant(Number(value));
  return checked >= boundary.startInclusive && checked < boundary.endExclusive;
}

export function utcInstant(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
  millisecond = 0,
): InstantMs {
  const fields = [year, month, day, hour, minute, second, millisecond];
  if (!fields.every(Number.isInteger)) {
    throw new TypeError("UTC instant fields must be integers.");
  }
  const value = Date.UTC(year, month - 1, day, hour, minute, second, millisecond);
  const date = new Date(value);
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day ||
    date.getUTCHours() !== hour ||
    date.getUTCMinutes() !== minute ||
    date.getUTCSeconds() !== second ||
    date.getUTCMilliseconds() !== millisecond
  ) {
    throw new RangeError("UTC instant fields do not describe a valid timestamp.");
  }
  return assertValidInstant(value);
}
