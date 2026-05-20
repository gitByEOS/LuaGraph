import { describe, expect, it } from "vitest";

import { createDefaultConfig, createInitPlan } from "../src/lib.js";

describe("LuaGraph skeleton", () => {
  it("creates the default v0.1.0 init plan", () => {
    const plan = createInitPlan("/repo");

    expect(plan.projectRoot).toBe("/repo");
    expect(plan.config).toEqual(createDefaultConfig());
    expect(plan.schema.length).toBeGreaterThan(0);
  });
});
