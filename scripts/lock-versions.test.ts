import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { staleWorkspaces } from "./lock-versions";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const lock = (api: string, core: string) => `{
  "lockfileVersion": 1,
  "workspaces": {
    "": { "name": "@aom-js/main", "devDependencies": { "vitest": "^4.1.10", }, },
    "packages/api": { "name": "@aom-js/api", "version": "${api}", "dependencies": { "@aom-js/core": "workspace:*", }, },
    "packages/core": { "name": "@aom-js/core", "version": "${core}", },
  },
}`;

describe("main: версии workspaces в bun.lock", () => {
  it("main: отстающий от корневой версии пакет находится, совпавший — нет", () => {
    expect(staleWorkspaces(lock("0.1.0", "0.1.1"), "0.1.1")).toEqual([
      { name: "@aom-js/api", locked: "0.1.0" },
    ]);
    expect(staleWorkspaces(lock("0.1.1", "0.1.1"), "0.1.1")).toEqual([]);
  });

  it("main: bun.lock ядра совпадает с корневой версией", () => {
    const { version } = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
    expect(staleWorkspaces(readFileSync(join(ROOT, "bun.lock"), "utf8"), version)).toEqual([]);
  });
});
