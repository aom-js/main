// Проверяет, что собранные пакеты действительно грузятся в Node — в обоих форматах.
//
// Зачем отдельная проверка: в исходниках относительные импорты идут без расширений,
// поэтому moduleResolution=bundler, а он пропускает почти любой спецификатор.
// Относительные пути чинит post-build.js, но обращения к чужим пакетам он не трогает —
// и забытое расширение там (например "class-transformer/cjs/storage" вместо
// "...storage.js") не поймает ни компилятор, ни post-build. Вылезет только в рантайме
// у пользователя. Вот это здесь и ловится.
//
// Тесты такое не покрывают: vitest ходит по алиасам в src, мимо dist.
//
// Пакеты подключаются по имени через временную директорию с симлинками — так же,
// как их увидит настоящий потребитель, вместе с полем exports.
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const packages = require("./packages");

const names = packages.map((p) => `@aom-js/${path.basename(p)}`);

const consumer = fs.mkdtempSync(path.join(os.tmpdir(), "aom-smoke-"));
const scope = path.join(consumer, "node_modules", "@aom-js");
fs.mkdirSync(scope, { recursive: true });
fs.writeFileSync(path.join(consumer, "package.json"), JSON.stringify({ name: "aom-smoke" }));
packages.forEach((p) => fs.symlinkSync(p, path.join(scope, path.basename(p)), "dir"));

const script = `
import { createRequire } from "node:module";
const require = createRequire(${JSON.stringify(path.join(consumer, "smoke.cjs"))});
const names = ${JSON.stringify(names)};
const failures = [];
for (const name of names) {
  for (const [kind, load] of [["require", (n) => require(n)], ["import", (n) => import(n)]]) {
    try {
      const m = await load(name);
      if (!Object.keys(m).length) failures.push(\`\${name} (\${kind}): пустой набор экспортов\`);
    } catch (e) {
      failures.push(\`\${name} (\${kind}): \${e.code || e.name} — \${String(e.message).split("\\n")[0]}\`);
    }
  }
}
if (failures.length) {
  console.error("smoke: пакеты не грузятся:");
  failures.forEach((f) => console.error("  " + f));
  process.exit(1);
}
console.log(\`smoke: \${names.length} пакетов грузятся через require() и import()\`);
`;

try {
  process.stdout.write(
    execFileSync(process.execPath, ["--input-type=module", "--eval", script], {
      cwd: consumer,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "inherit"],
    }),
  );
} catch (err) {
  process.stderr.write(err.stdout || "");
  process.exitCode = 1;
} finally {
  fs.rmSync(consumer, { recursive: true, force: true });
}
