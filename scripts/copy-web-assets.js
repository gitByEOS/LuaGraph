import { cp, mkdir, readdir, rm, stat } from "node:fs/promises";

await mkdir("dist", { recursive: true });
await mkdir("dist/web", { recursive: true });
await rm("dist/web/assets", { recursive: true, force: true });

if (!(await hasWebAssets())) {
  process.exit(0);
}

await cp("src/web/assets", "dist/web/assets", { recursive: true });

async function hasWebAssets() {
  if (!(await pathExists("src/web/assets"))) {
    return false;
  }

  return (await readdir("src/web/assets")).length > 0;
}

async function pathExists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") {
      return false;
    }

    throw error;
  }
}
