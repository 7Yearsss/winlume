import { expect, it } from "vitest";
import { remainingAllowancePercent } from "./model";
it("does not display missing configuration as 0% or unlimited", () => {
  expect(remainingAllowancePercent({ status: "not_configured" })).toBeNull();
});
it("calculates percentage from exact units without double precision loss", () => {
  expect(remainingAllowancePercent({ status: "active", totalUnits: "100000000000000000000",
    remainingUnits: "85000000000000000000", periodStart: "", resetsAt: "" })).toBe(85);
});
