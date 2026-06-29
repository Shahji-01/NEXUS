import { describe, expect, it } from "vitest";

// Trivial sanity test to confirm the Vitest runner executes in @workspace/api.
describe("test runner sanity", () => {
  it("runs a basic assertion", () => {
    expect(1 + 1).toBe(2);
  });
});
