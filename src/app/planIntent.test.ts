import { describe, it, expect, beforeEach } from "vitest";
import { planFromSearch, readPlanIntent, writePlanIntent } from "./planIntent";

/* The intent is a client-side memo of the price line a visitor picked, kept
 * only until the billing tab turns it into a real declaration. Its failures
 * degrade to "no choice", never to a wrong choice. */
describe("plan intent", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("round-trips a plan through storage, and clears it", () => {
    expect(readPlanIntent()).toBeNull();
    writePlanIntent("monthly");
    expect(readPlanIntent()).toBe("monthly");
    writePlanIntent(null);
    expect(readPlanIntent()).toBeNull();
  });

  it("reads the plan key off the signup URL's query", () => {
    expect(planFromSearch("?plan=monthly")).toBe("monthly");
    expect(planFromSearch("?plan=weekly&extra=1")).toBe("weekly");
  });

  it("ignores names that are not the server's plan vocabulary", () => {
    // The URL is untrusted input: invented values mean "none", not a plan.
    expect(planFromSearch("?plan=bulanan")).toBeNull();
    expect(planFromSearch("?plan=lifetime")).toBeNull();
    expect(planFromSearch("")).toBeNull();
  });

  it("treats junk storage as no intent", () => {
    localStorage.setItem("aidss-plan-intent", "bulanan");
    expect(readPlanIntent()).toBeNull();
  });
});
