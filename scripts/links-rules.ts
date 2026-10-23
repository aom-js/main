/**
 * Правила сцепки «код ↔ документация» ядра — единственный их источник: что запрещено в комментариях,
 * названиях тестов и docs (`FORBIDDEN`, `forbiddenIn`) и как комментарии и названия тестов вычитываются
 * из кода (`commentLines`). Читают сторож кода (`links.test.ts`) и сторож текстов
 * сайта (`test/docs-links.test.ts` репозитория `aom-js/docs`).
 * Образцы — только в строках, не в комментариях.
 */

/** Границы слова для кириллицы: `\b` и `\w` в JS видят только латиницу. */
const NOT_WORD_BEFORE = "(?<![\\p{L}\\p{N}_])";
const NOT_WORD_AFTER = "(?![\\p{L}\\p{N}_])";

/** Где действует правило: `code` — комментарии и названия тестов, `docs` — docs ядра; без `where` — везде. */
type Where = "code" | "docs";

/**
 * Запрещённые ссылки. В docs раздел называют знаком раздела с «Заголовком» (его находит сторож docs),
 * в коде — только якорем docs.
 */
export const FORBIDDEN: readonly { rule: string; rx: RegExp; where?: Where }[] = [
  { rule: "раздел §N", rx: /§\s?\d/u },
  { rule: "знак §", rx: /§(?!\s?\d)/u, where: "code" },
  { rule: "знак § без «названия»", rx: /§(?!\s?[«\d])/u, where: "docs" },
  { rule: "метка D-№", rx: /(?<![\p{L}\p{N}_-])D-\d+/u },
  {
    rule: "метка Н№/В№",
    rx: new RegExp(`(?<![\\p{L}\\p{N}_-])[НВ]\\d{1,2}${NOT_WORD_AFTER}`, "u"),
  },
  {
    rule: "метка М№/Р№",
    rx: new RegExp(`(?<![\\p{L}\\p{N}_-])[МР]\\d{1,2}${NOT_WORD_AFTER}`, "u"),
  },
  // в docs латинская буква с цифрой — узел схемы
  {
    rule: "метка M№/R№ латиницей",
    rx: new RegExp(`(?<![\\p{L}\\p{N}_-])[MR]\\d{1,2}${NOT_WORD_AFTER}`, "u"),
    where: "code",
  },
  // имена контейнеров docker (`aom-test-postgres`, `aom-test-nats`) — не задачи
  {
    rule: "задача трекера",
    rx: new RegExp(
      `${NOT_WORD_BEFORE}aom-(?:test|main)-(?!(?:postgres|nats)${NOT_WORD_AFTER})[a-z0-9]{3,}`,
      "u",
    ),
  },
  // номер записи бывшего реестра дефектов: суть пишется словами; образец формата в угловых скобках не ловится
  { rule: "номер KI", rx: /(?<![\p{L}\p{N}_-])KI-[A-Z][A-Z0-9]*-[A-Z0-9]+/u },
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
  {
    // документ дизайна как источник: слово «дизайн» с названием в кавычках, пунктом или датой; «по дизайну» с
    // названием, пунктом, датой или номером; отсылка «см.» к дизайну. Дизайн в другом смысле (интерфейс, API,
    // `design:type`) не ловится
    rule: "отсылка к дизайну",
    rx: new RegExp(
      `${NOT_WORD_BEFORE}(?:дизайн(?:а|у|ом|е)?\\s+(?:["«“]|\\(?\\s*п\\.\\s?\\d|\\d)` +
        `|по дизайну\\s+(?:["«“]|\\(?\\s*п\\.|\\d)|см\\.?\\s+дизайн${NOT_WORD_AFTER})`,
      "iu",
    ),
  },
  // имя файла, точка, любое расширение из букв, двоеточие и число; адрес с портом после двух косых черт — не файл
  {
    rule: "номер строки",
    rx: /(?<!\/\/[\p{L}\p{N}_.-]*)(?:[\p{L}\p{N}_.-]+\/)*[\p{L}\p{N}_.-]*\.\p{L}[\p{L}\p{N}]*:\d+/u,
  },
  // ядро не ссылается на приложение; `packages/<pkg>/test/…` и `test/<файл>.test.ts` пакета — тесты ядра
  {
    rule: "путь в приложение",
    rx: /(?<![\p{L}\p{N}_./-])(?:(?:\.\.\/)+test\/|test\/(?:src|docs|test)\/)/u,
  },
  // в прозе docs: «`:82`» без имени файла и «строки 12–15»
  { rule: "висячий :N", rx: /`:\d+(?:[-–,]\d+)*`/u, where: "docs" },
  {
    rule: "строки N",
    rx: new RegExp(`${NOT_WORD_BEFORE}строк(?:а|и|е|у|ой|ам|ах|ами)?\\s+(?:с\\s+)?\\d`, "iu"),
    where: "docs",
  },
  // прежнее имя метки отложенных решений (теперь `shortcut`): в docs ей не место совсем
  { rule: "метка ponytail", rx: /ponytail/iu, where: "docs" },
  {
    rule: "прежняя метка ponytail: нужна shortcut",
    rx: /(?<![\p{L}\p{N}_-])ponytail\s*:/iu,
    where: "code",
  },
];

/** Имена правил, сработавших на тексте: `code` — комментарий или название теста, `docs` — строка docs. */
export function forbiddenIn(text: string, where: Where): string[] {
  return FORBIDDEN.filter((f) => (!f.where || f.where === where) && f.rx.test(text)).map(
    ({ rule }) => rule,
  );
}

// ───────────────────────── комментарии и названия тестов ─────────────────────────

const TEST_NAMES = new Set(["describe", "it", "test", "suite"]);
/** Модификаторы, у которых свои скобки до вызова с названием: `test.each(таблица)("название", …)`. */
const MOD_WITH_ARGS = new Set(["each", "for", "if", "runIf", "skipIf", "todoIf"]);
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
/** Следующая строка названия теста через `+`: `test("а" + "б", …)`. */
const CONCAT = /\s*\+\s*(?=["'`])/y;

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

/** Строка комментария или названия теста (`title`: аргумент `describe|it|test|suite`). */
export type CommentLine = { line: number; text: string; title?: true };

/**
 * Текст комментариев (`//` вне строк, блочные, строки JSDoc ` * …`) и первый строковый аргумент
 * `describe|it|test|suite` (с `.each`, `.skip`, `.only`, …; строки через `+` склеиваются) — всё, на что
 * действует правило сцепки. Содержимое строк, шаблонов и регулярных выражений не читается:
 * `"http://…"` — не комментарий.
 * Пустые строки комментария пропускаются; блочный комментарий отдаёт строки со своими номерами.
 * Предел: построчный разбор без полного синтаксического дерева — `/` после `)` и `}` считается делением.
 * Незакрытый шаблон или `${` в конце файла — сбой разбора: бросает ошибку с именем `file`, а не молчит.
 */
export function commentLines(source: string, file = "<текст>"): CommentLine[] {
  const out: CommentLine[] = [];
  const emit = (line: number, text: string, title?: true) => {
    const t = text.trim();
    if (t) out.push(title ? { line, text: t, title } : { line, text: t });
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
  let unclosed = false; // шаблон дочитан до конца файла без закрывающей кавычки
  let acc = ""; // текст строк названия теста

  /** Строка в кавычках; при `keep` её текст копится в `acc`. Возвращает индекс после закрывающей. */
  const quoted = (q: string, from: number, keep: boolean): number => {
    let j = from;
    while (j < n) {
      const c = source[j];
      if (c === "\\") {
        if (source[j + 1] === "\n") line++;
        if (keep) acc += source.slice(j, j + 2);
        j += 2;
        continue;
      }
      if (c === q) return j + 1;
      if (c === "\n") {
        if (q !== "`") return j; // оборванная строка
        line++;
      }
      if (keep) acc += c;
      j++;
    }
    if (q === "`") unclosed = true;
    return j;
  };

  /** Название теста с открывающей кавычки в `from`: строка и присоединённые через `+` строки. Возвращает индекс после последней. */
  const title = (from: number): number => {
    const start = line;
    acc = "";
    let j = from;
    for (;;) {
      j = quoted(source[j], j + 1, true);
      CONCAT.lastIndex = j;
      const m = CONCAT.exec(source);
      if (!m) break;
      line += m[0].split("\n").length - 1;
      j = CONCAT.lastIndex;
    }
    emit(start, acc.replace(/\s+/g, " "), true);
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
    unclosed = true;
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
      i = i === titleAt ? title(i) : quoted(c, i + 1, false);
      prev = "a";
      word = "";
      continue;
    } else if (c === "`") {
      if (i === titleAt) {
        i = title(i);
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
  if (unclosed || open.length)
    throw new Error(
      `${file}: разбор комментариев не дошёл до конца — ${unclosed ? "не закрыт шаблон" : "не закрыта подстановка ${…} шаблона"}`,
    );
  return out;
}
