#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { planGeneration } from "./defines/emit";
import { collect } from "./defines/collect";
import { diffManifest } from "./defines/check";
import { TransferServiceDescriptor } from "./defines/types";

const USAGE = `aom-codegen — генерация типизированных клиентов из дескрипторов шины

  aom-codegen collect  --transfer-module <путь к модулю с Transfer> [--export <имя>]
                       [--timeout 3000] --out descriptors.json
  aom-codegen generate --from descriptors.json --out <каталог>
                       --transfer <module specifier> [--transfer-export <имя>]
  aom-codegen check    --from descriptors.json --out <каталог>

collect с TS-конфигом запускать через bun; node потребует скомпилированный модуль.
`;

function flags(argv: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i].startsWith("--") || argv[i + 1] === undefined) {
      throw new Error(`unexpected argument "${argv[i]}"\n${USAGE}`);
    }
    result[argv[i].slice(2)] = argv[i + 1];
  }
  return result;
}

function required(options: Record<string, string>, name: string): string {
  const value = options[name];
  if (!value) throw new Error(`--${name} is required\n${USAGE}`);
  return value;
}

function readSnapshot(file: string): TransferServiceDescriptor[] {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

/** `manifest.json` in the generation output directory: `{ serviceName: hash }` — what `check` compares against. */
function manifestPath(out: string): string {
  return path.join(out, "manifest.json");
}

async function collectCommand(options: Record<string, string>): Promise<void> {
  const modulePath = path.resolve(required(options, "transfer-module"));
  const exportName = options.export || "default";
  const loaded = await import(pathToFileURL(modulePath).href);
  const transfer = loaded[exportName];
  if (!transfer || typeof transfer.collectDistributions !== "function") {
    throw new Error(`export "${exportName}" of ${modulePath} is not a configured Transfer`);
  }
  const descriptors = await collect(transfer, Number(options.timeout || 3000));
  fs.writeFileSync(required(options, "out"), JSON.stringify(descriptors, null, 2));
  console.log(`collected ${descriptors.length} descriptors → ${options.out}`);
  // bus subscriptions keep the process alive — the snapshot is written, so exit cleanly
  process.exit(0);
}

function generateCommand(options: Record<string, string>): void {
  const descriptors = readSnapshot(required(options, "from"));
  const out = required(options, "out");
  const config = {
    transferImport: required(options, "transfer"),
    transferExportName: options["transfer-export"],
  };
  const { succeeded, errors } = planGeneration(descriptors, config);

  const manifest: Record<string, string> = {};
  succeeded.forEach(({ service, dir: dirName }) => {
    const dir = path.join(out, dirName);
    fs.mkdirSync(dir, { recursive: true });
    service.files.forEach((file) => fs.writeFileSync(path.join(dir, file.path), file.source));
    manifest[service.name] = service.hash;
    console.log(`${service.name} → ${dir} (${service.files.map((f) => f.path).join(", ")})`);
  });
  fs.writeFileSync(manifestPath(out), JSON.stringify(manifest, null, 2));

  // one broken descriptor (or a directory collision) shouldn't block the rest —
  // but the run as a whole is still a failure: report all of them at once and exit with code 1
  if (errors.length) {
    errors.forEach((message) => console.error(message));
    process.exit(1);
  }
}

function checkCommand(options: Record<string, string>): void {
  const descriptors = readSnapshot(required(options, "from"));
  const out = required(options, "out");
  if (!fs.existsSync(manifestPath(out))) {
    throw new Error(`no manifest at ${manifestPath(out)} — run generate first`);
  }
  const manifest: Record<string, string> = JSON.parse(fs.readFileSync(manifestPath(out), "utf8"));
  const { drifted, missing, removed } = diffManifest(descriptors, manifest);
  drifted.forEach((d) => console.error(`drift: ${d.name} (${manifest[d.name]} → ${d.hash})`));
  missing.forEach((d) => console.error(`not generated: ${d.name}`));
  removed.forEach((name) => console.error(`removed: ${name} (сервис пропал из снапшота реестра)`));
  if (drifted.length || missing.length || removed.length) process.exit(1);
  console.log(`check: ${descriptors.length} contracts match`);
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  const options = flags(rest);
  if (command === "collect") return collectCommand(options);
  if (command === "generate") return generateCommand(options);
  if (command === "check") return checkCommand(options);
  throw new Error(USAGE);
}

main().catch((error: Error) => {
  console.error(error.message);
  process.exit(1);
});
