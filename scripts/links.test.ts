import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, normalize, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Сторож сцепки «код ↔ документация» ядра: в комментариях и названиях тестов нет меток решений,
 * номеров задач и строк, путей к документам вне docs; пути и якоря живых docs ядра открываются.
 * Ядро не читает файлы приложения: ссылки, уходящие в `../test`, проверяет сторож приложения.
 * Правило сцепки — `../test/docs/testing.md#определение-готовности`. Своя копия разбора из
 * `test/test/helpers/links.ts` приложения: только то, что нужно двум тестам.
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

// ───────────────────────── комментарии и названия тестов ─────────────────────────

const TEST_NAMES = new Set(["describe", "it", "test"]);
/** Модификаторы, у которых свои скобки до вызова с названием: `test.each(таблица)("название", …)`. */
const MOD_WITH_ARGS = new Set(["each", "if", "skipIf", "todoIf"]);
/** После этих слов `/` начинает регулярное выражение, а не деление. */
const REGEX_AFTER_WORD = new Set([
  "return",
  "typeof",
  "case",
  "do",
  "else",
  "in",
  "of",
  "yield",
  "await",
  "void",
  "delete",
  "throw",
  "new",
  "instanceof",
]);
const REGEX_AFTER_CHAR = "(,=:[!&|?{};+-*%<>~^";
/** Строка вида ` * текст` вне блока: продолжение JSDoc (после `*` — пробел или конец строки, чтобы не путать с `*gen()`). */
const JSDOC_LINE = /[ \t]*\*(?=[ \t\r\n]|$)([^\n]*)/y;
const MOD = /\s*\.\s*(\w+)/y;

/**
 * Индекс после парной `)` для `(` в позиции `from`; строки пропускаются по кавычкам.
 * Предел: вложенные шаблоны не разбираются (таблица `each` с обратной кавычкой внутри `${…}`).
 */
function skipParens(src: string, from: number): number {
  if (src[from] !== "(") return -1;
  let depth = 0;
  for (let i = from; i < src.length; i++) {
    const c = src[i];
    if (c === '"' || c === "'" || c === "`") {
      for (i++; i < src.length && src[i] !== c; i++) if (src[i] === "\\") i++;
    } else if (c === "(") depth++;
    else if (c === ")" && --depth === 0) return i + 1;
  }
  return -1;
}

/** Позиция открывающей кавычки названия для вызова `describe|it|test[.мод…](` в позиции `from`, иначе -1. */
function titleQuote(src: string, from: number): number {
  const skipWs = (p: number) => {
    while (/\s/.test(src[p] ?? "")) p++;
    return p;
  };
  let p = from;
  while (/\w/.test(src[p] ?? "")) p++;
  for (;;) {
    MOD.lastIndex = p;
    const m = MOD.exec(src);
    if (!m) break;
    p = MOD.lastIndex;
    if (MOD_WITH_ARGS.has(m[1])) {
      p = skipParens(src, skipWs(p));
      if (p < 0) return -1;
    }
  }
  p = skipWs(p);
  if (src[p] !== "(") return -1;
  p = skipWs(p + 1);
  return /["'`]/.test(src[p] ?? "") ? p : -1;
}

/**
 * Текст комментариев (`//` вне строк, блочные, строки JSDoc ` * …`) и первый строковый аргумент
 * `describe|it|test` (с `.each`, `.skip`, `.only`, …) — всё, на что действует правило сцепки.
 * Содержимое строк, шаблонов и регулярных выражений не читается: `"http://…"` — не комментарий.
 * Пустые строки комментария пропускаются; блочный комментарий отдаёт строки со своими номерами.
 * Предел: построчный разбор без полного синтаксического дерева — `/` после `)` и `}` считается делением.
 */
function commentLines(source: string): { line: number; text: string }[] {
  const out: { line: number; text: string }[] = [];
  const emit = (line: number, text: string) => {
    const t = text.trim();
    if (t) out.push({ line, text: t });
  };
  const n = source.length;
  const open: number[] = []; // глубина `{` для каждого незакрытого `${` шаблона
  let i = 0;
  let line = 1;
  let depth = 0;
  let prev = ""; // последний значащий символ кода
  let word = ""; // последнее слово, если prev — его конец
  let titleAt = -1;
  let lineStart = true;

  /** Строка в кавычках; для названия теста отдаёт текст. Возвращает индекс после закрывающей. */
  const quoted = (q: string, from: number, title: boolean): number => {
    const start = line;
    let text = "";
    let j = from;
    while (j < n) {
      const c = source[j];
      if (c === "\\") {
        if (source[j + 1] === "\n") line++;
        text += source.slice(j, j + 2);
        j += 2;
        continue;
      }
      if (c === q) {
        j++;
        break;
      }
      if (c === "\n") {
        if (q !== "`") break; // оборванная строка
        line++;
      }
      text += c;
      j++;
    }
    if (title) emit(start, text.replace(/\s+/g, " "));
    return j;
  };

  /**
   * Текст шаблона до закрывающей кавычки или `${`; после `${` разбор кода продолжает основной цикл.
   * Заодно выставляет prev: закрытый шаблон — значение, открытое выражение — начало кода.
   */
  const template = (from: number): number => {
    for (let j = from; j < n; j++) {
      const c = source[j];
      if (c === "\\") {
        if (source[j + 1] === "\n") line++;
        j++;
      } else if (c === "\n") line++;
      else if (c === "`") {
        prev = "a";
        return j + 1;
      } else if (c === "$" && source[j + 1] === "{") {
        open.push(depth);
        prev = "{";
        return j + 2;
      }
    }
    prev = "a";
    return n;
  };

  /** Индекс после регулярного выражения с флагами или -1, если до конца строки закрывающей `/` нет. */
  const regex = (from: number): number => {
    let inClass = false;
    for (let j = from + 1; j < n; j++) {
      const c = source[j];
      if (c === "\n") return -1;
      if (c === "\\") j++;
      else if (c === "[") inClass = true;
      else if (c === "]") inClass = false;
      else if (c === "/" && !inClass) {
        j++;
        while (/[a-z]/.test(source[j] ?? "")) j++;
        return j;
      }
    }
    return -1;
  };

  while (i < n) {
    if (lineStart) {
      lineStart = false;
      JSDOC_LINE.lastIndex = i;
      const m = JSDOC_LINE.exec(source);
      if (m) {
        emit(line, m[1]);
        i = JSDOC_LINE.lastIndex;
        continue;
      }
    }
    const c = source[i];
    if (c === "\n") {
      line++;
      i++;
      lineStart = true;
      continue;
    }
    if (c === " " || c === "\t" || c === "\r") {
      i++;
      continue;
    }
    if (c === "/") {
      const d = source[i + 1];
      if (d === "/") {
        const end = source.indexOf("\n", i);
        const stop = end < 0 ? n : end;
        emit(line, source.slice(i + 2, stop));
        i = stop;
        continue;
      }
      if (d === "*") {
        const end = source.indexOf("*/", i + 2);
        const stop = end < 0 ? n : end;
        const body = source.slice(i + 2, stop).split("\n");
        body.forEach((t, k) =>
          emit(line + k, k === 0 ? t.replace(/^\*+/, "") : t.replace(/^\s*\*+/, "")),
        );
        line += body.length - 1;
        i = stop + 2;
        continue;
      }
      if (prev === "" || REGEX_AFTER_CHAR.includes(prev) || REGEX_AFTER_WORD.has(word)) {
        const end = regex(i);
        if (end > 0) {
          i = end;
          prev = "a";
          word = "";
          continue;
        }
      }
    } else if (c === '"' || c === "'") {
      i = quoted(c, i + 1, i === titleAt);
      prev = "a";
      word = "";
      continue;
    } else if (c === "`") {
      if (i === titleAt) {
        i = quoted(c, i + 1, true);
        prev = "a";
      } else i = template(i + 1);
      word = "";
      continue;
    } else if (/[\w$]/.test(c)) {
      let j = i + 1;
      while (j < n && /[\w$]/.test(source[j])) j++;
      const w = source.slice(i, j);
      if (prev !== "." && TEST_NAMES.has(w)) titleAt = titleQuote(source, i);
      prev = w[w.length - 1];
      word = w;
      i = j;
      continue;
    } else if (c === "{") depth++;
    else if (c === "}") {
      if (open.length && open[open.length - 1] === depth) {
        open.pop();
        i = template(i + 1);
        word = "";
        continue;
      }
      depth--;
    }
    prev = c;
    word = "";
    i++;
  }
  return out;
}

// ───────────────────────── запрещённые ссылки ─────────────────────────

/** Границы слова для кириллицы: `\b` и `\w` в JS видят только латиницу. */
const NOT_WORD_BEFORE = "(?<![\\p{L}\\p{N}_])";
const NOT_WORD_AFTER = "(?![\\p{L}\\p{N}_])";

/**
 * Тот же набор, что `test/test/helpers/links.ts` приложения (без правил только для docs: `where: "code"`
 * и `"both"` читаются здесь одинаково). Образцы — только в строках, не в комментариях.
 */
const FORBIDDEN: readonly { rule: string; rx: RegExp }[] = [
  { rule: "раздел §N", rx: /§\s?\d/u },
  { rule: "знак §", rx: /§(?!\s?\d)/u },
  { rule: "метка D-№", rx: /(?<![\p{L}\p{N}_-])D-\d+/u },
  {
    rule: "метка Н№/В№",
    rx: new RegExp(`(?<![\\p{L}\\p{N}_-])[НВ]\\d{1,2}${NOT_WORD_AFTER}`, "u"),
  },
  {
    rule: "метка М№/Р№",
    rx: new RegExp(`(?<![\\p{L}\\p{N}_-])[МР]\\d{1,2}${NOT_WORD_AFTER}`, "u"),
  },
  {
    rule: "метка M№/R№ латиницей",
    rx: new RegExp(`(?<![\\p{L}\\p{N}_-])[MR]\\d{1,2}${NOT_WORD_AFTER}`, "u"),
  },
  // имена контейнеров docker (`aom-test-postgres`, `aom-test-nats`) — не задачи
  {
    rule: "задача трекера",
    rx: new RegExp(
      `${NOT_WORD_BEFORE}aom-(?:test|main)-(?!(?:postgres|nats)${NOT_WORD_AFTER})[a-z0-9]{3,}`,
      "u",
    ),
  },
  {
    rule: "путь спеки или плана",
    rx: new RegExp(`${NOT_WORD_BEFORE}specs/|superpowers|docs-refresh|\\.supergoal`, "u"),
  },
  {
    // «HTTP-спека», «OpenAPI-спека» — внешний стандарт, не документ проекта: дефис перед словом отсекает;
    // «план запроса» — план выполнения запроса БД, не документ: ловится только план с номером или названием
    rule: "отсылка к плану или спеке",
    rx: new RegExp(
      `${NOT_WORD_BEFORE}(?:(?:задач[аеиу]|фаз[аеыу]|стади[яиюей]|этап[а-я]*) \\d` +
        `|план[а-я]* (?:\\d|переноса|доработки|миграции|задач|пилота)|\\d+(?:\\.\\d+)* плана${NOT_WORD_AFTER}|подплан)` +
        `|(?<![\\p{L}\\p{N}_-])спек[аеиу]${NOT_WORD_AFTER}`,
      "iu",
    ),
  },
  // имя файла, точка, любое расширение из букв, двоеточие и число; адрес с портом после двух косых черт — не файл
  {
    rule: "номер строки",
    rx: /(?<!\/\/[\p{L}\p{N}_.-]*)(?:[\p{L}\p{N}_.-]+\/)*[\p{L}\p{N}_.-]*\.\p{L}[\p{L}\p{N}]*:\d+/u,
  },
];

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
      commentLines(read(file)).flatMap(({ line, text }) =>
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

  /** Живые docs ядра; docs с пометкой «исторический» в первых пяти строках — история, их ссылки не проверяются. */
  const liveDocs = [
    ...["readme.md", ...walk("docs", /\.md$/, false), ...walk("docs/cookbook", /\.md$/)],
    ...packages.map((p) => `packages/${p}/readme.md`),
  ]
    .filter((f) => existsSync(join(ROOT, f)))
    .filter(
      (f) =>
        !read(f)
          .split("\n", 5)
          .some((l) => /историческ/i.test(l)),
    )
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
