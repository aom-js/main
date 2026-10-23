// Выпуск всех пакетов ядра одной версией — корневой из package.json (https://aom-js.github.io/docs/publishing/).
// `--dry-run` — всё то же без публикации и метки git: проверить сборку и состав пакетов.
const { execFileSync } = require("node:child_process");
const path = require("node:path");
const packages = require("./packages");
const { version } = require("../package.json");

const dryRun = process.argv.includes("--dry-run");
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, stdio: "inherit" });
const out = (cmd, args) => execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
const nameOf = (dir) => `@aom-js/${path.basename(dir)}`;

if (!dryRun && out("git", ["status", "--porcelain"])) {
  throw new Error("рабочее дерево не чистое: выпуск — только из закоммиченного состояния");
}

// уже выпущенные этой версией пропускаем: так повторный запуск дотягивает прерванный выпуск
const published = (dir) => {
  try {
    return out("npm", ["view", `${nameOf(dir)}@${version}`, "version"]) === version;
  } catch {
    return false; // пакета ещё нет в npm
  }
};
const pending = packages.filter((dir) => !published(dir));
if (!pending.length) throw new Error(`${version} уже выпущена у всех пакетов: поднимите версию в package.json`);

run("bunx", ["vitest", "run"]);
run("bun", ["run", "build"]);

// зависимости — раньше зависящих: пока идёт выпуск, у опубликованного пакета уже есть его зависимости
const order = [];
const visit = (dir) => {
  if (order.includes(dir)) return;
  const { dependencies = {} } = require(path.join(dir, "package.json"));
  Object.keys(dependencies)
    .filter((dep) => dep.startsWith("@aom-js/"))
    .forEach((dep) => visit(path.join(path.dirname(dir), dep.slice("@aom-js/".length))));
  order.push(dir);
};
pending.forEach(visit);

const tag = version.includes("-") ? "next" : "latest";
for (const dir of order.filter((dir) => pending.includes(dir))) {
  console.log(`\n${nameOf(dir)}@${version} → npm (${tag})`);
  // `bun publish --dry-run` требует входа в npm, а pack собирает тот же архив без него
  if (dryRun) run("bun", ["pm", "pack", "--dry-run"], dir);
  else run("bun", ["publish", "--access", "public", "--tag", tag], dir);
}

if (!dryRun) {
  run("git", ["tag", `v${version}`]);
  console.log(`\nметка v${version} создана; отправить: git push origin v${version}`);
}
