import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, normalize, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FORBIDDEN, commentLines } from "./links-rules";

/**
 * Сторож сцепки «код ↔ документация» ядра: в комментариях и названиях тестов нет меток решений,
 * номеров задач и строк, путей к документам вне docs; пути и якоря живых docs ядра открываются.
 * Ядро не читает файлы приложения: ссылки, уходящие в `../test`, проверяет сторож приложения.
 * Правило сцепки — `../test/docs/README.md#пометки-в-документах`. Разбор комментариев и запрещённые ссылки —
 * `links-rules.ts`; сторож приложения сверяет их со своими копиями (`test/test/links-code.test.ts`).
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
        FORBIDDEN.filter(({ rx }) => rx.test(text)).map(
          ({ rule }) => `${file}:${line} — ${rule}: ${text}`,
        ),
      ),
    );
    expect(bad).toEqual([]);
  });

  // ───────────────────────── якоря и пути docs ─────────────────────────

  /** Якорь заголовка, как у GitHub: нижний регистр, без обратных кавычек и знаков кроме букв, цифр, `_`, `-` и пробела; пробел → `-`. */
  const slug = (heading: string) =>
    heading
      .trim()
      .toLowerCase()
      .replaceAll("`", "")
      .replace(/[^\p{L}\p{N}_\- ]/gu, "")
      .replaceAll(" ", "-");

  /** Строки markdown с номерами; `fence` — строка внутри блока кода (```) или его ограда. */
  function docLines(md: string): { line: number; text: string; fence: boolean }[] {
    let fence = false;
    return md.split("\n").map((text, i) => {
      const edge = /^\s*(```|~~~)/.test(text);
      if (edge) fence = !fence;
      return { line: i + 1, text, fence: fence || edge };
    });
  }

  /** Якоря заголовков (блоки кода пропускаются); повтор заголовка получает `-1`, `-2`, … как на GitHub. */
  function anchorsOf(md: string): Set<string> {
    const seen = new Map<string, number>();
    const out = new Set<string>();
    for (const { text, fence } of docLines(md)) {
      const h = !fence && /^#{1,6}\s+(.*)/.exec(text)?.[1];
      if (!h) continue;
      const s = slug(h);
      const k = seen.get(s) ?? 0;
      seen.set(s, k + 1);
      out.add(k ? `${s}-${k}` : s);
    }
    return out;
  }

  const decode = (s: string) => {
    try {
      return decodeURIComponent(s);
    } catch {
      return s; // не %-кодирование — берём как написано
    }
  };

  /** Живые docs ядра; метки в них проверяет сторож приложения. */
  const liveDocs = [
    ...["readme.md", ...walk("docs", /\.md$/, false), ...walk("docs/cookbook", /\.md$/)],
    ...packages.map((p) => `packages/${p}/readme.md`),
  ]
    .filter((f) => existsSync(join(ROOT, f)))
    .sort();

  it("main: пути и якоря docs ядра внутри репозитория открываются", () => {
    const bad: string[] = [];
    let checked = 0;
    for (const doc of liveDocs) {
      for (const { line, text, fence } of docLines(read(doc))) {
        if (fence) continue;
        const spans = [...text.matchAll(/`[^`\n]+`/g)].map((m) => [m.index, m.index + m[0].length]);
        for (const m of text.matchAll(/\]\(([^)\s]+)\)/g)) {
          const [href, ...rest] = m[1].split("#");
          const anchor = rest.length ? decode(rest.join("#")) : null;
          // внешний адрес и образец ссылки в обратных кавычках — не ссылка; уход в `../test` проверяет сторож приложения
          if (
            /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(href) ||
            spans.some(([from, to]) => from < m.index && m.index < to)
          )
            continue;
          const target = href ? normalize(join(ROOT, dirname(doc), decode(href))) : join(ROOT, doc);
          const rel = relative(ROOT, target);
          if (rel.startsWith("..")) continue;
          checked++;
          const why = (reason: string) => bad.push(`${doc}:${line} — ${reason} (${m[1]})`);
          if (!existsSync(target)) why(`нет файла ${rel}`);
          else if (anchor !== null && !rel.endsWith(".md"))
            why(`якорь #${anchor} у файла не markdown ${rel}`);
          else if (anchor !== null && !anchorsOf(read(rel)).has(anchor))
            why(`в ${rel} нет якоря #${anchor}`);
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
    expect(bad).toEqual([]);
  });
});
