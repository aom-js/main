# Выгрузка цепочек и общие правила в ядре — план работ

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ядро отдаёт факты о цепочках маршрутов (вид шага, родитель, дамп) и правила, общие для любого приложения; `test` берёт их из ядра и удаляет свои копии; документация ядра описывает границу «ядро / приложение».

**Architecture:** правила, которым хватает роутера (P1, P2, P6, P7, P8, `parentsOf`, `routeName`), — в `@aom-js/router/testing`. Вывод вида по классам api и обогащённая выгрузка (`kindOf`, `describe`, `describeRouter`, `manifestOf`) — в новом подпути `@aom-js/api/testing` (api зависит от router, обратное запрещено). Функции чистые: «роутер → список нарушений / данные», без `expect`. `test/src/lib/manifest/index.ts` остаётся фасадом приложения: подставляет свой вывод вида и держит толкования (`writtenBy`, `readBy`, `isService`), поэтому его потребители не меняются.

**Tech Stack:** TypeScript, bun-монорепо `main/packages/*`, vitest + swc (ядро), bun:test (`test`).

**Spec:** `main/docs/superpowers/specs/2026-10-23-manifest-export-design.md`

## Global Constraints

- Ядро выгружает только факты; что чем считается (писатель, читатель, служебный маршрут, «не писатели», остатки, пороги, архетипы) — решает приложение.
- Ядро не импортирует классы приложения; `@aom-js/router` не импортирует `@aom-js/api`.
- Функции ядра не вызывают `expect`, не используют `Bun.*`, `import.meta.dir`, `mock.module`.
- Существующий публичный API ядра не меняется (аддитивно); `AomCursorJSON` прежний.
- Сообщения нарушений в ядре — по-английски, как в `router/testing` (`route ended with …`).
- После правки `src` ядра — `bun run build` до любого прогона `test` (`main/AGENTS.md`, «Правило №1»).
- Docs замкнуты на docs и код: без ссылок на спеки, планы, задачи beads; в коде и названиях тестов — только `KI-…`, `docs/…#якорь`, путь + символ.
- Дамп `test/manifests/*.json` после Task 4 побайтно прежний; меняется только в Task 5, отдельным коммитом в `test`.
- Задачи — в `bd` репозитория `main` (`aom-main-*`): эпик + задача на каждую Task; коммит — по завершении задачи с зелёными проверками; push — только по просьбе.

## Review Focus

- Шаг-эндпоинт, который одновременно наследник `BaseAccessController` или контейнера: вид — Handler (порядок правил вывода) — тест в Task 3.
- Вывод вида приложения возвращает `undefined` — срабатывают правила ядра, а не Step — тест в Task 3.
- Роутер без маршрутов: правила возвращают `[]`/`inspected: 0`, не бросают — тест в Task 1.
- Новое поле проекции ядра доходит до выгрузки без правки `describe` — тест в Task 3 (перенос `kinds.test.ts:53`).
- Подпуть `@aom-js/api/testing` грузится в чистом Node через `require` и `import` — smoke в Task 3.

---

### Task 1: общие правила цепочки в `@aom-js/router/testing`

**Files:**
- Create: `main/packages/router/src/testing/chain.ts`
- Modify: `main/packages/router/src/testing/index.ts` (экспорт)
- Test: `main/packages/router/test/chain-rules.test.ts`

**Interfaces:**
- Produces (все из `@aom-js/router/testing`):
  - `routeName(route: { method: string; path: string }): string` — `"get /a/x"`, путь без `(…)` регэкспов параметров (как `test/src/lib/manifest/index.ts` `routeName`).
  - `parentsOf(cursors: AomCursor[]): number[]` — перенос из `test/src/lib/manifest/index.ts` без изменений.
  - `sharedEndpoints(router: Router): string[]` — P1.
  - `accessIdents(router: Router): Map<string, Set<unknown>>` и `identCollisions(router: Router): string[]` — P2, логика `test/src/lib/manifest/properties.test.ts` `accessIdents`/`identCollisions`.
  - `serializationErrors(router: Router): string[]` — P7: `JSON.stringify(router)`; ошибка → `["router does not serialize: <message>"]`.
  - `constructorThisRefs(router: Router): { inspected: number; found: string[] }` — P8, логика `properties.test.ts` `constructorThisRefs`.

- [ ] **Step 1: Write the failing tests** — по describe на правило; нарушители переносятся из `test/src/lib/manifest/properties.test.ts` с классами, объявленными внутри теста (не из `test`):
  - P1: `Shared` под мостами `/a` и `/b` → `["endpoint Shared.X serves 2 routes: get /a/x, get /b/x"]`; один мост → `[]`.
  - P2: два разных класса с одним именем, оба с маркером (`@UseMarker` router) на шаге маршрута → одна строка с `ident "<ident>"` и `2`; форма — как нарушитель `properties.test.ts:115-154`, но маркер свой, без `AccessController` приложения.
  - P7: `@This(FwdRef(() => { throw new ReferenceError("Missing is not defined") }))` → `["router does not serialize: Missing is not defined"]`.
  - P8: конструктор с `ThisRef(...)` и с `@This()` → две строки `"<Class>: constructor parameter <i> — …"`; чистый класс → `found: []`, `inspected` ≥ 1.
  - `parentsOf`: маршрут с `@Before` на методе, классовым `@Before` и `@After` — индексы родителей как в `docs`-описании (`before` → ближайший следующий с `$ === origin`, `after`/`next` → ближайший предыдущий, верхние → `-1`).
  - `routeName`: путь с `:id(\\d+)` → без регэкспа.
  - Пустой роутер (контроллер без маршрутов): все правила → `[]`, `inspected: 0`.
- [ ] **Step 2: Run** `cd main && bunx vitest run packages/router/test/chain-rules.test.ts` — FAIL: модуль не найден.
- [ ] **Step 3: Implement** функции в `chain.ts`, экспорт из `testing/index.ts`. Тела — перенос из `test` с английскими сообщениями.
- [ ] **Step 4: Run** `bunx vitest run` — PASS весь набор ядра.
- [ ] **Step 5: Commit** (`main`): `router/testing: общие правила цепочки — P1, P2, P7, P8, parentsOf, routeName`.

### Task 2: правило повторов P6 в `@aom-js/router/testing`

**Files:**
- Modify: `main/packages/router/src/testing/chain.ts`, `testing/index.ts`
- Test: `main/packages/router/test/chain-rules.test.ts`

**Interfaces:**
- Consumes: `parentsOf` (Task 1).
- Produces:
  ```ts
  export interface RepeatOptions {
    kindOf: (cursor: AomCursor) => AomCursorKind;       // вид шага — от приложения
    writes: (cursor: AomCursor) => boolean;             // «шаг пишет» — толкование приложения
    harmless: AomCursorKind[];                          // виды, повтор которых безвреден
  }
  export type RepeatBranch = "kind" | "next-group" | "after-handler";
  export interface Repeat { step: AomCursor["$"]["_"]; i: number; earlier: number[]; branch?: RepeatBranch }
  export function repeatsOf(route: AomRoute, options: RepeatOptions): Repeat[];
  ```
  Логика — `test/src/modules/form.test.ts` `repeatsOf` (ветки в том же порядке: вид из `harmless` → все прежние вхождения в других группах `@Next` → после обработчика и `!writes`); `branch` отсутствует — повтор не объяснён.

- [ ] **Step 1: Write the failing tests**: шаг, повторённый дважды до обработчика, вид Step, пишет → `branch: undefined`; тот же с видом из `harmless` → `"kind"`; повтор в двух разных группах `@Next` → `"next-group"`; повтор после обработчика при `writes → false` → `"after-handler"`, при `writes → true` → `undefined`; маршрут без повторов → `[]`.
- [ ] **Step 2: Run** — FAIL (`repeatsOf` не экспортирован).
- [ ] **Step 3: Implement** `repeatsOf`.
- [ ] **Step 4: Run** `bunx vitest run` — PASS.
- [ ] **Step 5: Commit**: `router/testing: правило повторов шага (P6) — вид и запись от приложения`.

### Task 3: подпуть `@aom-js/api/testing` — вид шага и выгрузка

**Files:**
- Create: `main/packages/api/src/testing/index.ts`, `main/packages/api/src/testing/manifest.ts`
- Modify: `main/packages/api/package.src.json` (`exports["./testing"]` — копия формы `packages/router/package.src.json:28-39` с путями `testing/index`), `main/vitest.config.ts` (алиас `"@aom-js/api/testing"` раньше `"@aom-js/api"`), `main/packages/api/src/builders/{body,query-string,headers,cookie,params}.ts` (`export class …BuilderConstructor`), `main/packages/api/src/builders/index.ts` (именованные экспорты фабрик вместо `export *`, чтобы базы не стали публичными: `BodyBuilder`, `QueryStringBuilder`, `HeadersBuilder`, `ParamsBuilder`, `ResponseBuilder`, `CookieBuilder` и прочие публичные символы этих модулей — сверить по `dist/types/builders/*.d.ts` до правки, список экспортов `@aom-js/api` не меняется)
- Test: `main/packages/api/test/manifest.test.ts`

**Interfaces:**
- Consumes: `parentsOf` (Task 1) — пока не используется (родитель — Task 5).
- Produces (все из `@aom-js/api/testing`):
  ```ts
  export interface ManifestOptions {
    /** Вид по классам приложения; `undefined` — решают правила ядра. */
    kindOf?: (cursor: AomCursor) => AomCursorKind | undefined;
  }
  export function kindOf(cursor: AomCursor, options?: ManifestOptions): AomCursorKind;
  export type DescribedStep = AomCursorJSON & { kind: AomCursorKind };
  export type DescribedRoute = Omit<AomRouteJSON, "steps"> & { steps: DescribedStep[] };
  export function describe(route: AomRoute, options?: ManifestOptions): DescribedRoute;
  export function describeRouter(router: Router, options?: ManifestOptions): { version: 1; routes: DescribedRoute[] };
  export function manifestOf(router: Router, options?: ManifestOptions): string; // JSON, отступ 2, "\n" в конце
  ```
  Порядок правил `kindOf`: `element.cursorKind` → Handler (`$ === endpoint.$`) → `options.kindOf` → Checkpoint (семейство `BaseAccessController`) → Input (шаг, унаследованный от базы билдера Body/QueryString/Headers/Cookie/Params или `IDController`, — как `inheritedFrom` в `test`) → Meta (пустой классовый шаг, условие `test/src/lib/manifest/index.ts:74-81`) → Step. `describe`/`describeRouter`/`manifestOf` — перенос из `test` (поле `kind` после `via`/`viaGroup`, остальные поля ядра через rest; сортировка `describeRouter` — как `Router.toJSON`).

- [ ] **Step 1: Write the failing tests** в `manifest.test.ts`, классы — внутри тестов:
  - Handler, Checkpoint (наследник `BaseAccessController`), Input (`QueryStringBuilder(...)`.Query, `ParamsBuilder(...)`.Params, `IDController`-шаг), Meta (пустой `@Before` класса), Step (свой метод наследника билдера), объявленный `@CursorKind(Collector)` побеждает вывод.
  - Эндпоинт в наследнике `BaseAccessController` → Handler.
  - `options.kindOf` возвращает Transport для своего класса → Transport; возвращает `undefined` → вид по правилам ядра.
  - `describe`: у каждого шага `kind`; поле, добавленное в проекцию ядра (перенос `test/src/lib/manifest/kinds.test.ts:53-64`), доходит до результата.
  - `describeRouter`: порядок маршрутов = `router.toJSON().routes`.
  - `manifestOf` оканчивается `"\n"` и `JSON.parse` равен `describeRouter`.
- [ ] **Step 2: Run** `bunx vitest run packages/api/test/manifest.test.ts` — FAIL.
- [ ] **Step 3: Implement** экспорты баз билдеров, `testing/manifest.ts`, `testing/index.ts` (`import "reflect-metadata"` первой строкой, как `router/testing`), `exports` и алиас.
- [ ] **Step 4: Run** `bunx vitest run` — PASS; `node scripts/prebuild.js && bun run build` — smoke печатает на 2 точки входа больше, чем до правки; `bunx tsc -p tsconfig.json --noEmit` и `node scripts/lint-ratchet.js` — без новых замечаний.
- [ ] **Step 5: Commit**: `api/testing: вид шага по классам ядра и выгрузка цепочек (describe, describeRouter, manifestOf)`.

### Task 4: `test` переходит на ядро, копии удалены

**Files:**
- Modify: `test/src/lib/manifest/index.ts`, `test/src/lib/manifest/properties.test.ts`, `test/src/lib/manifest/kinds.test.ts`, `test/src/modules/form.test.ts`
- Без изменений: потребители `@/lib/manifest` (`protected.test.ts`, `layout.test.ts`, `test/fixtures/matrix.ts`, `test/sweep.test.ts`, `test/probes-coverage.test.ts`, `test/integration/*`, `scripts/manifests.ts`, `order.test.ts`) — фасад сохраняет имена.

**Interfaces:**
- Consumes: Task 1–3.
- `test/src/lib/manifest/index.ts` после правки держит только своё: `modules`, `routerOf`, `isContainer`, `isService`, `anyContainer`, `nonWriters`, `writtenBy`, `readBy` (с shortcut KI-TEST-06), `manifestPath`, и
  ```ts
  const appKind = (cursor: AomCursor) => (isContainer(cursor.$._.target) ? AomCursorKind.Transport : undefined);
  export const kindOf = (cursor: AomCursor) => coreKindOf(cursor, { kindOf: appKind });
  export const describe = (route: AomRoute) => coreDescribe(route, { kindOf: appKind });
  export const describeRouter = (router: Router) => coreDescribeRouter(router, { kindOf: appKind });
  export const manifestOf = (router: Router) => coreManifestOf(router, { kindOf: appKind });
  export { parentsOf, routeName } from "@aom-js/router/testing";
  ```
  Удаляются: `ManifestParamsBuilderBase`, `builderBases`, `inFamily`/`inheritedFrom` (если больше не нужны `isContainer`/`isService` — оставить `inFamily`), собственные тела `kindOf`/`describe`/`describeRouter`/`manifestOf`/`parentsOf`/`routeName`.

- [ ] **Step 1: Снять дамп «до»**: `cd test && bun run manifests && git status --short manifests` — чисто (дамп уже актуален).
- [ ] **Step 2: Переписать фасад** `index.ts` как выше.
- [ ] **Step 3: `properties.test.ts`**: P1, P2, P7, P8 вызывают `sharedEndpoints`, `identCollisions`/`accessIdents`, `serializationErrors`, `constructorThisRefs` из `@aom-js/router/testing`; P7 дополнительно вызывает фасадный `describeRouter` (обогащённая выгрузка тоже строится). Пороги «поиск жив» прежние (248, 32, 7, 341). Нарушители P1, P7, P8 удалить (перенесены в ядро); нарушитель P2 на `AccessController` приложения оставить — он проверяет связку с классом приложения.
- [ ] **Step 4: `form.test.ts`**: `repeatsOf(route)` → `repeatsOf(route, { kindOf, writes: (c) => writtenBy(c).length > 0, harmless: [AomCursorKind.Transport, AomCursorKind.Checkpoint] })` из `@aom-js/router/testing`; локальные `repeatsOf`, `routeName` удалить; ветки в сообщениях сопоставить новым `RepeatBranch` (`"kind"` ↔ «вид», `"next-group"` ↔ «группа @Next», `"after-handler"` ↔ «после обработчика»); `REPEATS_REMAINDER` прежний.
- [ ] **Step 5: `kinds.test.ts`**: оставить случаи на эталоне countries (транспорт контейнера, гейт `AccessController`, сборщик), удалить перенесённые в ядро (`describe` с лишним полем, ParamsBuilder → Input, порядок `describeRouter`).
- [ ] **Step 6: Run** `cd main && bun run build`, затем `cd test && bun run manifests && git status --short manifests` — дамп побайтно прежний (пустой вывод); `bun test` — тот же счёт pass/skip/fail, что до Task 4, минус удалённые тесты; `bun run test:types`; `cd .. && ./verify.sh --fast` — OK.
- [ ] **Step 7: Commit** (`test`): `manifest: факты и общие правила цепочки — из ядра (@aom-js/router/testing, @aom-js/api/testing); в приложении — вид Transport и толкования`.

### Task 5: родитель шага в выгрузке и дампе

**Files:**
- Modify: `main/packages/api/src/testing/manifest.ts`, `main/packages/api/test/manifest.test.ts`, `test/manifests/*.json` (пересборка)

**Interfaces:**
- `DescribedStep = AomCursorJSON & { kind: AomCursorKind; parent: number }`; `parent` — значение `parentsOf(route.cursors)[i]`, в шаге сразу после `via`/`viaGroup`, перед `kind`.

- [ ] **Step 1: Failing test**: в `manifest.test.ts` маршрут с классовым `@Before`, `@Before` на методе и `@After` → `steps.map((s) => s.parent)` равен `parentsOf(route.cursors)`; верхние шаги → `-1`.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** поле `parent` в `describe`.
- [ ] **Step 4: Run** `bunx vitest run`, `bun run build`; `cd test && bun run manifests` — в диффе дампа только добавленные строки `"parent": N`; `bun test src/lib/manifest test/fixtures` — PASS.
- [ ] **Step 5: Commit** — два коммита: `main` (`api/testing: родитель шага в выгрузке`), `test` (`manifests: родитель шага в дампе`).

### Task 6: документация ядра о тестировании и ссылки на неё

**Files:**
- Create: `main/docs/testing.md` — «Тестирование приложения на ядре»
- Modify: `main/docs/readme.md` (строка в «Документы каталога»), `main/packages/router/readme.md` (раздел «Метаданные цепочки», `:592` — выводимые виды теперь в `@aom-js/api/testing`; раздел «Зонды» — ссылка на правила цепочки), `main/packages/api/readme.md` (раздел про `@aom-js/api/testing`), `test/docs/testing.md` (разделы «Проекция цепочки и дамп», «Свойства цепочки»: общие правила — ссылкой на `main/docs/testing.md`, здесь — только своё: вид Transport, толкования писателя/читателя, P3–P5, пороги, остатки, архетипы), `/home/devel/code/aom-js/.claude/skills/aom-dev-workflow/SKILL.md` (этап 2: `describe` — фасад `test/src/lib/manifest` над `@aom-js/api/testing`).

`main/docs/testing.md` содержит, по разделу:
1. **Что ядро выгружает** — факты: `toJSON` роутера/маршрута/курсора, `describe`/`describeRouter`/`manifestOf`, поле `kind` и `parent`; правила вывода вида ядра и их порядок; `ManifestOptions.kindOf`.
2. **Что решает приложение** — список из спеки, Global Constraints: вид своих классов, писатель/читатель, служебный маршрут, пороги, остатки, архетипы, `@CursorKind` там, где вывод невозможен; смысл объявленного вида задаёт приложение (`Value` в словаре ядра описан узко).
3. **Общие правила** — P1, P2, P6, P7, P8: что ловит каждое, сигнатура, как приложение оформляет тест (функция ядра → `expect(...).toEqual([])` + «поиск жив» с порогом). Номера P — те же, что в `test/docs/testing.md#свойства-цепочки`.
4. **Дамп** — `manifestOf` + файл на роутер + тест актуальности в приложении (пример — `test/scripts/manifests.ts`, `test/src/lib/manifest/dump.test.ts`).
5. **Как подключить новое приложение** — минимальный фасад (как `test/src/lib/manifest/index.ts`), первые тесты-свойства; зонды — ссылка на раздел «Зонды» `packages/router/readme.md` (якорь взять из заголовка `:755`).
Примеры кода — исполняемые (взяты из тестов Task 1–5) или с пометкой `// псевдокод`.

- [ ] **Step 1: Написать** `main/docs/testing.md` и правки ссылок.
- [ ] **Step 2: Проверить ссылки**: `cd test && bun test test/links-docs.test.ts test/links-code.test.ts test/helpers/links.test.ts` — PASS (якоря существуют, нет ссылок на specs/plans/beads из docs).
- [ ] **Step 3: Commit** — `main` (`docs: тестирование приложения на ядре — факты, общие правила, граница с приложением`) и `test` (`docs: свойства цепочки — общие правила в ядре`).

### Task 7: финальная проверка

- [ ] `cd /home/devel/code/aom-js && ./verify.sh` (полный) — OK.
- [ ] Поиск копий: `grep -rn "function parentsOf\|function repeatsOf\|function sharedEndpoints\|function constructorThisRefs\|builderBases" test/src test/test` — пусто.
- [ ] `ponytail:ponytail-review` на дифф обоих репозиториев; закрыть задачи `bd` с причиной (что сделано, числа прогонов, коммиты).
