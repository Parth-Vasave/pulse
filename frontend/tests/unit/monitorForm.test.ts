import { describe, expect, it } from "vitest";
import { DEFAULTS, headersToText, parseHeaders, toPayload } from "@/lib/monitorForm";

describe("monitor form", () => {
  it("parses headers and round-trips", () => {
    const h = parseHeaders("Authorization: Bearer abc\nX-Env: prod: eu\n\n");
    expect(h).toEqual({ Authorization: "Bearer abc", "X-Env": "prod: eu" });
    expect(parseHeaders(headersToText(h))).toEqual(h);
  });
  it("rejects malformed headers", () => {
    expect(() => parseHeaders("nonsense")).toThrow(/Name: value/);
  });
  it("builds a numeric payload with nulls for blanks", () => {
    const p = toPayload({ ...DEFAULTS, name: " API ", url: "https://x.test", interval_seconds: "30" });
    expect(p).toMatchObject({ name: "API", interval_seconds: 30, body: null, response_time_threshold_ms: null, failure_threshold: 3 });
  });
});
