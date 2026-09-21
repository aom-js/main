// Запускается из директории пакета после трёх проходов tsc.
//
// Делает две вещи:
//
// 1. Дописывает расширения относительным импортам в собранном коде.
//    В исходниках они намеренно без расширений ("./defines"), потому что расширение
//    там — это имя файла, которого рядом нет, а есть только после сборки. ESM в Node
//    расширения не подставляет и каталоги в index.js не разворачивает, поэтому
//    спецификаторы надо привести в порядок здесь, по факту собранного dist.
//    Неразрешимый путь — это ошибка сборки, а не повод пройти мимо: иначе битый
//    импорт молча уедет в публикацию.
//
// 2. Кладёт маркер формата в dist/cjs. Пакет объявлен как "type": "module", поэтому
//    Node читает ЛЮБОЙ .js внутри него как ESM — включая CommonJS-вывод. Формат
//    определяется ближайшим package.json, вот его туда и кладём.
const fs = require("node:fs");
const path = require("node:path");

const distDir = path.join(process.cwd(), "dist");
const cjsDir = path.join(distDir, "cjs");

if (!fs.existsSync(cjsDir)) {
  console.error(`post-build: ${cjsDir} не существует — сборка cjs не отработала`);
  process.exit(1);
}

const walk = (dir) =>
  fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));

// from "..." | import("...") | require("...")
const SPEC = /((?:from|import\(|require\()\s*["'])(\.[^"']*)(["'])/g;

const errors = [];
let rewritten = 0;

for (const file of walk(distDir)) {
  if (!/\.(js|mjs|cjs|d\.ts)$/.test(file)) continue;
  // рядом с .d.ts лежат .d.ts, рядом с .js — .js
  const neighbour = file.endsWith(".d.ts") ? ".d.ts" : ".js";
  const dir = path.dirname(file);

  const source = fs.readFileSync(file, "utf8");
  const out = source.replace(SPEC, (whole, open, spec, close) => {
    if (/\.(js|json|mjs|cjs)$/.test(spec)) return whole; // уже с расширением

    const asFile = path.resolve(dir, `${spec}${neighbour}`);
    const asIndex = path.resolve(dir, spec, `index${neighbour}`);

    let fixed;
    if (fs.existsSync(asFile)) fixed = `${spec}.js`;
    else if (fs.existsSync(asIndex)) fixed = `${spec}/index.js`;

    if (!fixed) {
      errors.push(`${path.relative(distDir, file)}: не удалось разрешить "${spec}"`);
      return whole;
    }
    rewritten++;
    // в .d.ts тоже ссылаемся на .js — так этот путь резолвят и node16/nodenext, и bundler
    return `${open}${fixed}${close}`;
  });

  if (out !== source) fs.writeFileSync(file, out);
}

if (errors.length) {
  console.error(`post-build: неразрешимые импорты (${errors.length}):`);
  errors.forEach((e) => console.error("  " + e));
  process.exit(1);
}

fs.writeFileSync(path.join(cjsDir, "package.json"), JSON.stringify({ type: "commonjs" }) + "\n");

// 3. bin-файлы (KI-CODEGEN-02): сборка каждый раз пишет dist заново без бита +x —
//    без chmod здесь `aom-codegen` как исполняемый bin не запускается
const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8"));
const binFiles = pkg.bin ? (typeof pkg.bin === "string" ? [pkg.bin] : Object.values(pkg.bin)) : [];
binFiles.forEach((bin) => fs.chmodSync(path.join(process.cwd(), bin), 0o755));

console.log(
  `post-build: расширений дописано ${rewritten}, маркер cjs записан` +
    (binFiles.length ? `, bin +x: ${binFiles.join(", ")}` : ""),
);
