import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { commentLines, forbiddenIn } from "./links-rules";

/**
 * Сторож сцепки «код ↔ документация» ядра: комментарии и названия тестов ссылаются только на страницу сайта
 * документации с якорем (`https://aom.js.org/architecture/#как-менять-ядро`) или на путь с символом
 * (`путь` (`Символ`)); без номеров строк, меток решений, номеров задач и дефектов, путей к спекам, планам
 * и приложению — полный список запрещённого и разбор комментариев в `links-rules.ts` (`FORBIDDEN`,
 * `commentLines`). Тексты сайта и их ссылки на код проверяет сторож репозитория документации `aom-js/docs`.
 */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SKIP = new Set(["node_modules", "dist", "manifests"]);

/** Файлы каталога `dir` (от `ROOT`, с `/`) с подходящим именем; при `deep` — и во вложенных каталогах. */
function walk(dir: string, name: RegExp, deep = true): string[] {
  if (!existsSync(join(ROOT, dir))) return [];
  return readdirSync(join(ROOT, dir), { withFileTypes: true })
    .filter((e) => !SKIP.has(e.name))
    .flatMap((e) => {
      const p = `${dir}/${e.name}`;
      if (e.isDirectory()) return deep ? walk(p, name) : [];
      return name.test(e.name) ? [p] : [];
    });
}

const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const packages = readdirSync(join(ROOT, "packages"), { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name);

/** Файлы кода ядра для сторожа: `{src,test}` каждого пакета и `scripts`. */
const codeFiles = [
  ...packages.flatMap((p) =>
    ["src", "test"].flatMap((d) => walk(`packages/${p}/${d}`, /\.(?:ts|js|mjs)$/)),
  ),
  ...walk("scripts", /\.(?:ts|js|mjs)$/),
].sort();

describe("main: сцепка кода и docs", () => {
  it("main: в комментариях и названиях тестов нет запрещённых ссылок", () => {
    expect(codeFiles.length).toBeGreaterThan(0);
    const bad = codeFiles.flatMap((file) =>
      commentLines(read(file), file).flatMap(({ line, text }) =>
        forbiddenIn(text, "code").map((rule) => `${file}:${line} — ${rule}: ${text}`),
      ),
    );
    expect(bad).toEqual([]);
  });

  it("main: путь в приложение ловится, тесты пакета — нет", () => {
    const app = (t: string) => forbiddenIn(t, "code").includes("путь в приложение");
    for (const t of [
      "см. ../test/README.md",
      "`../../test/x.ts`",
      "test/src/modules/a.ts",
      "test/docs/README.md",
      "test/test/helpers/links.ts",
    ])
      expect(app(t), t).toBe(true);
    for (const t of [
      "packages/core/test/core.test.ts",
      "packages/router/test/docs/x.ts",
      "test/cursor.test.ts",
      "contest/src/a.ts",
      "lib/test/src/a.ts",
    ])
      expect(app(t), t).toBe(false);
  });
});
