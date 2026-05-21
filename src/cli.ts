#!/usr/bin/env node

import { pathToFileURL } from "node:url";

import { createCli } from "./cli/cli.js";

export { createCli } from "./cli/cli.js";

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  createCli().parseAsync();
}
