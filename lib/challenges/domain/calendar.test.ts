import { describe, expect, it } from "vitest";

import {
  buildUtcDayBoundaryTable,
  dayContains,
  isUtcDayBoundary,
  nextUtcDayBoundary,
  startOfUtcDay,
  UTC_DAY_BOUNDARY_POLICY,
  UTC_DAY_MILLISECONDS,
  utcDayBoundaryAt,
  utcDayId,
  utcDayIdAt,
  utcInstant,
} from "./calendar";

describe("UTC challenge calendar", () => {
  it("uses the approved half-open midnight boundary", () => {
    const before = utcInstant(2026, 9, 10, 23, 59, 59, 999);
    const boundary = utcInstant(2026, 9, 11);
    const priorDay = utcDayBoundaryAt(before);
    const nextDay = utcDayBoundaryAt(boundary);

    expect(priorDay.dayId).toBe("2026-09-10");
    expect(dayContains(priorDay, before)).toBe(true);
    expect(dayContains(priorDay, boundary)).toBe(false);
    expect(nextDay.dayId).toBe("2026-09-11");
    expect(nextDay.startInclusive).toBe(boundary);
    expect(isUtcDayBoundary(boundary)).toBe(true);
  });

  it("maps an exact boundary to the new day", () => {
    const boundary = utcInstant(2026, 1, 2);
    expect(utcDayIdAt(boundary)).toBe("2026-01-02");
    expect(startOfUtcDay(boundary)).toBe(boundary);
    expect(nextUtcDayBoundary(boundary)).toBe(
      utcInstant(2026, 1, 3),
    );
  });

  it("builds immutable deterministic boundary tables", () => {
    const table = buildUtcDayBoundaryTable(
      utcInstant(2026, 9, 10, 12),
      utcInstant(2026, 9, 13, 12),
    );

    expect(table.map((day) => day.dayId)).toEqual([
      "2026-09-10",
      "2026-09-11",
      "2026-09-12",
      "2026-09-13",
    ]);
    expect(table.every((day) => day.endExclusive - day.startInclusive === UTC_DAY_MILLISECONDS)).toBe(true);
    expect(Object.isFrozen(table)).toBe(true);
    expect(table.every(Object.isFrozen)).toBe(true);
  });

  it.each([
    [2026, 3, 8],
    [2026, 11, 1],
  ])("is unaffected by regional DST changes around %i-%i-%i", (year, month, day) => {
    const start = utcInstant(year, month, day);
    const table = buildUtcDayBoundaryTable(start, utcInstant(year, month, day + 2));
    expect(table).toHaveLength(2);
    expect(table[0].endExclusive - table[0].startInclusive).toBe(UTC_DAY_MILLISECONDS);
    expect(table[1].endExclusive - table[1].startInclusive).toBe(UTC_DAY_MILLISECONDS);
  });

  it("freezes the calendar policy version with the template", () => {
    expect(UTC_DAY_BOUNDARY_POLICY).toEqual({
      timezone: "UTC",
      localResetTime: "00:00:00",
      timezoneDataVersion: "UTC-fixed-v1",
      intervals: "startInclusiveEndExclusive",
      ambiguousTime: "earlier",
      nonexistentTime: "nextValid",
    });
    expect(Object.isFrozen(UTC_DAY_BOUNDARY_POLICY)).toBe(true);
  });

  it("rejects invalid day IDs, timestamps, and ranges", () => {
    expect(() => utcDayId("2026-02-29")).toThrow();
    expect(() => utcDayId("09/10/2026")).toThrow();
    expect(() => utcInstant(2026, 2, 29)).toThrow();
    expect(() => buildUtcDayBoundaryTable(100, 100)).toThrow();
    expect(() => startOfUtcDay(Number.NaN)).toThrow();
  });
});
