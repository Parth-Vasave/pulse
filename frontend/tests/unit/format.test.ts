import { describe, expect, it } from "vitest";
import { formatDuration, formatMs, formatPercent, timeAgo } from "@/lib/format";

describe("format", () => {
  it("formats durations", () => {
    expect(formatDuration(7)).toBe("7s");
    expect(formatDuration(261)).toBe("4m 21s");
    expect(formatDuration(3725)).toBe("1h 2m");
  });
  it("formats percentages and missing data without pretending", () => {
    expect(formatPercent(99.5)).toBe("99.5%");
    expect(formatPercent(100)).toBe("100%");
    expect(formatPercent(null)).toBe("No data");
  });
  it("formats latency", () => {
    expect(formatMs(183)).toBe("183 ms");
    expect(formatMs(2500)).toBe("2.50 s");
    expect(formatMs(null)).toBe("–");
  });
  it("formats relative time", () => {
    const now = Date.parse("2026-01-01T12:00:00Z");
    expect(timeAgo("2026-01-01T11:59:30Z", now)).toBe("30s ago");
    expect(timeAgo("2026-01-01T10:00:00Z", now)).toBe("2h ago");
    expect(timeAgo(null, now)).toBe("Never");
  });
});
