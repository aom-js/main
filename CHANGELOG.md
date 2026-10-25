# Изменения

Одна версия на все пакеты `@aom-js/*`; правила выпуска — [на сайте документации](https://aom.js.org/publishing/).

## 0.2.0

Несовместимый выпуск: статичные члены базовых контроллеров `api` названы с заглавной буквы, как шаги и маршруты. Наследники переименовывают свои поля; переходных имён нет.

- `api`: `BaseAccessController` — `markerName` → `MarkerName`, `allowedAccessTypes` → `AllowedAccessTypes`, `setAccessMark` → `SetAccessMark`. Ключ маркера на маршруте — по-прежнему значение `MarkerName`, сохранённые роли не меняются.
- `api`: `BaseRootController.RouteElement` стал статичным, как `RoutesStructure`: наследник пишет `static readonly RouteElement = ...`. `markersToRoute` получает экземпляр `RouteElement`. Кэш `docsJSON` → `DocsJSON`.
- `api`: контроллер WebSocket-точки держит реестр в `static Sockets` (было `sockets`), в типе `WithWebSockets` — `Sockets` и `SocketsParam`; `WebSocketsController.wssMap` → `WssMap`.
- `api`: `IDController` — `attr` → `Attr`, `pattern` → `Pattern`, `param()` → `Param()`; `toString()` прежний.
- `api`: `BaseVisualizerController.visualizerOptions` → `VisualizerOptions`, защищённый `visualizer()` → `CreateVisualizer()`.

## 0.1.3

Проверка входящих данных стала строже: запросы, которые раньше молча проходили, теперь получают 400.

- `schemer`: `PropertySchema.Type` и `PropertySchema.Any` без `isOptional`, `nullable` и `hidden` требуют значение, как и обещает `required` в схеме; в схеме у них появилось `not: {type: "null"}`.
- `schemer`: `PropertySchema.Boolean` принимает только `true`/`false`, `"true"`/`"false"`, `"1"`/`"0"`; прочее (`"yes"`, `""`, числа) — ошибка проверки. `QueryBoolean` из `api` — так же.
- `schemer`: `PropertySchema.Number` и `Boolean` приводят значение после своих `decorators` и поэлементно при `isArray` — `?ids=1,2` с `TransformToArray()` даёт `[1, 2]`.
- `schemer`: `String`, `Number`, `Boolean`, `Date`, `Any` можно вызывать без аргумента; пустая схема ответа, тела или параметра роняет сборку `Router` ошибкой `OPENAPI_SCHEMA_UNDEFINED_ERROR` с адресом шага.
- `api`: `TransformTrim` обрезает только строки, остальное отдаёт как есть.
- `api`: ответ 404 «адрес не найден» переводится; ожидаемые ответы 4xx сервер больше не печатает в `console.error`.
- `api`: `JSONSchema()` успешного ответа берёт `static description` и `static status` класса; `data` в схеме ошибки необязательное.
- `router`: `FwdRef` в `@Before`, `@After`, `@Next`, `@UseMarker` разворачивается при сборке `Router` — работает для класса ниже по файлу и для циклических импортов. Поля связей шага (`pre_middlewares`, `post_middlewares`, `nextpoint`, `markers`) только для чтения.
- `router`: `@MergeNextTags`, `@IgnoreNextTags`, `@ReplaceNextTags` действуют и без своего `@UseTag`; параметр пути подставляется по ключу, а не по первому совпадению текста (`:id` не задевает `:id2`).
- `holder`: при `@Apply` побеждает ближний класс, а не дальний предок; обычный класс посередине цепочки больше не теряет декораторы предков.

## 0.1.2

- Внутренние зависимости пакетов снова указывают на ту же версию: в 0.1.1 они были закреплены на 0.1.0, и установка 0.1.1 ставила в проект вторые копии `core`, `schemer` и `router`.
- `bun run release` останавливается, если версии пакетов в `bun.lock` отстают от корневой.

## 0.1.1

- Ссылки на документацию ведут на сайт https://aom.js.org/. Не использовать: внутренние зависимости пакетов закреплены на 0.1.0.

## 0.1.0

- Первый выпуск всех пакетов одной версией: `core`, `schemer`, `router`, `transfer`, `holder`, `codegen`, `visualizer`, `api`.
- Впервые в npm: `router`, `codegen`, `holder`, `visualizer`.
- `@aom-js/api` теперь зависит от `@aom-js/router`; прежние выпуски `@aom-js/api` (до `0.0.18`) от него не зависели.
