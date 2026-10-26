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

  it("main: падежи отсылок к документам, латинские Task и line, Dockerfile и #L; хосты, план запроса, S3/R2 — чисты; shortcut со скобкой", () => {
    const caught = [
      "задачей 3",
      "фазой 2",
      "стадией 4",
      "по спекам",
      "спекой",
      "Task 4.2",
      "phase 3",
      "Dockerfile:3",
      "deploy/Dockerfile.dev:12",
      "file.ts#L82",
      "`a/b.md#L3-L5`",
      "line 82",
      "Lines 3-5",
      "подплан 2",
      "nats.local.ts:3",
    ];
    const clean = [
      "2 плана запроса",
      "подплан запроса",
      "в плане запроса нет подплана",
      "db.example.com:5432",
      "nats.svc.cluster.local:4222",
      "aom-test-postgres.local:5432",
      "S3/R2",
      "R2/S3",
      "Cloudflare R2",
      "Apple M1",
      "pipeline 3",
      "к спекам и планам",
      "задачами трекера",
      "#l82",
    ];
    for (const where of ["code", "docs"] as const) {
      for (const s of caught) expect(forbiddenIn(s, where).length, s).toBeGreaterThan(0);
      for (const s of clean) expect(forbiddenIn(s, where), s).toEqual([]);
    }
    for (const s of ["shortcut(KI-…): предел", "// Shortcut (x): y"])
      expect(forbiddenIn(s, "code")).toEqual(["метка shortcut(…): нужна shortcut:"]);
    expect(forbiddenIn("shortcut: предел, когда расширять", "code")).toEqual([]);
    expect(forbiddenIn("R2 и M1", "code")).toEqual(["метка M№/R№ латиницей"]);
  });
});
