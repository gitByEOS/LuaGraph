import type { LuaGraphConfig } from "./types.js";

export const defaultConfig: LuaGraphConfig = {
  include: ["**/*.lua"],
  exclude: [".luagraph/**", "node_modules/**"],
  databaseDir: ".luagraph/kuzu",
};

export function createDefaultConfig(): LuaGraphConfig {
  return {
    include: [...defaultConfig.include],
    exclude: [...defaultConfig.exclude],
    databaseDir: defaultConfig.databaseDir,
  };
}
