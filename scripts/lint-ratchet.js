// Храповик eslint: число замечаний (ошибки + предупреждения) по файлу только убывает.
//
// `eslint .` даёт сотни замечаний старого кода — воротами «ноль замечаний» он не годится.
// Здесь новое замечание краснеет с именем файла, а исправленное требует уменьшить число
// в lint-ratchet.json — база не отстаёт от кода (образец — храповики приложения,
// ../test/src/modules/*.test.ts). Рост числа — решение, объяснённое в коммите.
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { ESLint } = require("eslint");

const root = path.join(__dirname, "..");
const listFile = path.join(__dirname, "lint-ratchet.json");

/** расхождение со списком: больше — новые замечания, меньше — число в списке устарело */
const driftOf = (found, list) =>
  [...new Set([...Object.keys(found), ...Object.keys(list)])].sort().flatMap((file) => {
    const now = found[file] ?? 0;
    const allowed = list[file] ?? 0;
    if (now > allowed)
      return [`${file}: ${now} > ${allowed} в списке — новые замечания (bunx eslint ${file})`];
    if (now < allowed)
      return [
        `${file}: ${now} < ${allowed} в списке — уменьшите число${now ? "" : " (уберите строку)"}`,
      ];
    return [];
  });

// самопроверка сравнения: рост, убыль, исчезнувший файл, совпадение
assert.match(driftOf({ a: 2 }, { a: 1 })[0], /^a: 2 > 1/);
assert.match(driftOf({ a: 1 }, { a: 2 })[0], /^a: 1 < 2/);
assert.match(driftOf({}, { a: 1 })[0], /уберите строку/);
assert.deepEqual(driftOf({ a: 1 }, { a: 1 }), []);

new ESLint({ cwd: root }).lintFiles(["."]).then((results) => {
  const found = Object.fromEntries(
    results
      .filter((r) => r.errorCount + r.warningCount)
      .map((r) => [path.relative(root, r.filePath), r.errorCount + r.warningCount]),
  );
  const drift = driftOf(found, JSON.parse(fs.readFileSync(listFile, "utf8")));
  if (drift.length) {
    console.error(
      `lint-ratchet: расхождение с ${path.relative(root, listFile)}\n${drift.join("\n")}`,
    );
    process.exit(1);
  }
  const total = Object.values(found).reduce((sum, n) => sum + n, 0);
  console.log(
    `lint-ratchet: ${total} замечаний в ${Object.keys(found).length} файлах — как в списке`,
  );
});
