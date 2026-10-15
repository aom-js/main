# Зонды в `@aom-js/router/testing` — план реализации (aom-main-oiy)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (выбрано: исполнение в этой сессии; владелец через основную сессию сказал «пиши план и начинай реализацию»). Шаги — чекбоксы `- [ ]`.

**Goal:** библиотека зондов живёт в `@aom-js/router/testing` и не обходит ядро; приложение берёт её оттуда.

**Architecture:** путь `./testing` добавляется в `exports` пакета через слияние в `prebuild.js`; модуль `src/testing` создаёт `RxContext` сам, разворачивает шаги функцией `plain` (бывший приватный метод `AomRoute`), сверяет адрес грамматикой `common/path.ts`, которую берёт и `Server` из `@aom-js/api`.

**Tech Stack:** Bun-монорепо, TypeScript (tsc ×3), vitest + unplugin-swc (ядро), bun:test (приложение).

**Spec:** `main/docs/superpowers/specs/2026-10-15-router-testing-design.md` (вариант А: `compilePath` — из корня `@aom-js/router`).

## Global Constraints

- Корень `@aom-js/router` получает только `compilePath`; публичный API `AomRoute` не расширяется; зонды — только через `@aom-js/router/testing`.
- Нет подмены `route.cursors` ни в ядре, ни в приложении; приватный `AomRoute.plain` снаружи пакета не зовут.
- Код и сообщения ядра — по-английски; документация — по-русски.
- Не править `packages/*/package.json`, `tsconfig.build*.json` (генерирует prebuild).
- Коммит — по завершении стадии, когда её проверки зелёные (решение владельца 2026-10-15, п. 4 «Завершение сессии» в AGENTS.md): отдельный коммит на стадию в своём репозитории, файлы — явными путями, файлы из `.git/info/exclude` не попадают; не пушить. Стадия 1 коммитится вместе со стадией 4: без модуля `testing` smoke красный, коммит обязан собираться.
- После правки `src` ядра — `bun run build` до любого прогона `../test`.

## Review Focus

1. Два прогона одного маршрута подряд или одновременно — ни один не пишет в `route.cursors` (тест с сеттером-счётчиком, задача 4).
2. Значение параметра со слешем или с символом вне валидатора — громкая ошибка до прогона, а не другой маршрут (задача 4, «does not match»).
3. Литерал шаблона с метасимволом (`/a+b/:id`) — адрес совпадает только буквально (задача 2, unit `compilePath`).
4. Шаг из другого маршрута с тем же `$` в `runSteps` — отвергается по идентичности курсора (задача 4).
5. Модуль `@aom-js/router/testing`, загруженный без корня, грузится в обоих форматах (smoke, задача 1/5).

---

### Task 1: путь `./testing` в сборке

**Files:**
- Modify: `main/scripts/prebuild.js`, `main/scripts/clean.js`, `main/scripts/smoke.js`, `main/vitest.config.ts`, `main/packages/router/package.src.json`

- [ ] **Step 1:** `package.src.json` router — добавить:

```json
"exports": {
  "./testing": {
    "import": { "types": "./dist/types/testing/index.d.ts", "default": "./dist/mjs/testing/index.js" },
    "require": { "types": "./dist/cjs/testing/index.d.ts", "default": "./dist/cjs/testing/index.js" }
  }
}
```

- [ ] **Step 2:** `prebuild.js` — после `Object.assign(resultPackageJson, distPackageJson)`:

```js
// the template owns "."; a package adds its own entry points (router: "./testing")
resultPackageJson.exports = { ...distPackageJson.exports, ...ownExports };
```
где `const ownExports = resultPackageJson.exports;` снят до наложения шаблона.

- [ ] **Step 3:** `clean.js` — перед записью `delete packageJson.exports;` с комментарием: режим разработки резолвится через `main` (src), собственные `exports` пакета указывают на dist и без `"."` закрыли бы корень.

- [ ] **Step 4:** `smoke.js` — точки входа из `exports` каждого пакета:

```js
const names = packages.flatMap((p) => {
  const name = `@aom-js/${path.basename(p)}`;
  const { exports = { ".": null } } = JSON.parse(fs.readFileSync(path.join(p, "package.json"), "utf8"));
  return Object.keys(exports).map((key) => (key === "." ? name : `${name}${key.slice(1)}`));
});
```
Сообщение успеха — «точек входа», а не «пакетов».

- [ ] **Step 5:** `vitest.config.ts` — `"@aom-js/router/testing": resolve(__dirname, "packages/router/src/testing")` строкой **выше** `"@aom-js/router"`.

- [ ] **Step 6 (красный):** `node scripts/prebuild.js` → в `packages/router/package.json` есть `exports["./testing"]`; `bun run build:router && bun smoke` → FAIL: `@aom-js/router/testing (import): ERR_MODULE_NOT_FOUND` (модуля ещё нет). Зелёным станет после задачи 4.
- [ ] **Commit:** вместе с задачей 4 (см. там).

### Task 2: грамматика адреса в router, сервер берёт её оттуда

**Files:**
- Create: `main/packages/router/src/common/path.ts`, `main/packages/router/test/path.test.ts`
- Modify: `main/packages/router/src/index.ts`, `main/packages/api/src/server/http.ts`

**Produces:** `compilePath(path: string): { pattern: RegExp; paramNames: string[] }` (корень пакета); `PATH_PARAM: RegExp` (только внутри пакета, `../common/path`).

- [ ] **Step 1: тест (красный)** `test/path.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { compilePath } from "@aom-js/router";

describe("compilePath — the server's path grammar", () => {
  it("collects parameter names in group order and inlines validators", () => {
    const { pattern, paramNames } = compilePath("/orgs/:orgId(\\d+)/users/:userId");
    expect(paramNames).toEqual(["orgId", "userId"]);
    expect("/orgs/12/users/x".match(pattern)?.slice(1)).toEqual(["12", "x"]);
    expect(pattern.test("/orgs/ab/users/x")).toBe(false);
  });

  it("keeps the literal part literal (KI-API-19)", () => {
    expect(compilePath("/file.json").pattern.test("/fileXjson")).toBe(false);
    expect(compilePath("/a+b/:id").pattern.test("/a+b/5")).toBe(true);
    expect(compilePath("/a+b/:id").pattern.test("/aab/5")).toBe(false);
  });
});
```
Run: `bunx vitest run packages/router/test/path.test.ts` → FAIL (`compilePath` не экспортирован).

- [ ] **Step 2:** `common/path.ts` — `PATH_PARAM = /:([^/()]+)(?:\(([^)]+)\))?/`, `PATH_TOKEN = new RegExp(\`${PATH_PARAM.source}|${/[.*+?^${}()|[\]\\]/.source}\`, "g")`, `compilePath` — тело и комментарий из `RouteMatcher.compilePath`. `index.ts`: `export { compilePath } from "./common/path";`.
- [ ] **Step 3:** `http.ts` — импорт `compilePath` из `@aom-js/router`, `this.compiled.set(route.path, compilePath(route.path))`, статический метод удалить.
- [ ] **Step 4:** `bunx vitest run packages/router/test/path.test.ts packages/api` → PASS (тесты KI-API-19/KI-API-01 в `server.test.ts` зелёные).
- [ ] **Commit (main):** `git commit -- packages/router/src/common/path.ts packages/router/src/index.ts packages/router/test/path.test.ts packages/api/src/server/http.ts`

### Task 3: обход `plain` — функция модуля

**Files:** Modify `main/packages/router/src/common/route.ts`

**Produces:** `plain(cursors: AomCursor[], into?: AomCursor[]): AomCursor[]` (экспорт модуля `common/route`, не барреля).

- [ ] **Step 1:** приватный метод → `export function plain(cursors, into = [])` с тем же телом (рекурсия передаёт `into`, возвращает `into`); конструктор: `this.cursors = plain([...])`.
- [ ] **Step 2:** `bunx vitest run` → все 473 + новые из задачи 2 PASS (чистый рефакторинг держат router-build, route-projection, cursor-kinds).
- [ ] **Commit (main):** `packages/router/src/common/route.ts packages/router/src/common/kinds.ts`

### Task 4: модуль `src/testing`

**Files:**
- Create: `main/packages/router/src/testing/{index,report,decorators,runner}.ts`, `main/packages/router/test/testing.test.ts`

**Consumes:** `compilePath`, `PATH_PARAM` (задача 2), `plain` (задача 3), `Router.routeOf`, `RxContext`.
**Produces (путь `@aom-js/router/testing`):** `Tester(endpoint)`, `Probe(title, input?)`, `Observe(Class)`, `Report()`, `isTester(cls): boolean`, `TesterReport`, `CheckResult`, `runProbes(tester, router, options?): Promise<TesterReport>`, `RunOptions { values?, cursors?: HandlerFunction[], preset?: Array<[ClassConstructor<object>, object]> }`, `runSteps(route, values?, steps = route.cursors): Promise<unknown>`.

- [ ] **Step 1: тесты (красные)** `test/testing.test.ts` — фикстура: `Store` (`@OnInstance` считает вызовы, кладёт `items`), `Guard.Check` (без `authorization` бросает `NO_TOKEN`), `Item` (данные), `ItemParam.Assign` (`@Params` → `@This(Item)`), `ItemID.PathID` (`@After(ItemParam.Assign)`), `Items` с классовым `@Before(Guard.Check)`: `GET /` (`@This(Store)`, возвращает данные) и `GET /id-:id([0-9]+)` (`@Before(ItemID.PathID)`), `Root` с `@Bridge("/items", Items)`. Случаи:
  - перенос `index.test.ts`: нет утверждений → `made no assertions`; `@Observe` отсутствующего → `no instance in the request state`; возврат значения → `returned a value`; два зонда — порядок и `checks = 2`; нет `@Tester` → `no @Tester()`; нет `@Probe` → `no @Probe() methods`; класс зондов не контроллер, `isTester` различает; эндпоинта нет в роутере → `ROUTE_OF_NOT_FOUND_ERROR`; шаг вне маршрута → `is not a step of route`; `cursors: [ItemID.PathID]` + `params.id = "42"` → зонд видит `Item.id === "42"` (развёрнут `@After`); нет параметра → `path parameter "id" is not set`; `id = "abc"` и `id = "4/2"` → `does not match the route path`; лишний параметр → `has no parameters id`;
  - новые: полная цепочка без токена — зонд видит `report.routeError.message === "NO_TOKEN"`; с токеном — `Store` создан хуком один раз; `preset` подставленного `Store` — хук не вызывался, данные подставленные; два одновременных `runProbes` и `runSteps` под сеттером-счётчиком на `route.cursors` — записей 0; `runSteps` до обработчика → `undefined` (обработчик не исполнен), без шагов → результат обработчика; курсор другого маршрута с тем же `$` → `is not a step of this route`; неверный адрес → отказ до прогона.

Run: `bunx vitest run packages/router/test/testing.test.ts` → FAIL (модуля нет).

- [ ] **Step 2:** `report.ts` — перенос `TesterReport` как есть, комментарии и `error: "condition not met"` по-английски.
- [ ] **Step 3:** `decorators.ts` — перенос `probeMeta`, `aggregate`, `runnable`, `Probe`, `Observe`, `Report`, `testers`, `Tester`; `RunContext` → `context` из `ArgumentsHandlerParameters` (тип `RxContext`); `ClassOf` → `ClassConstructor`; `isTester = (cls: object) => testers.has(cls)`.
- [ ] **Step 4:** `runner.ts` — `endpointOf` (нет `@Tester`), `probesOf`, `group`, `request`, `address` (подстановка по `PATH_PARAM`, сверка с `compilePath(route.path).pattern` и захваченными группами), `unfold` через `plain([cursor])`, `stepsOf`, `envelope`, `describe`; `runProbes`: `router.routeOf(endpointOf(tester))`, на группу — `new RxContext(values, route)`, `preset` и отчёт в `state`, `context.run(steps)` (ошибка → `routeError`), зонды — отдельными `context.run([envelope])`; `runSteps`: `request`, `address`, проверка принадлежности шагов по идентичности, `new RxContext(...).run(route.cursors.filter(steps.includes))`.
- [ ] **Step 5:** `index.ts` — `import "reflect-metadata"` и экспорт имён из Produces.
- [ ] **Step 6:** `bunx vitest run` → PASS; `bun run build` → smoke: `@aom-js/router/testing` грузится через `require()` и `import()`.
- [ ] **Commit (main, задачи 1 и 4):** `packages/router/src/testing packages/router/test/testing.test.ts packages/router/package.src.json scripts/prebuild.js scripts/clean.js scripts/smoke.js vitest.config.ts`

### Task 5: приложение

**Files:**
- Modify: 45 файлов-импортёров `@/lib/tester` (список — `grep -rl "@/lib/tester" src test`), `test/test/integration/late-writes.test.ts`, комментарии `src/modules/tickets/api/routes/tickets/comments/init/wiring.test.ts`, `src/modules/files/api/routes/files/init/probes.test.ts`
- Create: `test/test/probes-isolation.test.ts` (из `src/lib/tester/isolation.test.ts`)
- Delete: `test/src/lib/tester/`

- [ ] **Step 1:** `sed -i 's#"@/lib/tester"#"@aom-js/router/testing"#'` по списку.
- [ ] **Step 2:** `late-writes.test.ts`: `import { AomApi, compilePath } from "@aom-js/router"`, `import { runSteps } from "@aom-js/router/testing"`; `pathParams(route)` — `compilePath(route.path).paramNames` → `randomUUID()`; часть A — `await runSteps(route, context({...}))`; часть B — `await runSteps(route, context({...}), route.cursors.slice(0, at))`, без `original`/`finally`.
- [ ] **Step 3:** `test/probes-isolation.test.ts` — поиск `@aom-js/router/testing` в `src/`, исключение только `/probes.`, `testers.has` → `isTester`.
- [ ] **Step 4:** удалить `src/lib/tester`; `bun test` → 0 fail, skip 201; `bun run test:types` чисто; уровень 4 (`probes.test.ts`, `late-writes.test.ts`) зелёный, сводки A/B как в базе.
- [ ] **Commit (test):** импортёры, `late-writes.test.ts`, `probes-isolation.test.ts`, удаление `src/lib/tester` — явными путями.

### Task 6: документация

- [ ] router `readme.md`: раздел «Зонды (`@aom-js/router/testing`)», `compilePath` в публичном API, абзац про `plain`, сборка (путь `./testing`).
- [ ] api `readme.md` (`RouteMatcher`), `test/docs/known-issues.md` (KI-API-19 — адрес `compilePath`), `test/docs/probes.md` (статус, §2, §9, §10, ссылки на README), `test/docs/testing-invariants.md` §7 и ссылки, `test/docs/testing.md`, `main/AGENTS.md` (smoke).
- [ ] **Commit:** по коммиту документации в main и в test (AGENTS.md — локальная методология, в коммит не идёт).

### Task 7: ворота

- [ ] `bunx vitest run`, `bun run build`, `../verify.sh --fast`; `grep -rn "route.cursors =\|lib/tester\|Reflect.get(AomRoute.prototype" main/packages test/src test/test` — пусто (кроме истории в `specs/`, `docs/superpowers`).
- [ ] `ponytail:ponytail-review` на дифф; `bd` — итог в задаче.
