import { createDefaultConfig } from "./config.js";
import { schemaStatements } from "./store.js";
import type { InitPlan } from "./types.js";

export function createInitPlan(projectRoot: string): InitPlan {
  return {
    projectRoot,
    config: createDefaultConfig(),
    schema: schemaStatements,
  };
}
