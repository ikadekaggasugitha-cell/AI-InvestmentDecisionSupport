import { describe, it, expect } from "vitest";

import { HttpStatusError, classifyLoadError } from "./api";

/**
 * Naming why a load failed.
 *
 * The app used to carry a single `error: string`, which put "you have no
 * subscription" and "the server is down" in the same value. Every view then had
 * to decide what to say, and RiskView said "backend unreachable" for both — so an
 * account without a subscription was told to check its connection.
 *
 * Two kinds, not five. A 500, a timeout and a malformed body are different
 * events but the same sentence for a person reading the screen, and splitting
 * them would only create more ways to be wrong about the one case that matters.
 */
describe("classifyLoadError", () => {
  it("reads a 402 as a locked door, not a broken server", () => {
    expect(classifyLoadError(new HttpStatusError(402))).toEqual({ kind: "locked" });
  });

  it("does not read a 403 as a locked door", () => {
    // A blocked account and a non-admin are refused with 403. Telling either of
    // them their subscription is the problem is the conflation this status
    // exists to prevent — in the other direction.
    expect(classifyLoadError(new HttpStatusError(403))).toEqual({ kind: "unreachable" });
  });

  it("reads every other status as a failure to load", () => {
    expect(classifyLoadError(new HttpStatusError(500))).toEqual({ kind: "unreachable" });
    expect(classifyLoadError(new HttpStatusError(404))).toEqual({ kind: "unreachable" });
  });

  it("reads a thrown network failure as unreachable", () => {
    expect(classifyLoadError(new TypeError("network down"))).toEqual({ kind: "unreachable" });
  });

  it("reads a body that did not parse as unreachable", () => {
    // Not locked: the server answered, and nobody was refused.
    expect(classifyLoadError(new Error("risk: expected number"))).toEqual({
      kind: "unreachable",
    });
  });

  it("carries the status in the message so logs stay readable", () => {
    expect(new HttpStatusError(402).message).toBe("HTTP 402");
  });
});