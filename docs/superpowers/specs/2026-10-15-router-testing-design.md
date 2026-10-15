# Зонды в `@aom-js/router/testing` — спека (aom-main-oiy)

Задача beads `aom-main-oiy` (база main). Решения владельца 2026-10-15 — в её описании, разбор — в поле design. Здесь — как именно это делается.

## Цель

Библиотека зондов (`test/src/lib/tester`) переезжает в пакет `@aom-js/router`, путь `@aom-js/router/testing`, и перестаёт обходить ядро: нет подмены `route.cursors`, нет вызова приватного `AomRoute.plain`, грамматика адреса одна на сервер и прогонщик. Только точечная схема (один класс зондов — один эндпоинт). Сквозной зонд §5.4, `RxContext.created`, покрытие §8 — не здесь.

## Открытый вопрос (нужно решение)

**Где экспортируется компилятор пути.** П. 4 задачи: «компилятор пути сервера переезжает в router, Server из `@aom-js/api` берёт его оттуда». Критерий 2: «корень `@aom-js/router` не расширен». `api` видит `router` только через `exports` пакета, поэтому одно из двух условий придётся нарушить.

| Вариант | Цена |
|---|---|
| **А (рекомендую).** `compilePath` экспортируется из корня `@aom-js/router` — одна функция, исключение из критерия 2 | корень +1 имя; к зондам не относится, `AomRoute` не меняется |
| Б. `compilePath` — из `@aom-js/router/testing`, `Server` импортирует его оттуда | боевой сервер зависит от тестового пути; при загрузке `api` грузится и модуль зондов |
| В. Третий путь `@aom-js/router/path` | ещё один путь в exports, smoke и алиасе ради одной функции |

Ниже спека написана под вариант А; при Б или В меняется только строка импорта в `http.ts` и `late-writes.test.ts`.

## Сборка (`main/scripts`, `vitest.config.ts`)

- `package.src.json` пакета `router` получает `exports["./testing"]` той же формы, что `"."` в шаблоне (`dist/{mjs,cjs,types}/testing/index.*`).
- `prebuild.js`: после наложения шаблона `exports = { ...шаблон.exports, ...exports пакета }` — пакет добавляет путь, шаблон по-прежнему задаёт `"."`.
- `clean.js` (режим разработки, `main: ./src/index.ts`): поле `exports` не пишется — иначе собственный `exports` пакета без `"."` закрыл бы корень. Путь `./testing` в этом режиме недоступен, как и раньше всё, что не `main`.
- `smoke.js`: проверяет каждый ключ `exports` каждого пакета (`.` → имя пакета, `./x` → `имя/x`) через `require()` и `import()`. Для router это `@aom-js/router` и `@aom-js/router/testing`.
- `vitest.config.ts`: алиас `@aom-js/router/testing` → `packages/router/src/testing` **перед** `@aom-js/router` (vite берёт первый подходящий префикс).

## Ядро

### `common/path.ts` (новый)

Грамматика адреса — одно определение параметра пути и компилятор, перенесённый из `RouteMatcher.compilePath` (`api/src/server/http.ts`) без изменения поведения (экранирование KI-API-19, валидатор встроен в шаблон, KI-API-01):

```ts
/** `:name` or `:name(validator)` — the only definition of a path parameter. */
export const PATH_PARAM = /:([^/()]+)(?:\(([^)]+)\))?/;
export function compilePath(path: string): { pattern: RegExp; paramNames: string[] };
```

`compilePath` экспортируется (вариант А — из корня), `PATH_PARAM` — только внутри пакета. `RouteMatcher` в `api` зовёт `compilePath` из router, свой статический метод удаляется. Тесты KI-API-19/KI-API-01 в `api/test/server.test.ts` остаются стражем переноса.

### `common/route.ts`

Приватный метод `AomRoute.plain` становится функцией модуля `plain(cursors, into = [])` — тот же обход, тот же порядок. Конструктор: `this.cursors = plain([...])`. В баррель `common/classes.ts` функция не попадает, публичный API `AomRoute` не меняется (приватный член из `.d.ts` уходит).

### `src/testing/` (новый)

| Файл | Что |
|---|---|
| `report.ts` | `TesterReport`, `CheckResult` — без изменений по смыслу |
| `decorators.ts` | `@Tester`, `@Probe`, `@Observe`, `@Report`, `isTester(cls)`; внутренние `aggregate`, `runnable`. `RunContext` и `ClassOf` не нужны: `RxContext` и `ClassConstructor` доступны внутри пакета |
| `runner.ts` | `runProbes`, `runSteps`, `RunOptions` |
| `index.ts` | баррель пути `@aom-js/router/testing` |

**`runProbes(tester, router, options?)`** — та же форма и опции (`values`, `cursors`, `preset`), что сейчас. Отличия внутри:
- маршрут — `router.routeOf(endpoint)` (его ошибки `ROUTE_OF_NOT_FOUND_ERROR`/`ROUTE_OF_AMBIGUOUS_ERROR`); проверка «нет `@Tester()`» остаётся до него;
- контекст — `new RxContext(values, route)`; `preset` и `TesterReport` кладутся в `state` до прогона; шаги — `context.run(steps)`, ошибка маршрута → `report.routeError`; каждый зонд — отдельный `context.run([конверт])` на том же контексте;
- `cursors` по ссылкам разворачиваются функцией `plain` напрямую;
- адрес: значения из `params` подставляются в шаблон по `PATH_PARAM`, готовый адрес сверяется с `compilePath(route.path).pattern`, захваченные группы — с поданными значениями. Недостающий или лишний параметр — ошибка до прогона, как сейчас;
- `route.cursors` не читается на запись нигде; прогоны реентерабельны.

**`runSteps(route, values?, steps = route.cursors)`** — вход для `late-writes.test.ts`: прогон выбранных шагов маршрута в свежем контексте. Значения дополняются до формы сервера (как в `runProbes`), адрес проверяется той же грамматикой, шаги обязаны быть курсорами этого маршрута (иначе ошибка) и исполняются в порядке маршрута. Возвращает результат цепочки, ошибку бросает — как `route.apply`.

**`isTester(cls)`** — нужен проверке изоляции приложения («ни один класс зондов не стоит ни в одном маршруте»); реестр `testers` наружу не отдаётся.

Сообщения об ошибках — по-английски, как остальной код пакета; смысл и место проверки те же.

### Тесты ядра — `packages/router/test/testing.test.ts` (vitest)

Маленький роутер-фикстура в самом тесте. Переносятся все случаи `index.test.ts` приложения (зонд без утверждений; `@Observe` отсутствующего; возврат значения; порядок нескольких зондов; нет `@Tester`; нет `@Probe`; класс зондов не контроллер; эндпоинта нет в роутере; шаг вне маршрута; параметр доходит до шага и шаг развёрнут со своими `@After`; нет параметра; параметр не проходит проверку; лишний параметр). Новые: `preset` отменяет создание и хуки; упавший маршрут не отменяет зонды; два одновременных `runProbes` на одном маршруте оба зелёные и `route.cursors` не тронут; `runSteps` — исполняет только поданные шаги, отвергает чужой курсор и неверный адрес, `route.cursors` не тронут; адрес с точкой в шаблоне — точка буквальная (KI-API-19 на стороне прогонщика).

### Readme router

Раздел «Зонды (`@aom-js/router/testing`)» — из `README.md` компонента: назначение, быстрый старт, декораторы, опции, `runSteps`, ошибки. Абзац о `AomRoute.plain` и «Внутренние модули» — по новой раскладке; `compilePath` — в публичный API.

## Приложение (`test`)

1. 45 файлов: `@/lib/tester` → `@aom-js/router/testing`. Каталог `src/lib/tester` удаляется целиком.
2. `late-writes.test.ts`: часть B — `runSteps(route, values, route.cursors.slice(0, at))` вместо подмены `route.cursors`; часть A — `runSteps(route, values)` вместо `route.apply` (адрес проверяется). `pathParams(route)` — имена из `compilePath(route.path).paramNames`, значения — `randomUUID()` (все параметры приложения — uuid; несовпадение даст громкую ошибку `runSteps`, а не тихий 404).
3. `isolation.test.ts` переезжает в `test/probes-isolation.test.ts` (вне `src/` — иначе сам попал бы под свой же поиск): ищет `@aom-js/router/testing`, `testers.has` → `isTester`.
4. Документация: `probes.md` (статус, §2, §9, §10, ссылки на README), `testing-invariants.md` §7 и строки-ссылки, `testing.md`; ссылки на `src/lib/tester/*` в комментариях тестов; `known-issues.md` KI-API-19 — новый адрес `compilePath`; `api/readme.md` — раздел `RouteMatcher`.

## Проверка

- main: `bunx vitest run`, `bun run build` (smoke видит `@aom-js/router/testing` в обоих форматах).
- test: `bun test` — 0 fail, пропусков не больше базы (база 2026-10-15: 692 pass / 201 skip / 0 fail, 893 теста; число pass уменьшится на 13 тестов `index.test.ts`, переехавших в vitest); `bun run test:types` чисто; `AOM_TEST_DB=1 PG_DB_NAME=aom_test bun test test/integration/probes.test.ts test/integration/late-writes.test.ts` зелёные, сводки частей A и B совпадают с базой (A: 1061 комбинация, ok=238; B: 87 маршрутов, ok=6); `../verify.sh --fast`.
- `grep` по обоим репозиториям: нет `route.cursors =`, `capture`, `Reflect.get(AomRoute.prototype`.
