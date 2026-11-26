import { describe, expect, it } from "vite-plus/test";
import { parseScheduleSlots, resolveDueSlotKey } from "./scheduler.ts";

describe("digest scheduler", () => {
  it("parses valid HH:MM schedule times and ignores malformed entries", () => {
    const slots = parseScheduleSlots(["09:30", "19:00", "9:30", "25:00", "bad"]);
    expect(slots).toEqual([
      { hour: 9, minute: 30, label: "09:30" },
      { hour: 19, minute: 0, label: "19:00" },
    ]);
  });

  it("matches exact local wall-clock slot using timezone offset", () => {
    const slots = parseScheduleSlots(["09:30", "19:00"]);
    // 2026-11-26T01:30:00Z === 2026-11-26 09:30 UTC+8 (480 mins)
    const utcMorning = Date.parse("2026-11-26T01:30:15.000Z");
    expect(resolveDueSlotKey(utcMorning, 480, slots)).toBe("2026-11-26@09:30");

    // 2026-11-26T01:31:00Z is not a scheduled slot
    const utcNextMinute = Date.parse("2026-11-26T01:31:00.000Z");
    expect(resolveDueSlotKey(utcNextMinute, 480, slots)).toBeNull();
  });
});
