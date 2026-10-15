# `@aom-js/router`

Пакет строит карту HTTP/WS-маршрутов из классов-контроллеров со статическими методами и исполняет запрос как линейную цепочку курсоров. Здесь же живут DI через `state`, отложенные ссылки, маркеры и генерация документа OpenAPI 3.1. Состояние на 2026-09-02, сверено с кодом на диске 2026-09-21 (`KI-ROUTER-01, 03, 04, 06, 07, 11, 12` закрыты 2026-09-14; `KI-ROUTER-16, 17` устранены 2026-09-21 двухстадийной публикацией инстанса — `state` только после хуков, см. §«Инстансы, `state` и `@OnInstance`»; та же правка добавила ленивые значения контекста, §«Ленивые значения контекста»; `test/docs/known-issues.md` эту правку пока не отражает; `KI-ROUTER-14, 18` без изменений).
Читать до: `main/packages/core/readme.md` (реестр мета-инстансов, фазы, наследование). Читать после: `main/packages/api/readme.md` (сервер, билдеры, доступ), `test/docs/request-lifecycle.md` (трассировки запросов приложения).
Термины — `test/docs/README.md#словарь`.

## Назначение и место в стеке

Пакет отвечает за две задачи: **сборку** (из дерева контроллеров получить `Router.routes` — плоские маршруты с путём, методом и списком курсоров) и **исполнение** (`AomRoute.apply(values)` — последовательный прогон курсоров с DI и сборкой аргументов). Метаданные не хранятся в самом пакете: каждый класс и каждый его декорированный метод получают мета-инстанс `AomApi` — наследника `AomCore` из `@aom-js/core`, с прикладными полями `element` (роль метода и списки связей) и `openApi` (декларации для документа). Декораторы пакета только заполняют эти поля (`packages/router/src/common/api.ts` (`AomApiElement`, `AomHttpOpenApi`)); когда именно выполняется тело декоратора, определяет фаза из `@aom-js/core` (`packages/core/src/defines/callstack.ts` (`AomCallstackQueue.add`, `AomCallstackQueue.transferTo`)).

Зависимости: `@aom-js/core` (реестр, фазы, наследование, `resolveFor`), `@aom-js/schemer` (`Schemer` + `SchemasCollector` для рендера компонент-схем в `components.schemas`), `rxjs` (последовательное исполнение), `openapi3-ts` (типы документа). Потребители: `@aom-js/api` — `Server` матчит путь и вызывает `route.apply(...)`, билдеры и `BaseAccessController` строятся на декораторах и маркерах роутера; приложение импортирует роутер напрямую в каждом контроллере (`test/src/modules/orgs/api/router.ts`). Полный граф пакетов и порядок сборки монорепо — `main/docs/architecture.md` §«Состав…».

## Публичный API

Экспорт — `src/index.ts`: `decorators`, `specials`, `types`, `classes`, `common/openapi`, `common/classes`, `common/types`, `common/lazy`. Файлы `common/references.ts` и `constants/errors.ts` в реэкспорт не входят — контейнеры ссылок и коды ошибок доступны только как типы в сигнатурах и как строки в сообщениях `Error`.

Число в колонке «Используется приложением» — количество файлов `test/src`, импортирующих символ из `"@aom-js/router"` (не количество применений: например, у `This` 154 импорта при 646 применениях `@This(`); после числа — путь к файлу-образцу со строкой импорта.

### Классы и модель маршрута

| Экспорт                                                   | Сигнатура                                                                                                                                                | Назначение                                                                                                                                                                                                                                                     | Используется приложением                                                                        |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `Router`                                                  | `new Router(root: ClassType, docs: OpenApi)`; `routes: AomRoute[]`; `sockets: AomRoute[]`; `routeOf(endpoint: Function): AomRoute`; `toJSON(): AomRouterJSON` | Обход дерева контроллеров по бриджам, сборка маршрутов, регистрация их в OpenAPI                                                                                                                                                                               | да (`test/src/modules/*/api/index.ts`)                                                          |
| `OpenApi`                                                 | `new OpenApi(initData: OpenAPIObject)`; `registerPath(route)`; `toJSON()`; `static tagsSeparator = " > "`; `static readonly refPointerPrefix`            | Накопитель и генератор документа OpenAPI 3.1                                                                                                                                                                                                                   | да (`test/src/modules/*/api/init.ts`)                                                           |
| `AomApi`                                                  | `class AomApi extends AomCore { openApi; element; delayStack; delayRealized; title?; description?; toString(); static instanceWithHooks(target, args) }` | Мета-класс роутера; `AomApi.instance(target, property?)` — доступ к реестру                                                                                                                                                                                    | да (`test/src/modules/orgs/api/routes/permissions/init/controllers/org-users/current-value.ts`) |
| `AomCursor`                                               | `new AomCursor($: AomApi, origin: AomApi, prefix: string, endpoint?: AomEndpoint)`; `$`, `origin`, `prefix`, `endpoint`, `index`; `via?`, `viaGroup?`; `parameters(): AomCursorParameter[]`; `toJSON(created?): AomCursorJSON` | Единица исполнения цепочки; при создании перепривязывается и реализует `delayStack`                                                                                                                                                                            | да, как тип (`test/src/modules/tickets/api/routes/tickets/init/controllers/value.ts`)           |
| `AomRoute`                                                | `router; endpoint; path; method; markers: MarkerType; cursors: AomCursor[]; apply(context: HttpContextValues): Promise<any>`; `toJSON(): AomRouteJSON` | Готовый маршрут                                                                                                                                                                                                                                                | да (`test/src/common/controllers/protected.ts` (`AomRoute`))                                    |
| `TagsRules`                                               | `enum { IGNORE, MERGE, REPLACE }`                                                                                                                        | Правило слияния тегов                                                                                                                                                                                                                                          | нет                                                                                             |
| `RxContext`                                               | `values; state: ClassInstanceMap; route; run(cursors); value(key)`                                                                                       | Контекст одного исполнения маршрута: `state` — только проверенные хуками инстансы; `pending`/`inflight`/`waits` — служебные карты идущих созданий; `value(key)` разворачивает ленивое поле `values`. **Не экспортируется** (`common/classes.ts` (`RxContext`)) | нет                                                                                             |
| `FwdContainer` / `ThisRefContainer` / `RouteRefContainer` | `exec(constructor?)`                                                                                                                                     | Контейнеры отложенных ссылок. **Не экспортируются** (`common/references.ts` (`FwdContainer`, `ThisRefContainer`, `RouteRefContainer`)), создаются фабриками                                                                                                    | нет                                                                                             |

### Декораторы структуры

| Экспорт                                 | Сигнатура                                                                        | Назначение                                                | Используется приложением                                                            |
| --------------------------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `Controller`                            | `Controller(): ClassDecorator`                                                   | Наследование декораторов предков + разбор LAST-очереди    | да (207; `test/src/modules/orgs/api/routes/orgs/index.ts` (`Controller`))           |
| `Get/Post/Put/Patch/Delete/Options/All` | `(path?: string): MethodDecorator`; `(path: string, handler): ClassDecorator`    | Эндпоинт; классовая форма подключает чужой `@Nextpoint()` | да, только методная форма                                                           |
| `Endpoint`                              | `Endpoint(method: HTTPMethods, path = "/")`                                      | Базовый эндпоинт-декоратор                                | нет                                                                                 |
| `Nextpoint`                             | `Nextpoint(): MethodDecorator`                                                   | Метод-продолжение для `@Next` и классовой формы эндпоинта | да (45; `test/src/common/controllers/entity.ts` (`Nextpoint`))                      |
| `WebSocketPoint`                        | `WebSocketPoint(path?: string)`                                                  | Эндпоинт метода `sockets` → `Router.sockets`              | нет                                                                                 |
| `Middleware`                            | `Middleware(): MethodDecorator`                                                  | Помечает метод как middleware                             | да (135; `test/src/modules/orgs/api/routes/orgs/index.ts` (`Middleware`))           |
| `Before` / `After`                      | `(...mw: Array<MiddlewareHandler \| FwdContainer>): CombinedDecorator`           | pre/post-middleware класса или метода                     | да (123 / 49; `test/src/modules/orgs/api/routes/orgs/index.ts` (`Before`, `After`)) |
| `Bridge`                                | `Bridge(prefix: string, next: ClassType): CombinedDecorator`                     | Монтирование дочернего контроллера под префиксом          | да (44; `test/src/modules/orgs/api/routes/orgs/index.ts` (`Bridge`))                |
| `Next`                                  | `Next(handler: HandlerFunction \| FwdContainer): MethodDecorator`                | Назначает методу nextpoint                                | да (66; `test/src/modules/orgs/api/routes/orgs/index.ts` (`Next`))                  |
| `OnInstance`                            | `OnInstance(): MethodDecorator`                                                  | Хук после создания инстанса класса                        | да (11; `test/src/common/controllers/current-data/current-org.ts` (`OnInstance`))   |
| `Marker` / `UseMarker`                  | `Marker(): MethodDecorator`; `UseMarker(handler: MarkerHandler \| FwdContainer)` | Build-time обработчик маршрута                            | нет (через `@aom-js/api`)                                                           |
| `CursorKind`                            | `CursorKind(kind: AomCursorKind): MethodDecorator`                               | Вид шага на его определении (там, где приложение не выводит вид); значение вне словаря и повтор — `CURSOR_KIND_DEFINE_ERROR` | нет (новый, этап 1 спеки метаданных) |

### Декораторы аргументов

Все — параметр-декораторы фазы LAST, объявлены в `src/decorators/arguments/index.ts`.

| Экспорт                                             | Сигнатура                                                                 | Назначение                                                                                                                                 | Используется приложением                                                                                                                            |
| --------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Args`                                              | `Args(handler?: (args: {context, cursor, route}) => any, descriptor?: AomParameterDescriptor)`                 | Базовый декоратор аргумента                                                                                                                | нет (через `@aom-js/api`)                                                                                                                           |
| `Query` / `Body` / `Params` / `Cookies` / `Headers` | `(handler?: Function \| ThisRefContainer \| RouteRefContainer \| string)` | Значение из соответствующего поля контекста; поле может быть ленивым (`lazy(...)`) — тогда фабрика вызывается не раньше первого обращения  | нет напрямую; обёрнуты билдерами `@aom-js/api`                                                                                                      |
| `Session` / `Files`                                 | `(name?: string)`                                                         | `values.session` / `values.files` целиком или по ключу; тоже может быть ленивым                                                            | `Files` — да (`test/src/modules/files/api/routes/files/index.ts`)                                                                                   |
| `Ctx` / `Req` / `Res`                               | `()`                                                                      | `values.ctx` / `values.req` / `values.res`                                                                                                 | `Ctx` — да (2; `test/src/modules/files/api/routes/files/index.ts` (`Ctx`))                                                                          |
| `Cursor` / `Route`                                  | `()`                                                                      | Текущий курсор / маршрут                                                                                                                   | да (по 1; `test/src/modules/tickets/api/routes/tickets/init/controllers/value.ts` (`Cursor`), `test/src/common/controllers/protected.ts` (`Route`)) |
| `State`                                             | `State(constructor?)`                                                     | Инстанс из `state` (только прошедший свои хуки) или весь `state`                                                                           | нет                                                                                                                                                 |
| `This`                                              | `This(ctor?: ClassConstructor \| FwdContainer \| RouteRefContainer \| ThisRefContainer)` | Инстанс класса, создаётся при отсутствии; публикуется только после хуков — чужой код ждёт или получает `CIRCULAR_INSTANCE_ERROR` при цикле | да (154; `test/src/modules/orgs/api/routes/orgs/index.ts` (`This`))                                                                                 |
| `Run`                                               | `Run()`                                                                   | Функция `(...handlers) => Promise<any>` — прогон дополнительных курсоров                                                                   | нет                                                                                                                                                 |
| `Err`                                               | `Err(ErrorConstructor = Error)`                                           | Фабрика ошибки со `status`/`data`                                                                                                          | нет                                                                                                                                                 |

### Декораторы документации и OpenAPI

| Экспорт                                                | Сигнатура                                                                                        | Назначение                                                      | Используется приложением                                                                                                             |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `Title` / `Description`                                | `(value: string): CombinedDecorator`                                                             | `summary`/`description` операции; `Title` также задаёт имя тега | да (65 / 3; `test/src/modules/orgs/api/routes/orgs/index.ts` (`Title`), `test/src/modules/auth/api/routes/index.ts` (`Description`)) |
| `Responses`                                            | `Responses(...schemas: OpenApiResponse[])`                                                       | Ответы операции                                                 | да (74; `test/src/common/controllers/current-data/current-org.ts` (`Responses`))                                                     |
| `RequestBody`                                          | `RequestBody(schema: OpenApiRequestBody)`                                                        | Тело запроса                                                    | да (1; `test/src/modules/files/api/routes/files/index.ts` (`RequestBody`))                                                           |
| `PathParameters`                                       | `PathParameters(...schemas: OpenApiPathParameters[])`                                            | Параметры пути; ключ — литеральный сегмент пути                 | нет (через `ParamsBuilder`)                                                                                                          |
| `QueryParameters` / `CookieParameters` / `Parameters`  | `(...schemas)`                                                                                   | Параметры `query` / `cookie` / произвольные                     | нет (через билдеры)                                                                                                                  |
| `Security`                                             | `Security(schema: OpenApiSecuritySchema): CombinedDecorator`                                     | Схема безопасности операции                                     | нет (через auth-контроллеры)                                                                                                         |
| `UseTag`                                               | `UseTag(constructor: ClassType)`                                                                 | Тег операции по классу                                          | да (40; `test/src/modules/orgs/api/routes/orgs/index.ts` (`UseTag`))                                                                 |
| `IgnoreNextTags` / `MergeNextTags` / `ReplaceNextTags` | `()`                                                                                             | Правило слияния тегов                                           | `MergeNextTags` — да (5; `test/src/modules/tickets/api/routes/index.ts` (`MergeNextTags`))                                           |
| `DelayRefStack`                                        | `DelayRefStack(handler: FwdContainer \| ThisRefContainer \| RouteRefContainer): MethodDecorator` | Отложенные декораторы, реализуемые при создании курсора         | да (2; `test/src/common/controllers/protected.ts` (`DelayRefStack`))                                                                 |

### Фабрики ссылок и типы

| Экспорт                                                                                                                                                                                                  | Сигнатура                                                                                                                                                                                                                   | Назначение                                                                                                                                                                                                                | Используется приложением                                                                 |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `FwdRef`                                                                                                                                                                                                 | `FwdRef(fn: () => HandlerFunction \| ClassType): FwdContainer`                                                                                                                                                              | Ссылка без контекста (циклические импорты)                                                                                                                                                                                | нет                                                                                      |
| `ThisRef`                                                                                                                                                                                                | `ThisRef(fn?: (ctor: ClassType) => any): ThisRefContainer`                                                                                                                                                                  | Ссылка с классом текущего курсора                                                                                                                                                                                         | да (2; `test/src/common/controllers/protected.ts` (`ThisRef`))                           |
| `RouteRef`                                                                                                                                                                                               | `RouteRef(fn?): RouteRefContainer`                                                                                                                                                                                          | Ссылка с классом эндпоинта маршрута                                                                                                                                                                                       | нет                                                                                      |
| `HttpContextValues`                                                                                                                                                                                      | `{ctx, req, res, body: any, files: any, query: Lazy<...>, params: Lazy<...>, cookies: Lazy<...>, headers: Lazy<...>, session: Lazy<...>}`                                                                                   | Контракт входа `AomRoute.apply`; `query`/`params`/`cookies`/`headers`/`session` принимают готовое значение либо `lazy(...)`, `body`/`files` — `any`, но по тому же контракту (`src/types/index.ts` (`HttpContextValues`)) | нет напрямую                                                                             |
| `lazy`                                                                                                                                                                                                   | `lazy<T>(factory: () => T \| Promise<T>): LazyValue<T>`                                                                                                                                                                     | Оборачивает фабрику дорогого значения контекста запроса — вызывается не раньше первого обращения и максимум один раз за запрос                                                                                            | нет                                                                                      |
| `LazyValue`                                                                                                                                                                                              | `class LazyValue<T> { readonly factory: () => T \| Promise<T> }`                                                                                                                                                            | Обёртка, которую разворачивает `RxContext.value(key)`; конструктор не вызывается напрямую, только через `lazy(...)`                                                                                                       | нет                                                                                      |
| `Lazy<T>`                                                                                                                                                                                                | `type Lazy<T> = T \| LazyValue<T>`                                                                                                                                                                                          | Тип поля `HttpContextValues`: готовое значение или `lazy(...)` (`src/common/lazy.ts`)                                                                                                                                     | нет                                                                                      |
| `RunFunction`                                                                                                                                                                                            | `(...middlewares: HandlerFunction[]) => Promise<any>`                                                                                                                                                                       | Тип результата `@Run()`                                                                                                                                                                                                   | нет                                                                                      |
| `HTTPMethods`                                                                                                                                                                                            | `"get" \| "post" \| "put" \| "patch" \| "delete" \| "options" \| "all" \| "sockets"`                                                                                                                                        | Методы маршрута                                                                                                                                                                                                           | да (через `@aom-js/api`)                                                                 |
| `HandlerFunction` / `MiddlewareHandler` / `FwdFunction` / `RefFunction` / `ContainerFunction`                                                                                                            | `src/common/types.ts` (`HandlerFunction`, `MiddlewareHandler`, `FwdFunction`, `RefFunction`, `ContainerFunction`)                                                                                                           | Базовые функциональные типы                                                                                                                                                                                               | `RefFunction` — да (2; `test/src/common/controllers/protected.ts` (`RefFunction`))       |
| `AomBridge` / `AomEndpoint` / `MarkerType` / `MarkerHandler` / `ArgumentsHandlerParameters` / `ArgumentsDecoratorHandler`                                                                                | `src/common/classes.ts` (`AomBridge`, `AomEndpoint`, `MarkerType`, `MarkerHandler`, `ArgumentsHandlerParameters`, `ArgumentsDecoratorHandler`)                                                                              | Структурные типы                                                                                                                                                                                                          | `MarkerType` — да (1; `test/src/common/controllers/module/controller.ts` (`MarkerType`)) |
| `OpenApiPossibleSchema` / `OpenApiSchemaObject` / `OpenApiSecuritySchema` / `OpenApiParameterObject` / `OpenApiResponse` / `OpenApiRequestBody` / `OpenApiPathParameterObject` / `OpenApiPathParameters` | `src/common/openapi.ts` (`OpenApiPossibleSchema`, `OpenApiSchemaObject`, `OpenApiSecuritySchema`, `OpenApiParameterObject`, `OpenApiResponse`, `OpenApiRequestBody`, `OpenApiPathParameterObject`, `OpenApiPathParameters`) | Типы деклараций OpenAPI                                                                                                                                                                                                   | `OpenApiResponse` — да (2; `test/src/common/controllers/entity.ts` (`OpenApiResponse`))  |
| `OpenAPIObject`                                                                                                                                                                                          | реэкспорт `openapi3-ts/oas31`                                                                                                                                                                                               | Тип документа                                                                                                                                                                                                             | нет                                                                                      |
| `resolveTarget` | `resolveTarget(ref: unknown, cursor: AomCursor): any` | Единственное место разрешения `FwdRef`/`ThisRef`/`RouteRef`: его зовут обработчики параметров на каждом запросе, `realizeDelay` и проекция курсора | нет (через проекцию) |
| `AomCursorKind` / `AomParameterKind` / `AomValuesSource` / `AomViaKind` | string-enum словари проекции цепочки | Значения — строки (стабильны между версиями); неклассифицируемое — явное `Step`/`Other` | `test/src/lib/manifest/index.ts` |
| `AomParameterDescriptor` / `AomCursorParameter` / `AomRouterJSON` / `AomRouteJSON` / `AomCursorJSON` / `AomParameterJSON` | типы | Дескриптор параметра и форма проекции (`toJSON()`) | `test/src/lib/manifest/index.ts` |

## Внутренние модули

| Файл                                  | Ответственность                                                                        | Ключевые символы                                                                                                    |
| ------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `src/index.ts`                        | Реэкспорт публичной поверхности; импорт `reflect-metadata`                             | —                                                                                                                   |
| `src/classes/router.ts`               | Обход дерева контроллеров по бриджам, сборка `routes`/`sockets`, регистрация в OpenAPI | `Router`, приватный `build`                                                                                         |
| `src/classes/openapi.ts`              | Накопление `paths`/`tags`/`securitySchemes`/`schemas` по курсорам, `toJSON()`          | `OpenApi`, `registerPath`, `storeSecurityScheme`, `schemaExtract`                                                   |
| `src/common/classes.ts`               | Модель пакета: мета-класс, курсор, маршрут, контекст исполнения                        | `AomApi`, `AomCursor`, `AomRoute`, `RxContext`, `TagsRules`, `AomApiElement`, `AomHttpOpenApi`, `AomHttpParameters` |
| `src/common/references.ts`            | Контейнеры отложенных ссылок                                                           | `RefContainer` (приватный), `FwdContainer`, `ThisRefContainer`, `RouteRefContainer`                                 |
| `src/common/lazy.ts`                  | Ленивая обёртка для полей `HttpContextValues`                                          | `LazyValue`, `lazy`, `Lazy<T>`                                                                                      |
| `src/common/openapi.ts`               | Типы деклараций OpenAPI (схема — класс, контейнер ссылки или объект)                   | `OpenApiPossibleSchema`, `OpenApiResponse`, `OpenApiPathParameters`                                                 |
| `src/common/types.ts`                 | Базовые функциональные типы и перечень методов                                         | `HTTPMethods`, `HandlerFunction`, `RefFunction`                                                                     |
| `src/types/index.ts`                  | Контракт входа `AomRoute.apply`                                                        | `HttpContextValues`, `RunFunction`                                                                                  |
| `src/decorators/controllers/index.ts` | `@Controller()`: наследование декораторов предков и `$._.apply()`                      | `Controller`                                                                                                        |
| `src/decorators/endpoints/index.ts`   | Эндпоинты, nextpoint, websocket                                                        | `Endpoint`, `Nextpoint`, `WebSocketPoint`, `defineEndpoint` (приватная)                                             |
| `src/decorators/middlewares/index.ts` | Связи между методами и контроллерами                                                   | `Before`, `After`, `Middleware`, `Bridge`, `Marker`, `UseMarker`, `Next`, `OnInstance`                              |
| `src/decorators/arguments/index.ts`   | Вычисление аргументов метода из контекста запроса                                      | `Args`, `This`, `Run`, `Err`, `Query`, `Body`, …                                                                    |
| `src/decorators/docs/index.ts`        | `summary`/`description` операции                                                       | `Title`, `Description`                                                                                              |
| `src/decorators/openapi/index.ts`     | Декларации операции + `DelayRefStack`                                                  | `Responses`, `RequestBody`, `PathParameters`, `Security`, `DelayRefStack`                                           |
| `src/decorators/openapi/tags.ts`      | Теги и правила их слияния                                                              | `UseTag`, `MergeNextTags`, `IgnoreNextTags`, `ReplaceNextTags`                                                      |
| `src/specials/references.ts`          | Фабрики контейнеров ссылок                                                             | `FwdRef`, `ThisRef`, `RouteRef`                                                                                     |
| `src/constants/errors.ts`             | Строковые коды ошибок определения (`message === код`)                                  | `MIDDLEWARE_DEFINE_ERROR`, `ENDPOINT_DEFINE_ERROR`, …                                                               |
| `test/*.test.ts`                      | Vitest-тесты пакета (5 файлов)                                                         | см. §«Тесты»                                                                                                        |

## Ключевые механизмы

### Фазы декораторов и `@Controller`

Все декораторы — тонкие обёртки над фабриками мета-класса (`AomApi.classDecorator/methodDecorator/combinedDecorator/parameterDecorator`), которые кладут ленивый вызов в очередь нужной фазы. Фаза по умолчанию — `FIRST` (`packages/core/src/defines/callstack.ts` (`AomCallstackQueue.add`, `AomCallstackQueue.transferTo`)): обработчик выполняется сразу при декорировании и сохраняется для наследников. Фаза `LAST` откладывает вызов до `$._.apply()`, который делает `@Controller()`. Сам `@Controller()` — `INSTANT`: он не сохраняется в callstack (иначе рекурсия при переносе), вызывает `$._.inherit()` для ближайшего прототипа и поднимается по цепочке выше только пока очередной предок сам не помечен `@Controller()` (иначе его собственный `inherit` уже перенёс всё, что лежит выше), затем — `$._.apply()` (`packages/router/src/decorators/controllers/index.ts` (`Controller`)).

Отсюда два жёстких правила: `@Controller()` ставится верхним декоратором класса (выполняется последним), и наследник контроллера тоже обязан быть `@Controller()`: перенос декораторов предка делает только сам `@Controller()` (`packages/router/src/decorators/controllers/index.ts` (`Controller`)). Положительный случай — потомок-контроллер получает маршруты родителя — зафиксирован тестом `packages/router/test/router-build.test.ts` («наследник контроллера получает маршруты родителя»); отрицательный случай (потомок без `@Controller()`) тестами не покрыт.

| Декоратор                                                                        | Цель         | Фаза            | Что делает                                                                                    | Где хранится                                               |
| -------------------------------------------------------------------------------- | ------------ | --------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `@Controller()`                                                                  | класс        | INSTANT         | `inherit` ближайшего прототипа (вверх — только через предков без `@Controller()`) + `apply()` | `element.isController`                                     |
| `@Bridge(prefix, Next)`                                                          | класс, метод | FIRST           | Регистрирует бридж; на методе — ставит метод первым pre-middleware дочернего контроллера      | `$._.root.element.bridges`; `next.element.pre_middlewares` |
| `@Endpoint(method, path)`, `@Get/@Post/@Put/@Patch/@Delete/@Options/@All(path?)` | метод        | FIRST           | Помечает метод эндпоинтом и регистрирует его у класса                                         | `element.isEndpoint`; `$._.root.element.endpoints`         |
| `@Get(path, handler)` и аналоги                                                  | класс        | FIRST           | Подключает чужой `@Nextpoint()` как эндпоинт класса                                           | `$.element.endpoints`                                      |
| `@Nextpoint()`                                                                   | метод        | FIRST           | Помечает метод продолжением                                                                   | `element.isNextpoint`                                      |
| `@WebSocketPoint(path)`                                                          | метод        | FIRST           | Эндпоинт с методом `sockets`                                                                  | `element.isWebsocket`; `$._.root.element.websockets`       |
| `@Middleware()`                                                                  | метод        | FIRST           | Помечает метод middleware                                                                     | `element.isMiddleware`                                     |
| `@Before(...)`                                                                   | класс, метод | LAST, `PREPEND` | Фильтрует аргументы по `isMiddleware`, доразрешает через `resolveFor`                         | `element.pre_middlewares`                                  |
| `@After(...)`                                                                    | класс, метод | LAST            | То же, но в пост-список                                                                       | `element.post_middlewares`                                 |
| `@Next(handler)`                                                                 | метод        | LAST            | Требует `isNextpoint` у аргумента                                                             | `element.nextpoint`                                        |
| `@OnInstance()`                                                                  | метод        | FIRST           | Регистрирует хук создания инстанса класса                                                     | `element.isInstance`; `$._.root.element.instanceHooks`     |
| `@Marker()`                                                                      | метод        | FIRST           | Помечает build-time обработчик                                                                | `element.isMarker`                                         |
| `@UseMarker(handler)`                                                            | метод        | LAST            | Требует `isMarker` у аргумента                                                                | `element.markers`                                          |
| `@Title(v)` / `@Description(v)`                                                  | класс, метод | FIRST           | Текст операции; `title` тега берётся отсюда же                                                | `$.title` / `$.description`                                |
| `@UseTag(Class)`                                                                 | класс, метод | FIRST           | Назначает тег                                                                                 | `$.openApi.tag.$`                                          |
| `@IgnoreNextTags/@MergeNextTags/@ReplaceNextTags`                                | класс, метод | FIRST           | Правило слияния                                                                               | `$.openApi.tag.rule`                                       |
| `@Security(schema)`                                                              | класс, метод | FIRST           | Схема безопасности                                                                            | `$.openApi.security`                                       |
| `@RequestBody(schema)`                                                           | метод        | FIRST           | Тело запроса                                                                                  | `$.openApi.requestBody`                                    |
| `@Responses(...)`                                                                | метод        | FIRST           | Ответы                                                                                        | `$.openApi.responses`                                      |
| `@PathParameters(...)`                                                           | метод        | FIRST           | Параметры пути                                                                                | `$.openApi.path`                                           |
| `@QueryParameters/@CookieParameters/@Parameters(...)`                            | метод        | FIRST           | Прочие параметры (с проставленным `in`)                                                       | `$.openApi.parameters`                                     |
| `@DelayRefStack(container)`                                                      | метод        | FIRST           | Кладёт контейнер в стек отложенных декораторов                                                | `$.delayStack`                                             |
| `@Args(handler)` и производные                                                   | параметр     | LAST            | Записывает обработчик по индексу параметра                                                    | `$.element.parameters.handlers[i]`                         |

Evidence: `packages/router/src/decorators/middlewares/index.ts`; `packages/router/src/decorators/endpoints/index.ts`; `packages/router/src/decorators/openapi/index.ts`; `packages/router/src/decorators/openapi/tags.ts`; `packages/router/src/decorators/docs/index.ts`; `packages/router/src/decorators/arguments/index.ts`.

### Сборка маршрутов (`Router.build`)

`new Router(root, docs)` берёт мета-инстанс корневого класса, рекурсивно спускается по бриджам и в конце регистрирует каждый собранный маршрут в документе (`packages/router/src/classes/router.ts` (`Router`)). Приватный `build` на каждом уровне: копирует унаследованные курсоры, дописывает курсоры классовых `@Before`, **этим составом** уходит в бриджи, затем отдельно строит курсоры классовых `@After` и создаёт по маршруту на каждый эндпоинт и на каждый websocket.

`packages/router/src/classes/router.ts` (`Router.build`)

```ts
  private build(root: AomApi, cursors: AomCursor[] = [], prefix: string = "/") {
    // на каждой итерации создается свой массив курсором, чтобы последующие действия не создавал перекрытий
    const preCursors = [...cursors];

    // объединим предварительные миддлвари, которые пойдут в другие бриджи
    preCursors.push(...root.element.pre_middlewares.map(($) => new AomCursor($, root, prefix)));

    root.element.bridges.forEach((bridge) => {
      this.build(bridge.next, preCursors, resolve(join(prefix, bridge.prefix)));
    });

    // создадим пост-миддлвари, которые не проталкиваются в другие бриджи, но используются для методов и сокетов
    const postCursors = root.element.post_middlewares.map(($) => new AomCursor($, root, prefix));

    root.element.endpoints.forEach((endpoint) => {
      const route = new AomRoute(this, prefix, endpoint, [...preCursors, ...postCursors]);
      this.routes.push(route);
    });

    root.element.websockets.forEach((endpoint) => {
      const route = new AomRoute(this, prefix, endpoint, [...preCursors, ...postCursors]);
      this.sockets.push(route);
    });
  }
```

Следствия: классовые `@Before` наследуются вниз по бриджам, классовые `@After` — нет; путь нормализуется через `resolve(join(prefix, endpoint.prefix))` (POSIX, `packages/router/src/common/route.ts` (`AomRoute`)); `sockets` в OpenAPI не регистрируются (`Router` (конструктор) перебирает только `routes`).

Было (дефект, `KI-ROUTER-03`): объекты курсоров классового уровня были **общими** для всех маршрутов контроллера и его бриджей — `AomRoute` мутировал их (`endpoint`, `index`), и `RouteRef` внутри такого курсора после сборки нескольких маршрутов указывал на последний собранный, а не на «свой». Исправлено: `AomRoute` создаёт для каждого маршрута собственные курсоры поверх общих, не трогая исходные (`packages/router/src/common/route.ts` (`AomRoute`), комментарий на месте). Курсор class-level middleware, попавший в `Router.build` без эндпоинта (например, через `@DelayRefStack(RouteRef(...))`), при попытке реализовать `RouteRef` в `realizeDelay` теперь получает управляемую ошибку `ROUTE_REF_DELAY_ERROR`, а не `TypeError` — см. §«Отложенные ссылки».

### Раскладка курсоров и порядок исполнения (`AomRoute.plain`)

Конструктор маршрута пересоздаёт полученные курсоры классового уровня под свой `endpoint` (не мутируя исходные — `KI-ROUTER-03`), добавляет курсор самого эндпоинта последним и раскладывает всё рекурсивно; затем нумерует курсоры и на каждом вызывает объявленные маркеры (`packages/router/src/common/route.ts` (`AomRoute`)).

`packages/router/src/common/route.ts` (`AomRoute.plain`)

```ts
  private plain(cursors: AomCursor[]) {
    cursors.forEach((cursor) => {
      // перепривязка контекста к потомку выполняется в конструкторе AomCursor (resolveFor)

      // сначала загоним в качестве значений собственные миддлвари текущего курсора
      this.plain(
        cursor.$.element.pre_middlewares.map(
          (middleware) => new AomCursor(middleware, cursor.$, cursor.prefix, cursor.endpoint),
        ),
      );

      // затем поместим сам курсор, который может быть как миддлварей так и
      this.cursors.push(cursor);

      this.plain(
        cursor.$.element.post_middlewares.map(
          (middleware) => new AomCursor(middleware, cursor.$, cursor.prefix, cursor.endpoint),
        ),
      );

      // если у текущего курсора есть nextpoint, то рекурсивно обработаем его, включив вероятные миддлвари и nextpoint-ы
      if (cursor.$.element.nextpoint) {
        this.plain([
          new AomCursor(cursor.$.element.nextpoint, cursor.$, cursor.prefix, cursor.endpoint),
        ]);
      }
    });
  }
```

Итоговый порядок курсоров одного маршрута — фиксированный:

```
классовые @Before → классовые @After → методные @Before → эндпоинт → методные @After → цепочка @Next
```

Классовый `@After` стоит **до** эндпоинта: он попадает в `postCursors`, а те приписываются к входному списку `AomRoute` рядом с `preCursors`, тогда как эндпоинт добавляется последним (`Router.build`, `AomRoute` (конструктор) в `packages/router/src/common/route.ts`). Это особенность (`KI-ROUTER-02`, открытый вопрос закрыт): поведение — прямое следствие сборки `Router.build`, автор оставил его как есть. Порядок подтверждён пробой и тестом наследования: при `@Before`/`@After` на базовом и дочернем контроллерах цепочка выходит `parent-before → child-before → child-after → parent-after → endpoint` (`packages/router/test/router-exec.test.ts` («наследование: Before родителя выполняется ДО Before потомка (InheritPlacement.PREPEND)»)). При наследовании родительские `@Before` встают перед собственными (`InheritPlacement.PREPEND`, `packages/router/src/decorators/middlewares/index.ts` (`Before`)), а `@After` — после собственных (`APPEND` по умолчанию).

На этот порядок ссылается `test/docs/request-lifecycle.md`.

### Исполнение запроса (`RxContext.run`)

`AomRoute.apply(values)` создаёт новый `RxContext` (значения запроса, пустая `state` и пустая карта `pending` идущих/отказавших созданий — см. следующий раздел) и прогоняет список курсоров (`packages/router/src/common/route.ts` (`AomRoute.apply`)).

`packages/router/src/common/context.ts` (`RxContext.run`)

```ts
          concatMap(async (cursor: AomCursor) => {
            try {
              const { $ } = cursor;
              // на уровне каждого курсора проверим, что для него есть существуюший инстанс в state
              // и создадим его, если его нет (работает в том числе с учетом декорированных constructor)
              const { target } = $._;
              if (!this.state.get(target)) {
                // создадим инстанс с учетом вероятных хуков
                await AomApi.instanceWithHooks(target, { context: this, cursor, route });
              }
              const args = await Promise.all(
                $.element.parameters.apply({ context: this, cursor, route }),
              );

              const result = await Reflect.apply(
                $.element.descriptor?.value || new Function(),
                target,
                args,
              );

              // Если результат - ошибка, выбрасываем её
              if (result instanceof Error) {
                throw result;
              }

              return result;
            } catch (error) {
              throw error;
            }
          }),
```

Курсоры идут строго последовательно (`concatMap`). `takeWhile((result) => result === undefined, true)` обрывает цепочку на первом не-`undefined` результате, и подписчик резолвит его как ответ; если все курсоры вернули `undefined`, промис резолвится в `undefined`; брошенная или **возвращённая** ошибка отправляется в `reject` (`RxContext.run` в `packages/router/src/common/context.ts`). `this` внутри метода — сам класс (`Reflect.apply(..., target, args)`), потому что все обработчики статические. Обработчики аргументов вызываются с тем же `this` (`packages/router/src/common/api.ts` (`AomHttpParameters.apply`)).

Evidence: `packages/router/test/router-exec.test.ts` («миддлварь, вернувшая значение, перехватывает ответ — эндпоинт не вызывается», «возврат экземпляра Error приводит к reject», «выброшенное исключение приводит к reject»).

### Инстансы, `state` и `@OnInstance` (`AomApi.instanceWithHooks`)

`state` — `ClassInstanceMap` (карта «конструктор → экземпляр»), новая на каждый `apply()`, поэтому один готовый инстанс класса на класс на запрос — но в неё попадает только объект, прошедший **все свои** хуки `@OnInstance`. Публикация двухстадийная: пока хуки идут, объект лежит в `RxContext.inflight` (`Map<ClassConstructor, any>`) и виден только ветке исполнения, которая его создаёт; после успешного окончания хуков он переносится в `state`, и только тогда его видят чужие `@This`, `@State(X)` и `@State()` без аргумента (поля `RxContext` и `AomApi.instanceWithHooks` — `packages/router/src/common/context.ts` (`RxContext.state`, `RxContext.pending`, `RxContext.inflight`, `RxContext.waits`), `packages/router/src/common/api.ts` (`AomApi.instanceWithHooks`)). Правило чтения инстанса целиком живёт в одном месте — `instanceWithHooks`; `RxContext.run` зовёт его для класса-владельца каждого курсора безусловно, даже если `@This()` нигде не запрошен (`RxContext.run`), и `@This` не читает `state` отдельно (`packages/router/src/decorators/arguments/index.ts` (`This`)).

Было (дефект, `KI-ROUTER-01`, `KI-ROUTER-16`, `KI-ROUTER-17`): аргументы метода разрешаются конкурентно через `Promise.all`, а создание инстанса было асинхронным check-then-create по `state` без дедупликации — два `@This(X)` одного класса в одном методе создавали два инстанса и дважды прогоняли `@OnInstance`. Фикс `KI-ROUTER-01` (2026-09-14) убрал дублирование, но публиковал инстанс в `state` сразу после конструктора, ещё до хуков — окно, в котором чужой код (параллельный путь, `@This` из хука другого класса) получал непроверенный объект, если хук потом отказывал: реальный сценарий — обход авторизации. Исправлено:

`packages/router/src/common/api.ts` (`AomApi.instanceWithHooks`)

```ts
  static instanceWithHooks(target: ClassConstructor, args: ArgumentsHandlerParameters) {
    const { context, cursor } = args;

    // проверенный инстанс: в state попадает только то, что прошло все свои хуки
    const ready = context.state.get(target);
    if (ready) return ready;

    if (cursor.creating.includes(target)) {
      // создание target держит эта же ветка исполнения. Собственный код класса (его хук
      // через @This(), его же middleware через next()) получает непроверенный инстанс сразу:
      // ждать ему нечего, он сам и есть то создание, которого пришлось бы ждать
      if (cursor.$._.target === target) {
        const instance = context.inflight.get(target);
        // инстанса ещё нет — мы внутри собственного конструктора класса: настоящий цикл
        if (!instance) throw circularInstanceError([...cursor.creating, target]);
        return instance;
      }
      // чужой код внутри создания target: дождаться нельзя (создание target ждёт окончания
      // этой самой ветки), а непроверенный инстанс наружу не отдаём — это и есть цикл
      throw circularInstanceError([...cursor.creating, target]);
    }

    // создание этого класса уже идёт или отказало в этом запросе — вернём его, а не создадим
    // второй инстанс (аргументы метода решаются конкурентно, Promise.all); run и @This дождутся
    // проверенного или получат ту же ошибку
    const pending = context.pending.get(target);
    if (pending) return context.waitCreation(target, pending, cursor.creating.at(-1));

    const $target = AomApi.instance(target);
    // цепочка владения: эта ветка создаёт target, а с ним и всё, что он потянет за собой
    const creating = [...cursor.creating, target];
    const creation = (async () => {
      // первый await — до разбора аргументов конструктора: он даёт context.pending (ниже)
      // зафиксироваться раньше, чем @This из конструктора вернётся сюда же. Без него взаимные
      // ссылки конструкторов уходят в синхронную рекурсию и рвут стек вместо понятной ошибки
      await Promise.resolve();

      // аргументы конструктора разбираем от курсора этой же ветки: клон через прототип несёт
      // цепочку владения, но не перезапускает delayStack и сохраняет $, index и эндпоинт
      const ownCursor: AomCursor = Object.assign(Object.create(cursor), { creating });
      const instanceArgs = await Promise.all(
        $target.element.parameters.apply({ ...args, cursor: ownCursor }),
      );
      const instance = Reflect.construct(target, instanceArgs);

      // инстанс создан, но не проверен: до конца хуков он виден только собственной ветке
      // через inflight, в общую карту запроса (state) не попадает
      context.inflight.set(target, instance);

      // используем механику, аналогичную процедуре run, только в качестве источника
      // курсоров используем список instanceHooks
      const { prefix, endpoint } = cursor;

      // асинхронно запустим все хуки (порядок должен быть не важен)
      await Promise.all(
        $target.element.instanceHooks.map(($) => {
          const nextCursor = new AomCursor($, cursor.$, prefix, endpoint);
          nextCursor.creating = creating;
          return context.run([nextCursor]);
        }),
      );

      // хуки пройдены — только теперь инстанс становится общим: его видят @State, @This
      // и курсоры чужих веток. Если хук отказал, в state не попадает ничего
      context.state.set(target, instance);
      return instance;
    })().finally(() => context.inflight.delete(target));

    // до первого await зафиксируем идущее создание. При успехе запись снимем — инстанс уже в state.
    // При отказе (конструктор или хук) отклонённое создание остаётся до конца запроса: следующие
    // обращения к классу получают ту же ошибку и не создают его заново — иначе соседний хук,
    // обратившийся к классу после отказа, запускал бы создание и проверку по кругу
    context.pending.set(target, creation);
    creation.then(
      () => context.pending.delete(target),
      // ошибку получают все, кто ждёт creation; здесь только не даём ей стать необработанной
      () => undefined,
    );
    return creation;
  }
```

Реентрантность решают два условия сразу: класс есть в цепочке владения этой ветки (`AomCursor.creating` — список классов, создание которых держит текущая ветка исполнения; живёт на курсоре, а не в контексте, потому что веток одновременно несколько — `Promise.all` по хукам и по аргументам, `packages/router/src/common/cursor.ts` (`AomCursor.creating`)) **и** выполняемый код принадлежит этому же классу (`cursor.$._.target === target`). Тогда собственный хук класса или его же middleware, поднятая через `@Run()`-`next()`, получает непроверенный инстанс из `inflight` сразу, без ожидания — ждать нечего, эта ветка и есть то создание, которого пришлось бы ждать. Если класс в цепочке владения, а код чужой — это цикл: непроверенный инстанс наружу не отдаётся, вместо него `CIRCULAR_INSTANCE_ERROR` (новая константа `packages/router/src/constants/errors.ts` (`CIRCULAR_INSTANCE_ERROR`)) с перечнем имён классов цепочки, через `->`.

Чужая ветка, наткнувшаяся на создание, которое держит не она (класса нет в её `creating`), не плодит второй инстанс и не виснет: `pending`-промис на класс уже есть, и она встаёт в очередь через `RxContext.waitCreation` — получит либо проверенный инстанс, либо ту же ошибку хука.

`packages/router/src/common/context.ts` (`RxContext.waitCreation`)

```ts
  // ожидание чужого создания: прежде чем встать в очередь, проверим, не ждёт ли target (прямо
  // или по цепочке) создание самого ожидающего — иначе обе ветки встанут навсегда
  waitCreation(target: ClassConstructor, creation: Promise<any>, waiter?: ClassConstructor): any {
    // ветка ничего не создаёт — замкнуть цикл нечем, ребро не нужно
    if (!waiter) return creation;

    const cycle = this.findWaitPath(target, waiter);
    if (cycle) throw circularInstanceError([waiter, ...cycle]);

    const targets = this.waits.get(waiter) ?? new Set<ClassConstructor>();
    targets.add(target);
    this.waits.set(waiter, targets);

    const release = () => {
      const current = this.waits.get(waiter);
      if (!current) return;
      // снимаем только своё ребро: ветка может ждать и других
      current.delete(target);
      if (!current.size) this.waits.delete(waiter);
    };
    // ошибку создания получает тот, кто ждёт creation; здесь только снимаем ребро в обе
    // стороны и не даём отказу стать необработанным
    creation.then(release, release);

    return creation;
  }
```

Граф `waits` (`Map<ClassConstructor, Set<ClassConstructor>>` — «кто кого ждёт», ребро живёт, пока ветка ждёт чужое создание) превращает встречное ожидание двух веток в тот же `CIRCULAR_INSTANCE_ERROR`, а не в зависший запрос.

Ветка может ждать нескольких созданий сразу — и аргументы конструктора, и хуки экземпляра исполняются параллельно, — поэтому хранятся все рёбра, а не последнее, и проверка на цикл идёт обходом графа (`RxContext.findWaitPath`, поиск в глубину с пометками посещённых узлов), а не проходом по цепочке. Пока ребро на ветку было одно, второе ожидание затирало первое, и цикл, замыкавшийся через забытое ребро, вешал запрос вместо ошибки (`KI-ROUTER-19`, закрыт 2026-09-21; тест — `packages/router/test/router-instance-safety.test.ts` («цикл распознаётся, даже когда ждущая ветка ждёт ещё одно создание (KI-ROUTER-19)»)).

**Отказ конструктора или хука по-прежнему помнится до конца запроса** (`KI-ROUTER-14`): `pending` не снимается при ошибке, следующие обращения к тому же классу в рамках запроса получают ту же ошибку без повторного создания. Паттерн «попробовать → войти → повторить» в одном запросе не работает — второй `next(Auth.Required)` после перехваченной ошибки первого получает ту же ошибку, не запуская проверку заново. Тесты: `packages/router/test/router-exec.test.ts` («перехваченная ошибка хука-проверки не пускает следующий курсор того же класса без авторизации», «отказ хука-проверки запоминается до конца запроса: соседний хук не пересоздаёт класс в фоне», «повторное обращение к классу после отказа в том же запросе получает ту же ошибку»).

`@This(...)` (`packages/router/src/decorators/arguments/index.ts` (`This`)) разрешает цель в порядке: `FwdContainer` → `exec()`; `RouteRefContainer` → `exec(cursor.endpoint.$._.target)`; `ThisRefContainer` → `exec(cursor.$._.target)` — у унаследованного метода это потомок, на котором он исполняется, так что базовый класс может взять класс из статики потомка (тест `packages/router/test/inherited-static-refs.test.ts` («@This(ThisRef(...)) берёт класс шага — потомка, на котором исполняется унаследованный метод»)); класс — как есть; без аргумента — класс текущего курсора. Затем всегда — `AomApi.instanceWithHooks(target, args)`, без отдельного чтения `state`.

Публичные следствия, проверенные тестами `packages/router/test/router-instance-safety.test.ts`:

1. Пока хуки класса не прошли, его инстанс не виден из чужих веток ни через `@This(X)`, ни через `@State(X)`, ни через `@State()` без аргумента — чужое обращение ждёт.
2. **Ломающее изменение**: `@This(СоздаваемыйКласс)` в middleware или хуке ЧУЖОГО класса, поднятого через `@Run()`-`next()` из хука создаваемого класса, теперь даёт `CIRCULAR_INSTANCE_ERROR` (раньше отдавался непроверенный объект). Приём «хук зовёт через `next()` класс-помощник, а тот сам берёт `@This` на вызывающий класс» больше не работает — объект нужно передавать помощнику аргументом, обычным вызовом функции в обход `next()` (`next()` строит курсор из `AomApi.instance(handler)` и выполняет именно декорированный метод-цель, а не произвольное замыкание, поэтому передать инстанс через него нельзя — только через параметр):

   ```ts
   // было: Reporter.report брал Auth сам, через @This, из курсора, поднятого next()
   @Controller()
   class Auth {
     @OnInstance()
     static async audit(@Run() next: RunFunction) {
       await next(Reporter.report); // Reporter.report(@This(Auth) auth) → CIRCULAR_INSTANCE_ERROR
     }
   }
   @Controller()
   class Reporter {
     @Middleware()
     static async report(@This(Auth) auth: Auth) {
       /* ... */
     }
   }

   // стало: Reporter — обычный класс, self передаётся аргументом обычным вызовом, без next()
   @Controller()
   class Auth {
     @OnInstance()
     static async audit(@This() self: Auth) {
       await Reporter.notify(self);
     }
   }
   class Reporter {
     static async notify(auth: Auth) {
       /* ... */
     }
   }
   ```

3. Взаимные хуки двух классов (`A` ждёт `B` через `@This`, `B` ждёт `A`) → `CIRCULAR_INSTANCE_ERROR` с именами классов (раньше — молча непроверенный объект).
4. Цикл «конструктор ↔ хук» → та же ошибка (раньше запрос висел без ответа).
5. Взаимный `@This` в конструкторах двух классов → та же ошибка (раньше — `RangeError: Maximum call stack size exceeded`).
6. `@This(СвоегоКласса)` внутри собственного конструктора класса (инстанса ещё нет) → та же ошибка (раньше — зависание).
7. Не изменилось, сознательно: `@This()` и `@This(СвойКласс)` **внутри собственного хука класса или его же middleware, поднятой через `@Run()`-`next()` из хука** отдают инстанс сразу, до окончания всех проверок этого класса (реентрантность из правила выше — свой код своего же создающегося класса). Свой хук видит ещё не проверенный объект и сам отвечает за то, чтобы не отдать его наружу — не положить в `ctx`, не сохранить в модульную переменную, не передать в чужой `next()`. Кодом фреймворка это не проверяется и не может: граница ответственности — на границе класса.

> Прежний открытый вопрос `KI-ROUTER-16` (инстанс виден в `state` до завершения хуков — риск утечки чужому коду) закрыт двухстадийной публикацией выше. `KI-ROUTER-17` закрыт частично: чужой код (другой класс, параллельная ветка) больше не видит инстанс раньше времени и не может произвести видимый эффект через него до отказа проверки — конкретный риск обхода авторизации снят; но сам дизайн-вопрос («отменять ли хуки `@OnInstance` **одного и того же** класса друг другу при отказе одного из них, `Promise.all` без отмены») остаётся открытым, см. §«Известные дефекты» ниже. `test/docs/known-issues.md` эту правку пока не отражает — сверяться с кодом и `router-instance-safety.test.ts`, а не с реестром.

### Ленивые значения контекста (`lazy`, `LazyValue`, `RxContext.value`)

`HttpContextValues` (`src/types/index.ts` (`HttpContextValues`)) принимает в полях `query`, `params`, `cookies`, `headers`, `session` либо готовое значение (как раньше), либо `lazy(() => value)` — обёртку `Lazy<T> = T | LazyValue<T>` из `packages/router/src/common/lazy.ts`. Поля `body` и `files` были и остались типа `any`, но по тому же контракту тоже принимают `lazy(...)`. Декораторы `@Body`, `@Query`, `@Params`, `@Cookies`, `@Headers`, `@Session`, `@Files` берут значение не напрямую из `context.values`, а через `context.value(key)`.

`packages/router/src/common/context.ts` (`RxContext.value`)

```ts
  // разрешение ленивого поля контекста: готовое значение возвращается как есть (сегодняшнее
  // поведение не меняется), ленивое — запускает фабрику не раньше первого обращения и только
  // один раз на запрос
  value<K extends keyof HttpContextValues>(key: K): any {
    const source: any = this.values[key];
    if (!(source instanceof LazyValue)) return source;

    const cached = this.resolved.get(key);
    if (cached) return cached;

    const promise = Promise.resolve().then(() => source.factory());
    this.resolved.set(key, promise);
    promise.catch(() => undefined);
    return promise;
  }
```

Фабрика вызывается не раньше первого обращения к полю и максимум один раз за запрос: результат (или отказ) кладётся в приватную карту `RxContext.resolved` синхронно, до первого `await`, поэтому параллельные обращения (два `@Body` в одном методе, `@Body` в middleware и в эндпоинте) получают один и тот же промис, а не запускают фабрику дважды. Синхронный `throw` внутри фабрики и её собственный отказ приходят к вызывающему коду одним и тем же путём — `reject` промиса `value()`.

Зачем это нужно: значение, которое дорого получить — прежде всего тело запроса, — теперь не вычисляется, если маршрут до него не дошёл, например когда проверка доступа отказала раньше. Адаптер чужого HTTP-фреймворка кладёт в соответствующее поле `HttpContextValues` либо готовое значение (фреймворк уже всё разобрал), либо `lazy(() => ...)` (поток сырой, разбор дорогой) — отдельного интерфейса адаптера не требуется, контракт целиком описывается `HttpContextValues` и `LazyValue`.

> Оговорка про порядок: выигрыш «неавторизованный запрос не заставляет читать тело» держится только пока проверки доступа идут раньше `@Body` в списке курсоров маршрута и сами не читают `@Body`. Курсоры идут строго последовательно (`concatMap`, см. §«Исполнение запроса» выше), поэтому если билдер тела поставить в `@Before` раньше авторизации, тело снова будет читаться первым — раньше, чем выяснится, что читать его не нужно было.

Тесты: `packages/router/test/lazy-values.test.ts` — одна фабрика на все обращения `@Body` в запросе (два параметра метода и отдельный курсор `@Before`); фабрика не вызывается, если её поле никто не запросил; отказ (асинхронный `reject` и синхронный `throw`) отдаётся всем обращениям и не перезапускает фабрику; готовое (не ленивое) значение ведёт себя как обычное поле контекста.

### Декораторы аргументов (`Args`)

`Args(handler, descriptor?)` кладёт обработчик по индексу параметра в фазе LAST (`$.element.parameters.handlers[i]`), а рядом — дескриптор того, что параметр внедряет (`$.element.parameters.descriptors[i]`: `kind`, для `Values` — `source`, цель `ref`). Обработчик получает `{context, cursor, route}` и может быть асинхронным — все обработчики метода разрешаются через `Promise.all`. Каждый встроенный декоратор передаёт свой дескриптор; пользовательский `Args(handler)` без дескриптора получает `{kind: "other"}`. Цели-рефы (`FwdRef`/`ThisRef`/`RouteRef`) обработчики разрешают через `resolveTarget` на каждом вызове — той же функцией, что и проекция курсора.

| Декоратор                                            | Что получает                                                                                                                                                                   | Формы аргумента                                                                                                                                                                                                     |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@Args(h)`                                           | результат `h({context, cursor, route})`                                                                                                                                        | функция; по умолчанию — тождественная (возвращает весь объект)                                                                                                                                                      |
| `@Query`, `@Body`, `@Params`, `@Cookies`, `@Headers` | `values.query/body/params/cookies/headers`, через `context.value(key)` — если поле было `lazy(...)`, фабрика вызывается здесь, не раньше                                       | строка — значение по ключу; функция — вызывается со всем объектом; `ThisRef` — вызывается с классом курсора, результат применяется как функция; `RouteRef` — то же с классом эндпоинта; без аргумента — весь объект |
| `@Session(name?)`, `@Files(name?)`                   | `values.session` / `values.files`, тоже через `context.value(key)`                                                                                                             | строковый ключ либо ничего                                                                                                                                                                                          |
| `@Ctx()`, `@Req()`, `@Res()`                         | `values.ctx` / `values.req` / `values.res`                                                                                                                                     | нет                                                                                                                                                                                                                 |
| `@Cursor()`, `@Route()`                              | текущий `AomCursor` / `AomRoute`                                                                                                                                               | нет                                                                                                                                                                                                                 |
| `@State(ctor?)`                                      | инстанс из `state` (только прошедший свои хуки) либо весь `state`                                                                                                              | конструктор                                                                                                                                                                                                         |
| `@This(ctor?)`                                       | инстанс класса; создаётся при отсутствии; пока идут хуки класса — виден без ожидания только его собственному коду, чужой ждёт или получает `CIRCULAR_INSTANCE_ERROR` при цикле | класс, `FwdRef`, `ThisRef`, `RouteRef`, пусто                                                                                                                                                                       |
| `@Run()`                                             | функция `(...handlers) => Promise<any>`, строящая новые курсоры с тем же эндпоинтом и цепочкой владения (`creating`) и прогоняющая их в текущем контексте                      | нет                                                                                                                                                                                                                 |
| `@Err(Ctor = Error)`                                 | фабрика `(message, status?, data?) => Error` со `status` из аргумента, инстанса или статики класса                                                                             | класс-наследник `Error`                                                                                                                                                                                             |

Evidence: `packages/router/src/decorators/arguments/index.ts` (`Query`, `Body`, `Params`, `Cookies`, `Session`, `Files`, `Headers` — значения контекста), (`Run`, `Ctx`, `Err`), (`Cursor`, `Route`, `State`, `This`).

### Отложенные ссылки и `DelayRefStack`

Контейнеры `FwdContainer`/`ThisRefContainer`/`RouteRefContainer` хранят функцию и различаются аргументом её вызова: `FwdRef` — без аргумента (обход циклических импортов), `ThisRef` — класс текущего курсора, `RouteRef` — класс эндпоинта маршрута (`packages/router/src/common/references.ts` (`RefContainer`, `FwdContainer`, `ThisRefContainer`, `RouteRefContainer`), фабрики — `packages/router/src/specials/references.ts` (`FwdRef`, `ThisRef`, `RouteRef`)).

`@DelayRefStack(container)` откладывает целые декораторы: функция контейнера должна вернуть массив декораторов, которые применяются к методу в момент создания курсора — то есть уже в контексте конкретного потомка. Это то, на чём стоят билдеры `@aom-js/api` (базовый класс объявляет middleware, потомок задаёт статическое значение — схему или имя параметра).

`packages/router/src/common/cursor.ts` (`AomCursor.realizeDelay`)

```ts
    // отложенный стек реализуется на инстансе однократно; при ошибке признак не взводится
    // и стек не расходуется — проблема привязки воспроизводится на каждой сборке, а не гаснет тихо
    if (!$.delayRealized && $.delayStack.length) {
      for (const handler of $.delayStack) {
        // дескриптор передаётся явно (KI-COMMON-17)
        const descriptor = Reflect.getOwnPropertyDescriptor(target, property!);
        // RouteRef зависит от эндпоинта, а стек реализуется один раз на мета-инстанс:
        // держать его может только стек самого эндпоинта
        if (handler instanceof RouteRefContainer && $ !== this.endpoint?.$) {
          throw new Error(constants.ROUTE_REF_DELAY_ERROR);
        }
        Reflect.decorate([...resolveTarget(handler, this)], target, property!, descriptor);
      }
      $.delayRealized = true;
      $._.apply();
    }
```

Ветки `FwdRef`/`ThisRef`/`RouteRef` — в одной функции `resolveTarget` (раздел «Метаданные цепочки»). Аргумент `@DelayRefStack` — только контейнер: голую функцию (`@DelayRefStack(() => [...])`) раньше молча пропускали, теперь сборка курсора падает (`resolveTarget` возвращает её как есть, и разворот `[...fn]` бросает `TypeError`). Правило `RouteRef` в `@DelayRefStack`: допустим только на эндпоинт-методе. Стек реализуется один раз на мета-инстанс, в контексте первого курсора, поэтому на шаге, общем для нескольких маршрутов, реализация от первого маршрута тихо распространилась бы на остальные; на любом другом шаге сборка `Router` бросает `ROUTE_REF_DELAY_ERROR`. Было (`KI-ROUTER-03`): курсор без эндпоинта (class-level middleware из `Router.build`) давал `TypeError`. Тесты: `packages/router/test/router-build.test.ts` («DelayRefStack(RouteRef) на class-level middleware — ошибка ROUTE_REF_DELAY_ERROR»), `packages/router/test/parameter-descriptors.test.ts` («RouteRef в DelayRefStack»). В аргументах (`@This(RouteRef(...))`, `@Query(RouteRef(...))`) `RouteRef` разрешается на каждом вызове и на общем шаге даёт класс эндпоинта своего маршрута.

Перед реализацией стека конструктор курсора перепривязывает мета-инстанс: `this.$ = AomApi.resolveFor($, origin._.target)` (`packages/router/src/common/cursor.ts` (`AomCursor`)). Это нужно, когда ссылка `Self.Method` зафиксировала статику родителя до того, как отработал `@Controller()` потомка: `resolveFor` возвращает инстанс каррированной копии потомка, если она есть (`packages/core/src/defines/core.ts` (`AomCore.resolveFor`)). Ту же перепривязку делают `@Before`, `@After`, `@UseMarker` и `@Next` в контексте класса-декларатора; `@Before/@After/@UseMarker/@Next` дополнительно принимают `FwdContainer` и разворачивают его перед разрешением (`packages/router/src/decorators/middlewares/index.ts` (`Before`, `After`, `UseMarker`, `Next`)). В генераторе документа `ThisRef`/`RouteRef` в схемах исполняются с теми же контекстами (`packages/router/src/classes/openapi.ts` (`OpenApi.schemaExtract`)).

### Маркеры

`@Marker()` помечает статический метод сигнатуры `(route: AomRoute, cursor: AomCursor) => void`; `@UseMarker(marker)` привязывает его к методу. При создании маршрута для каждого курсора вызываются все маркеры его мета-инстанса, с `this` = класс маркера (`packages/router/src/common/route.ts` (`AomRoute`)). Это **build-time** механизм: на запросе маркеры не выполняются, результат живёт в `route.markers` (`Record<string, any>`).

`packages/api/src/controllers/access/access-controller.ts` (`BaseAccessController.setAccessMark`)

```ts
  // установить типичный доступ с учетом требований к конкретным типам партнерств
  @Marker()
  static setAccessMark(route: AomRoute, cursor: AomCursor): void {
```

Маркер срабатывает столько раз, сколько курсоров с ним в маршруте, и читает `cursor.origin._` — место сцепки, а не место объявления. На этом построена карта доступа: `@aom-js/api` собирает `route.markers[markerName]`, а приложение фильтрует по нему список маршрутов. Механика маркера доступа — `main/packages/api/readme.md`.

### Сборка OpenAPI (`OpenApi.registerPath`)

`Router` вызывает `docs.registerPath(route)` для каждого маршрута. Метод формирует одну операцию: `operationId = ${Класс}_${метод}` эндпоинта, `summary`/`description` — из `@Title`/`@Description` эндпоинта (`packages/router/src/classes/openapi.ts` (`OpenApi.registerPath`)), затем проходит **по всем курсорам по порядку** и накапливает:

- **теги** (`OpenApi.registerPath`): правило обновляется только на курсоре, где есть `@UseTag`; `REPLACE` (по умолчанию) заменяет последний тег, `MERGE` добавляет, `IGNORE` пропускает; имя тега — `$.title` класса-тега либо имя класса; итог — одна строка, склеенная `OpenApi.tagsSeparator` (`" > "`). Проба: `@UseTag` на middleware + `@UseTag` + `@MergeNextTags` на эндпоинте дают тег `"Раздел > TagB"`, без `@MergeNextTags` — `"TagB"`;
- **параметры пути** (`OpenApi.registerPath`): ключ структуры `@PathParameters` — литеральный сегмент пути, он заменяется на `{name}`, параметр добавляется как `in: "path", required: true`;
- **прочие параметры**, **ответы** (статус — ключ, поэтому последний курсор с тем же статусом выигрывает; `isArray` оборачивает схему в `{type: "array", items}`), **security**, **requestBody** (последний выигрывает; всё — там же, `OpenApi.registerPath`).

Схемы проходят через `schemaExtract`: `ThisRef`/`RouteRef` исполняются, результат отдаётся `SchemasCollector.extract` из `@aom-js/schemer`, который превращает компонент-класс в `{$ref}` и складывает рендер в `components` (`packages/router/src/classes/openapi.ts` (`OpenApi.schemaExtract`); подробности сборщика — `main/packages/schemer/readme.md`).

`toJSON()` сливает `initData` с накопленным: `components.securitySchemes`/`components.schemas` дополняются (ключ security — имя класса курсора, `packages/router/src/classes/openapi.ts` (`OpenApi.storeSecurityScheme`), особенность — `KI-ROUTER-07`), теги из `initData` того же имени сохраняют своё описание, новые добавляются в конец, пути объединяются по сегменту, а на совпавшем методе побеждает сгенерированный (`packages/router/src/classes/openapi.ts` (`OpenApi.toJSON`)). Было (дефект, `KI-ROUTER-07`): `toJSON` целиком затирал `components`/`tags`/`paths` из `initData` — исправлено 2026-09-14; тест `packages/router/test/openapi.test.ts` («components, tags и paths из initData сливаются со сгенерированными; совпадающее поле — сгенерированное»).

### Метаданные цепочки (`toJSON`, `routeOf`, `@CursorKind`)

После сборки цепочка маршрута нигде не записана: порядок шагов, причину, по которой шаг стоит в цепочке, и класс, на котором он исполняется (`resolveFor`, `ThisRef`, `DelayRefStack`), приходилось выводить в уме. Проекция делает цепочку читаемым артефактом. Источник истины — код: проекция пересчитывается по требованию, ничего не исполняет и в рантайме не хранится. Спека — `test/specs/2026-10-11-cursor-metadata-design.md`.

**Словари** — string-enum, значения — строки (сериализация стабильна между версиями), неклассифицируемое — явное значение, а не пропуск (`packages/router/src/common/kinds.ts`):

- `AomCursorKind` — вид шага: `handler`, `checkpoint`, `transport`, `filter`, `value`, `collector`, `pager`, `response`, `input`, `meta`, `step` (умолчание);
- `AomParameterKind` — что внедряет параметр: `this`, `state`, `run`, `values`, `cursor`, `route`, `ctx`, `req`, `res`, `err`, `other` (пользовательский `Args`);
- `AomValuesSource` — поле запроса для `values`: `query`, `body`, `params`, `headers`, `cookies`, `session`, `files`;
- `AomViaKind` — почему курсор в цепочке (таблица ниже).

**`@CursorKind(kind)`** ставится на **определении** шага и только там, где вид нельзя вывести из того, чем код является; синтаксис прикреплений (`@Before(...)`, `@Next(...)`) не меняется. Ядро хранит только объявленный вид (`$.element.cursorKind`); выводимые виды (`handler`, `checkpoint`, `transport`, `input`, `meta`) добавляет приложение — `test/src/lib/manifest/index.ts` (`kindOf`). Значение вне словаря и повторная разметка — `CURSOR_KIND_DEFINE_ERROR` при декорировании: `bun test` типы не проверяет, и опечатка не должна тихо стать `step`. Тест — `packages/router/test/cursor-kinds.test.ts`.

**Цели параметров.** `Args` пишет дескриптор рядом с обработчиком (раздел «Декораторы аргументов»). `resolveTarget(ref, cursor)` — единственное место, где разворачиваются рефы: `FwdRef` → результат функции, `ThisRef` → функция от класса курсора (после `resolveFor`), `RouteRef` → функция от класса эндпоинта (без эндпоинта — `ROUTE_REF_DELAY_ERROR`), остальное — как есть. Её вызывают обработчики параметров на каждом запросе, `AomCursor.realizeDelay` и `AomCursor.parameters()`, поэтому проекция совпадает с исполнением по построению. `cursor.parameters()` — вычисляемый список `{kind, source?, target?, name?}` по порядку сигнатуры; для `@This()` без аргумента цель — класс самого курсора. Тест — `packages/router/test/parameter-descriptors.test.ts` («цель из cursor.parameters() — тот же класс, что замыкание внедрило при исполнении»).

**`via` и `viaGroup`** задаются там, где цепочка раскладывается, и переносятся при пересоздании курсоров в `AomRoute`:

| `via`          | Откуда                                                                    |
| -------------- | ------------------------------------------------------------------------- |
| `class-before` | `Router.build`: классовый `@Before`, в том числе пришедший через `@Bridge` |
| `class-after`  | `Router.build`: классовый `@After` — встаёт **до** эндпоинта              |
| `before`       | `AomRoute.plain`: методный `@Before` эндпоинта или шага                   |
| `endpoint`     | конструктор `AomRoute`: сам обработчик                                    |
| `after`        | `AomRoute.plain`: методный `@After`                                       |
| `next`         | `AomRoute.plain`: раскрытие `@Next`; `viaGroup` — `AomApi.toString` шага, чей `@Next` раскрыт |

Курсоры, созданные на запросе (`@Run()`-`next()`, хуки `@OnInstance`), `via` не имеют: содержимое подцепочек `@Run` проекцией не покрывается.

**`Router.routeOf(endpoint)`** — маршрут по ссылке на эндпоинт-метод, а не по паре method+path. Поиск идёт через `AomApi.checkExists` и ничего не регистрирует. Нет маршрута — `ROUTE_OF_NOT_FOUND_ERROR`; больше одного (ядро допускает: `@Get @Post` на одном методе, контроллер под двумя `@Bridge`) — `ROUTE_OF_AMBIGUOUS_ERROR` со всеми `method path` в сообщении. Для унаследованного обработчика ссылку брать через класс из дерева роутера (`PermissionTickets.Create`, не `TicketsBase.Create`).

**`toJSON()`** у `Router`, `AomRoute`, `AomCursor` — один сериализатор для дампа и для сравнений: `JSON.stringify(router)` — дамп, `router.routeOf(X).toJSON()` — проекция маршрута.

- `Router` → `{version: 1, routes}`, маршруты отсортированы по `method path`;
- `AomRoute` → `{method, path, markers, steps}`; `markers` — по каждому маркеру `{accessPoints: string[]}`, только `ident` точек доступа без содержимого;
- `AomCursor` → `{i, step, origin, via, viaGroup?, kind?, parameters, creates, hooks}`: `step`/`origin` — `AomApi.toString` шага и точки прикрепления, `kind` — только объявленный `@CursorKind`; `parameters` — `{kind: "this", subject}`, `{kind: "state", subject?}`, `{kind: "values", source, fields?}`, `{kind: "other", name?}` или просто `{kind}`; `fields` — имена из `$.openApi` шага после `realizeDelay` (параметры по `in`, параметры пути, свойства верхнего уровня схемы тела), иначе строковый ключ декоратора; `creates` — классы, чей инстанс этот шаг создаёт первым в маршруте (свой класс, затем цели `@This`; за каждым — рекурсивно цели `@This` его конструктора, как их создаёт `AomApi.instanceWithHooks`), `hooks` — их `@OnInstance`-хуки.

```ts
// псевдокод — чтение цепочки; исполняемый вариант — packages/router/test/route-projection.test.ts
const route = router.routeOf(Leaf.Items);
route.toJSON().steps.map(({ i, via, step }) => `${i} ${via} ${step}`);
// ["0 class-before Guard.Check", "1 class-after Audit.Record", "2 before Filters.Where",
//  "3 endpoint Leaf.Items", "4 after Audit.Tail", "5 next Pager.Page"]
```

Приложение строит из проекции дамп `test/manifests/<module>.json` (`bun run manifests`) и проверяет свойства цепочек над всеми роутерами — `test/docs/testing.md`, раздел «Проекция цепочки и дамп».

### Ошибки определения

Ошибки сборки — синхронный `throw new Error(КОД)` в момент декорирования; текста нет, `message` равен коду (`packages/router/src/constants/errors.ts`, включая новые `USE_MIDDLEWARE_DEFINE_ERROR` и `ROUTE_REF_DELAY_ERROR`). Коды не экспортируются из пакета.

| Код                                                         | Когда бросается                                                                                                                                                                                                                          | Evidence                                                                                                                                                                              |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MIDDLEWARE_DEFINE_ERROR`                                   | `@Middleware()` на методе, уже помеченном nextpoint/endpoint/websocket/instance                                                                                                                                                          | `middlewares/index.ts` (`Middleware`)                                                                                                                                                 |
| `ENDPOINT_DEFINE_ERROR`                                     | эндпоинт-декоратор на методе с `isMiddleware`/`isWebsocket`                                                                                                                                                                              | `endpoints/index.ts` (`Endpoint`)                                                                                                                                                     |
| `NEXPOINT_DEFINE_ERROR`                                     | `@Nextpoint()` на middleware; `@WebSocketPoint()` на middleware/nextpoint                                                                                                                                                                | `endpoints/index.ts` (`Nextpoint`, `WebSocketPoint`)                                                                                                                                  |
| `ON_INSTANCE_DEFINE_ERROR`                                  | `@OnInstance()` на nextpoint/endpoint/websocket/middleware                                                                                                                                                                               | `middlewares/index.ts` (`OnInstance`)                                                                                                                                                 |
| `COMMON_ENDPOINT_ERROR`                                     | классовая форма `@Get(path, handler)`, где `handler` не `@Nextpoint()`                                                                                                                                                                   | `endpoints/index.ts` (`defineEndpoint`)                                                                                                                                               |
| `USE_NEXT_DEFINE_ERROR`                                     | `@Next(h)`, где `h` не `@Nextpoint()`                                                                                                                                                                                                    | `middlewares/index.ts` (`Next`)                                                                                                                                                       |
| `USE_MARKER_DEFINE_ERROR`                                   | `@UseMarker(h)`, где `h` не `@Marker()`                                                                                                                                                                                                  | `middlewares/index.ts` (`UseMarker`)                                                                                                                                                  |
| `USE_MIDDLEWARE_DEFINE_ERROR`                               | было (`KI-ROUTER-04`): `@Before`/`@After` со ссылкой не на `@Middleware()` молча укорачивали цепочку; исправлено — `checkMiddleware` бросает ошибку                                                                                      | `middlewares/index.ts` (`checkMiddleware`, `Before`, `After`); тест `packages/router/test/router-build.test.ts` («Before/After со ссылкой не на middleware — ошибка определения»)     |
| `ROUTE_REF_DELAY_ERROR` | `RouteRef` в `@DelayRefStack` не на эндпоинт-методе — при сборке `Router` (было, `KI-ROUTER-03`: на курсоре без эндпоинта падал `TypeError`); `RouteRef` у курсора без эндпоинта в `resolveTarget` | `common/cursor.ts` (`AomCursor.realizeDelay`, `resolveTarget`); тесты `packages/router/test/router-build.test.ts`, `packages/router/test/parameter-descriptors.test.ts` |
| `CURSOR_KIND_DEFINE_ERROR` | `@CursorKind(k)`, где `k` не значение `AomCursorKind` (опечатка `AomCursorKind.Colector` — это `undefined`), или второй `@CursorKind` на том же методе | `kinds/index.ts` (`CursorKind`); тест `packages/router/test/cursor-kinds.test.ts` |
| `ROUTE_OF_NOT_FOUND_ERROR`, `ROUTE_OF_AMBIGUOUS_ERROR` | не при декорировании, а при вызове `Router.routeOf(endpoint)`: у роутера нет маршрута с этим обработчиком / их больше одного; после кода — имя эндпоинта или все `method path` | `classes/router.ts` (`Router.routeOf`); тест `packages/router/test/route-projection.test.ts` |
| `CIRCULAR_INSTANCE_ERROR`                                   | новая: цикл создания инстансов — чужой код внутри своей же цепочки создания (`AomCursor.creating`), взаимные хуки/конструкторы двух классов, встречное ожидание двух веток (`RxContext.waits`); сообщение включает имена классов цепочки | `common/classes.ts` (`circularInstanceError`, `AomApi.instanceWithHooks`, `RxContext.waitCreation`); тест `packages/router/test/router-instance-safety.test.ts`                       |
| `CONSTRUCTOR_TYPE_ERROR`                                    | `@This(x)`, где `x` не функция, не `FwdRef` и не `RouteRef` (в том числе `ThisRef`)                                                                                                                                                      | `arguments/index.ts` (`This`)                                                                                                                                                         |
| `ERROR_CONSTRUCTOR_ERROR`                                   | `@Err(C)`, где `C` не `Error` и не его наследник                                                                                                                                                                                         | `arguments/index.ts` (`Err`)                                                                                                                                                          |
| `PARAMETER_HANDLER_ERROR`                                   | `Args(h)`, где `h` не функция                                                                                                                                                                                                            | `arguments/index.ts` (`Args`)                                                                                                                                                         |
| `WEBSOCKET_DEFINE_ERROR`, `CONSTRUCTOR_PROPERTY_TYPE_ERROR` | не используются нигде                                                                                                                                                                                                                    | `constants/errors.ts` (`WEBSOCKET_DEFINE_ERROR`, `CONSTRUCTOR_PROPERTY_TYPE_ERROR`)                                                                                                   |

Ошибки времени запроса возвращаются как `reject` промиса `route.apply(...)`; преобразование их в HTTP-ответ — задача `Server` из `@aom-js/api`.

## Инварианты и подводные камни

- `@Controller()` — верхний декоратор каждого класса, у которого есть декораторы роутера; наследник контроллера тоже `@Controller()`.
- Контроллер — класс со статическими методами; `this` внутри обработчика равен классу, per-request данные живут только в инстансах из `state`.
- В `@Before`/`@After` попадают только методы с `@Middleware()`; ссылка на что-то другое — `USE_MIDDLEWARE_DEFINE_ERROR` при сборке (`KI-ROUTER-04`, исправлено).
- Middleware продолжает цепочку, только вернув `undefined`. Любое другое значение — ответ.
- Ключ реестра для статического метода — сама функция дескриптора (`packages/core/src/defines/core.ts` (`AomCore.instanceKey`)), поэтому после наследования у потомка другой ключ и нужна перепривязка `resolveFor`.
- Классовые `@Before` проталкиваются в бриджи, классовые `@After` — нет.
- Тег операции задаёт `@UseTag` на курсоре (middleware или эндпоинте) — методный декоратор; на классе — ошибка типов (`KI-ROUTER-11`, исправлено 2026-09-14, раньше тихо игнорировалось).
- Наследник, участвующий в `@This`/маршрутах, обязан сам быть `@Controller()` — без него не наследует ни FIRST/LAST-очередь родителя, ни его `@OnInstance`-хуки (`KI-ROUTER-05`, `KI-ROUTER-18`).
- Декоратора `Summary` не существует: `summary` операции задаёт `@Title`.

### Известные дефекты

Полный реестр с последствиями для приложения — `test/docs/known-issues.md`.

Закрыто 2026-09-14 (см. §«Инстансы, `state` и `@OnInstance`», §«Отложенные ссылки», §«Сборка маршрутов», §«Сборка OpenAPI» выше — там же код и evidence):

- `KI-ROUTER-01` — гонка `@This(X)`, два инстанса и двойной `@OnInstance`. Исправлено `context.pending`.
- `KI-ROUTER-03` — общие курсоры class-level middleware между маршрутами. `AomRoute` создаёт свои.
- `KI-ROUTER-04` — `@Before`/`@After` молча отбрасывали не-middleware. Теперь `USE_MIDDLEWARE_DEFINE_ERROR`.
- `KI-ROUTER-06` (частично) — `@WebSocketPoint()` без пути падал. Теперь `path = "/"`; отсутствие в OpenAPI осталось особенностью.
- `KI-ROUTER-07` (частично) — `toJSON()` затирал `initData`. Теперь сливает; `securitySchemes` по имени класса — осталось особенностью.
- `KI-ROUTER-11` — классовый `@UseTag` тихо игнорировался. Теперь `UseTag`/`*NextTags` — методные декораторы, класс — ошибка типов.
- `KI-ROUTER-12` (легаси) — `AomApiElement.parametersHandlers` не использовался. Удалён.
- `KI-ROUTER-14` (новая, закрыта тем же проходом) — перехваченный отказ хука пропускал следующий курсор без проверки. Теперь помнится в `pending` до конца запроса.
- `KI-ROUTER-15` (новая, закрыта) — `State(constructor)` был типизирован как обязательный аргумент. Теперь `constructor?`.

Закрыто 2026-09-21 (см. §«Инстансы, `state` и `@OnInstance`», §«Ленивые значения контекста» выше):

- `KI-ROUTER-16` — готовый инстанс был виден в `state` до завершения проверки хуками `@OnInstance`. Теперь публикация двухстадийная: до конца хуков инстанс лежит в `inflight` и виден только собственному коду создающего его класса; чужой код либо ждёт (`waitCreation`/`waits`), либо (при цикле) получает `CIRCULAR_INSTANCE_ERROR`.
- `KI-ROUTER-17` (частично) — риск «чужой код успевает воспользоваться инстансом, чья проверка ещё идёт» снят тем же изменением, что и `KI-ROUTER-16`. Дизайн-вопрос «отменять ли хуки одного класса друг другу при отказе одного» остаётся открытым — см. ниже.

Особенности (документируемое поведение, не дефект):

> Классовый `@After` исполняется **до** эндпоинта, а не после него — следствие сборки `Router.build` (`postCursors` собираются раньше эндпоинта). Открытый вопрос закрыт автором: оставлено как есть. См. §«Раскладка курсоров» выше, `KI-ROUTER-02`.

> Без `@Controller()` на классе декораторы аргументов не срабатывают (аргументы `undefined`) — фаза LAST у `Args` разбирается только в `$._.apply()` из `@Controller()` (`packages/router/src/decorators/arguments/index.ts` (`Args`), `packages/router/src/decorators/controllers/index.ts` (`Controller`)). Касается и классов-целей `@This` с декорированным конструктором, и наследования `@OnInstance`-хуков (`KI-ROUTER-18`). Как обходить: `@Controller()` на каждом классе иерархии. См. `KI-ROUTER-05`.

> `@OnInstance`-хуки одного класса выполняются параллельно (`Promise.all`, `packages/router/src/common/api.ts` (`AomApi.instanceWithHooks`)), порядок не определён, отказ одного не отменяет остальные — их побочные эффекты (не связанные с отказавшей проверкой) всё равно доводятся до конца, хотя чужой код больше не видит инстанс до общего результата (`KI-ROUTER-17`, частично закрыт). Как обходить: один хук на класс либо явная последовательность внутри него. См. `KI-ROUTER-08`.

> Любое не-`undefined` значение из middleware (включая `null`, `false`, `0`, `""`) прерывает цепочку и становится ответом; возвращённый `Error` эквивалентен брошенному (`packages/router/src/common/context.ts` (`RxContext.run`)). Как обходить: middleware не возвращает ничего, ошибки бросает. См. `KI-ROUTER-09`.

> `delayRealized` взводится один раз на мета-инстанс: у `ThisRef` это не проблема (не зависит от маршрута), у `RouteRef`/`DelayRefStack` на class-level middleware, общем для нескольких маршрутов, стек реализуется в контексте первого встреченного при сборке потомка (`packages/router/src/common/api.ts` (`AomApi.delayRealized`), `packages/router/src/common/cursor.ts` (`AomCursor.realizeDelay`)). Для билдеров `@aom-js/api` безопасно: `@Controller()` на потомке даёт ему собственную каррированную копию метода и свой узел. Как обходить: помечать потомков билдеров `@Controller()`. См. `KI-ROUTER-10`.

Открыто, вопрос автору (найдено аудитом, вне правок этого этапа — см. `test/docs/known-issues.md`):

- `KI-ROUTER-17` (частично закрыт 2026-09-21 — см. выше) — дизайн-вопрос: хуки `@OnInstance` одного класса не отменяют друг друга при отказе одного (связано с `KI-ROUTER-08`). Вынесен в долг на отдельный разбор: https://github.com/aom-js/main/issues/2, план — `docs/superpowers/plans/2026-09-22-instance-hooks-cancellation.md`.
- `KI-ROUTER-18` — наследник без `@Controller()` не наследует `@OnInstance`-хуки родителя, `@This` на него отдаёт непроверенный объект.

### Легаси и мёртвый код

> 🧱 Легаси: `Router.routesMap` (карта `метод:путь → маршрут`) и метод `route(method, path)` закомментированы.
> Где: `packages/router/src/classes/router.ts` (`Router.routesMap`, `Router.route`). Почему: сопоставление пути с маршрутом делает `RouteMatcher` в `@aom-js/api`. Чем заменено: линейный `Router.routes` + `RouteMatcher`.

> 🧱 Легаси: разбор `delayStack` внутри `OpenApi.registerPath` закомментирован целиком.
> Где: `packages/router/src/classes/openapi.ts` (`OpenApi.registerPath`). Почему: стек реализуется раньше — в конструкторе курсора (`packages/router/src/common/cursor.ts` (`AomCursor.realizeDelay`)), а версия в `registerPath` расходовала стек через `shift`. Чем заменено: `AomCursor.realizeDelay` с флагом `delayRealized`.

> 🧱 Легаси: `AomHttpOpenApi.delayStack` (закомментированное поле) и тип `AomMarker`.
> Где: `packages/router/src/common/api.ts` (`AomHttpOpenApi.delayStack`), `packages/router/src/common/api.ts` (`AomMarker`). Почему: стек переехал на сам `AomApi` (`packages/router/src/common/api.ts` (`AomApi.delayStack`, `AomApi.delayRealized`)), маркеры хранятся списком `AomApi`. Чем заменено: `AomApi.delayStack`, `AomApiElement.markers`.

`KI-ROUTER-12` (легаси `AomApiElement.parametersHandlers`) закрыт — поле удалено, см. §«Известные дефекты» выше.

## Как использует приложение

Корень сервера модуля — контроллер без методов, собранный из бриджей; `Router` строится один раз при импорте модуля и передаётся в `Server`. Роутер вынесен в отдельный файл, чтобы тесты брали тот же роутер, не запуская сервер:

`test/src/modules/orgs/api/router.ts` (`Index`, `router`), `test/src/modules/orgs/api/index.ts`

```ts
// router.ts
@Controller()
@Bridge("/", ModuleRoot)
@Bridge("/api", OrgsRoutes)
class Index {}

export const router = new Router(Index, Docs);

// index.ts
export default new Server(settings, router, i18nizer);
```

Ресурс собирается из классового `@Before` (общая подготовка), бриджа на дочерний контроллер по ID-сегменту и эндпоинтов, каждый из которых цепляет свои `@Before` и `@Next`:

`test/src/modules/orgs/api/routes/orgs/index.ts` (`Orgs.Index`)

```ts
  @Get("/")
  @Before(Orgs.PrepareBaseQuery)
  @Next(OrgsData.PagerData)
  @Title("Список организаций")
  static async Index() {
    //
  }
```

Здесь же — ``@Bridge(`/id-${OrgIDValue}`, Org)`` (`test/src/modules/orgs/api/routes/orgs/index.ts` (`Orgs`)): шаблонная строка разворачивается в сегмент `:orgId(...)` через `toString()` ID-параметра из `@aom-js/api`. Отложенные ссылки приложение применяет по образцу билдеров: `ThisRef` + `@DelayRefStack` в `test/src/common/controllers/entity.ts` (`SafeOriginResponseArray`, `SafeOriginResponse`, `EntityController.Data`, `EntityController.Value`) (подстановка `Responses` со схемой конкретного потомка) и в `test/src/common/controllers/protected.ts` (`SafeModuleIndex`, `ProtectedController.Index`) (подстановка `@Next` на `Index` конкретного корневого контроллера модуля).

Единственное место, где приложение пишет в структуры роутера, — фильтрация карты маршрутов по маркерам доступа: `router.routes = router.routes.filter(...)` в `test/src/common/controllers/protected.ts` (`ProtectedController.Index`). Мутируется общий объект `Router`, разделяемый всеми запросами процесса (`KI-COMMON-04` в `test/docs/known-issues.md`).

Правила применения роутера на стороне приложения — `test/docs/principles.md` §«Композиция через декораторы», §«DI через @This и жизненный цикл инстансов»; трассировки конкретных запросов — `test/docs/request-lifecycle.md`.

## Сборка и потребление

Сборка: `bun run build:router` в корне ядра (то же, что `bun --filter @aom-js/router build`). Скрипт чистит `dist/`, запускает `tsc` трижды — `tsconfig.build.json` (CommonJS → `dist/cjs`), `tsconfig.build.mjs.json` (ESM → `dist/mjs`), `tsconfig.build.types.json` (только декларации → `dist/types`) — и завершается `node ../../scripts/post-build.js`, который дописывает расширения относительным импортам и кладёт `dist/cjs/package.json`. Сам `package.json` пакета генерируется `main/scripts/prebuild.js`: скрипт мержит `package.version.json` + `package.src.json` пакета с общим `scripts/jsons/package.dist.json` (`scripts/files.js:3`, `scripts/prebuild.js:19-27`), поэтому `main: "./src/index.ts"` из `package.src.json` в итоговом манифесте перекрывается `main: "./dist/cjs/index.js"` из dist-манифеста. Править нужно `package.src.json` и `scripts/jsons`, а не сгенерированный `package.json`.

Приложение подключает пакет симлинком `test/node_modules/@aom-js/router → main/packages/router` и импортирует **собранный** `dist`, поэтому правки `src` не видны приложению без `bun run build`. Тесты ядра, наоборот, идут по `src` через алиасы `main/vitest.config.ts` (блок `resolve.alias`). На диске `dist` собран 25 августа и уже содержит незакоммиченные правки (см. блок `✏️` выше), `src/common/classes.ts` датирован 15 августа — пересборка не требуется. Полная схема сборки монорепо и dist-потребления — `main/docs/architecture.md`.

## Тесты

### Что покрыто

| Файл                                  | Что проверяет                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `test/router-build.test.ts`           | Эндпоинты класса → маршруты с методом и путём; `@Bridge` в два уровня вложенности; наследник контроллера получает маршруты родителя; конфликты ролей метода (`MIDDLEWARE_DEFINE_ERROR`, `ENDPOINT_DEFINE_ERROR`); курсоры class-level middleware свои у каждого маршрута (`KI-ROUTER-03`); `RouteRef` без эндпоинта → `ROUTE_REF_DELAY_ERROR`; `Before`/`After` не на middleware → `USE_MIDDLEWARE_DEFINE_ERROR` (`KI-ROUTER-04`); `WebSocketPoint()` без пути (`KI-ROUTER-06`)                                                                                                                                                                   |
| `test/router-exec.test.ts`            | Порядок middleware и эндпоинта; `PREPEND`-наследование `@Before`/`@After`; перехват ответа middleware; возвращённый `Error` и `throw` → reject; `@Body`/`@Query`; `@This` + конструктор-аргументы + `@OnInstance`; два `@This` одного класса — один инстанс, один хук (`KI-ROUTER-01`); класс, нужный методу и конструктору другого `@This`-класса, создаётся один раз; отказ конструктора/хука не пускает следующий курсор без инстанса и запоминается до конца запроса (`KI-ROUTER-14`); `@State(constructor?)` (`KI-ROUTER-15`); курсор, чьё создание уже идёт, ждёт готового инстанса; повторное обращение после отказа получает ту же ошибку |
| `test/openapi.test.ts`                | `operationId`/`summary`/`description`; `@Responses` с компонент-схемой → `$ref` и массивная обёртка; компонент попадает в `components.schemas` один раз; `@RequestBody`; `@PathParameters` заменяет сегмент на `{name}`; `@Security`; `components`/`tags`/`paths` из `initData` сливаются со сгенерированным (`KI-ROUTER-07`)                                                                                                                                                                                                                                                                                                                     |
| `test/integration.test.ts`            | Контроллер + `@ComponentSchema` + class-validator + OpenAPI из одних метаданных: валидное тело трансформируется, невалидное даёт reject со статусом 400, та же схема отражена в документе                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `test/inherited-static-refs.test.ts`  | Паттерн билдеров: `@Before(Self.Inherited)` резолвится в инстанс потомка; курсор реализует `delayStack` в контексте потомка; страховочная перепривязка `AomCursor`; `FwdRef`; `@UseMarker(Self.Inherited)`; `realizeDelay` не расходует стек при ошибке                                                                                                                                                                                                                                                                                                                                                                                           |
| `test/router-instance-safety.test.ts` | Двухстадийная публикация инстанса (`KI-ROUTER-16`, `KI-ROUTER-17`): непроверенный инстанс не виден чужому коду через `@This`/`@State`; чужая middleware/хук, поднятые через `next()` изнутри создания класса, получают `CIRCULAR_INSTANCE_ERROR`; чужая ветка ждёт окончания хуков и получает проверенный инстанс либо ту же ошибку; собственный код класса (`@This()`/`@This(СвойКласс)` в своём хуке и в его же middleware через `next()`) получает инстанс сразу; циклы — взаимные хуки двух классов, конструктор↔хук, взаимные `@This` в конструкторах, встречное ожидание двух веток — дают `CIRCULAR_INSTANCE_ERROR` с именами классов      |
| `test/lazy-values.test.ts`            | Ленивые значения контекста: одна фабрика на все обращения `@Body` в запросе (несколько параметров и отдельный курсор `@Before`); фабрика не вызывается, если поле не запрошено; отказ (`reject` и синхронный `throw`) отдаётся всем обращениям и не перезапускает фабрику; готовое (не ленивое) значение работает как раньше                                                                                                                                                                                                                                                                                                                      |
| `test/cursor-kinds.test.ts` | Словари проекции — ровно значения спеки; `@CursorKind` пишет вид в мета-инстанс, наследник получает его без ошибки; значение вне словаря и повтор — `CURSOR_KIND_DEFINE_ERROR` |
| `test/parameter-descriptors.test.ts` | Дескрипторы 16 встроенных декораторов аргументов и `{kind: "other"}` у `Args(h)`; `resolveTarget` для класса, `FwdRef`, `ThisRef` на унаследованном шаге, `RouteRef` с эндпоинтом и без; цель `cursor.parameters()` равна внедрённой на исполнении; `RouteRef` в `@DelayRefStack` — только на эндпоинте |
| `test/route-projection.test.ts` | `via`/`viaGroup` всех 6 видов; `Router.routeOf` и обе ошибки, поиск без регистрации мета-инстанса; форма и детерминизм `toJSON`; параметры (`this`, `values` с полями из `$.openApi` и схемы тела), `creates`/`hooks` |

### Пробелы

Не покрыты тестами: `@Marker`/`@UseMarker` и содержимое `route.markers`; цепочки `@Next`/`@Nextpoint`; классовая форма `@Get(path, handler)`; `@Cursor()`, `@Route()`, `@Cookies`, `@Params`, `@Session`, `@Files`; правила тегов и `tagsSeparator`; `@QueryParameters`/`@CookieParameters`/`@Parameters`; `ThisRef`/`RouteRef` в схемах документа; классовый `@After` до эндпоинта (зафиксирован лишь косвенно в тесте наследования); `@Bridge` на методе; потомок контроллера без `@Controller()` пропускает `@OnInstance`-хуки родителя (`KI-ROUTER-18`, воспроизведено вручную при аудите, не тестом пакета); ленивые `query`/`params`/`cookies`/`headers` (тесты покрывают только `body`, механизм в `RxContext.value` общий для всех полей).

### Как запускать

```bash
cd main && bun run test          # весь монорепо
cd main && bunx vitest run packages/router
```

Текущий результат по пакету (проверено 2026-09-21): 7 файлов, 57 passed, `it.fails` нет.

## Расхождения с историческими заметками

| Заметка                                            | Утверждение                                                                                                                                 | Фактически                                                                                                                                                                                                                         | Evidence                                                                                                                                                                                                |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/router/readme.md` (прежний)              | «Basic routes builder» — одна строка                                                                                                        | Пакет отвечает и за сборку, и за исполнение, и за OpenAPI                                                                                                                                                                          | этот документ                                                                                                                                                                                           |
| `packages/router/src/readme.md`                    | Интеграция через `$aom.eachRoute(({method, path, middlewares}) => ...)`, функции `in`/`out`, `next` в контексте                             | `eachRoute` и `middlewares` отсутствуют; есть `Router.routes[]` и `AomRoute.apply(HttpContextValues)` без поля `next`; интеграцию делает `Server` из `@aom-js/api`                                                                 | `packages/router/src/classes/router.ts` (`Router.routes`, `Router.sockets`); `packages/router/src/types/index.ts` (`HttpContextValues`)                                                                 |
| `packages/router/src/readme.md`                    | Классы `AomHttp`/`AomAPI`, декоратор `@UseNext`                                                                                             | Класс называется `AomApi`, сборщик — `Router`, декоратор — `Next`                                                                                                                                                                  | `packages/router/src/common/api.ts` (`AomApi`); `packages/router/src/decorators/middlewares/index.ts` (`Next`)                                                                                          |
| `main/docs/lazy-evaluations.md`                    | Отложенные декораторы запускаются через `setTimer`/DELAY после всех наследований; middleware через `@Use(...)`; `relationMap`/`AomRouteMap` | Роутер фазу DELAY не использует: `@Before`/`@After` — LAST и разбираются синхронно в `@Controller()`; отложенные ссылки реализуются в конструкторе курсора; декоратор называется `Before`; `AomRouteMap`/`relationMap` отсутствуют | `packages/router/src/decorators/middlewares/index.ts` (`Before`); `packages/router/src/common/cursor.ts` (`AomCursor`, `AomCursor.realizeDelay`)                                                        |
| `main/docs/lazy-evaluations.md`                    | В сборке эндпоинты обрабатываются до бриджей, есть `routesMap.set`                                                                          | `Router.build` сначала рекурсивно обходит бриджи, затем эндпоинты; `routesMap` нет                                                                                                                                                 | `packages/router/src/classes/router.ts` (`Router.build`)                                                                                                                                                |
| `main/docs/on-instance-hook.md`                    | `@OnInstance`-хуки формируются «в нужном порядке» стандартной процедурой `context.run`                                                      | Хуки запускаются параллельно (`Promise.all`, каждый — отдельный `context.run([cursor])`), порядок не гарантирован                                                                                                                  | `packages/router/src/common/api.ts` (`AomApi.instanceWithHooks`)                                                                                                                                        |
| `main/docs/correct-extends.md`                     | Родительские декораторы всегда попадают в конец списка потомка                                                                              | Появился `InheritPlacement.PREPEND`: классовый `@Before` родителя переносится в начало; `@After` — по-прежнему в конец                                                                                                             | `packages/router/src/decorators/middlewares/index.ts` (`Before`); `packages/router/test/router-exec.test.ts` («наследование: Before родителя выполняется ДО Before потомка (InheritPlacement.PREPEND)») |
| `main/docs/openapi.md`                             | Схема собирается «на базе рутового контроллера» (текст обрывается)                                                                          | Собирается по маршрутам: `Router` вызывает `docs.registerPath(route)` для каждого `AomRoute`, теги/параметры/ответы копятся по курсорам                                                                                            | `packages/router/src/classes/router.ts` (`Router`); `packages/router/src/classes/openapi.ts` (`OpenApi.registerPath`)                                                                                   |
| `packages/router/src/specials/readme.md`           | Используются `RouteRef` и `ThisRef`                                                                                                         | Есть также `FwdRef`/`FwdContainer` (без аргумента), принимаемый `@Before`/`@After`/`@UseMarker`/`@Next`/`@This`/`@DelayRefStack`                                                                                                   | `packages/router/src/specials/references.ts` (`FwdRef`); `packages/router/src/decorators/middlewares/index.ts` (`Before`, `After`, `UseMarker`, `Next`)                                                 |
| `packages/router/src/decorators/openapi/readme.md` | «Поддерживает ту же идею, что и предыдущая вариация»                                                                                        | Содержательной документации нет; описание декораторов — в этом документе                                                                                                                                                           | файл из 3 строк                                                                                                                                                                                         |
| Черновики и обсуждения                             | Существует декоратор `Summary`                                                                                                              | Декоратора `Summary` нет ни в роутере, ни в `@aom-js/api`; `summary` операции задаёт `@Title`                                                                                                                                      | `packages/router/src/classes/openapi.ts` (`OpenApi.registerPath`); `grep -r Summary packages/*/src` — пусто                                                                                             |

## Открытые вопросы

Закрыты 2026-09-14 решением автора (см. `test/docs/known-issues.md`): классовый `@After` до эндпоинта — оставлено как особенность (`KI-ROUTER-02`); уникальность курсоров classовых middleware — сделано, `AomRoute` создаёт свои (`KI-ROUTER-03`); дедупликация `@This` — сделано через `context.pending` (`KI-ROUTER-01`); путь `@WebSocketPoint()` без аргумента — `"/"` (`KI-ROUTER-06`).

Закрыт 2026-09-21: `KI-ROUTER-16` (готовый инстанс виден в `context.state` до завершения хуков) — двухстадийная публикация через `inflight`/`state`, см. §«Инстансы, `state` и `@OnInstance`».

> ❓ Открытый вопрос: ожидается ли, что `@MergeNextTags` без `@UseTag` на том же элементе игнорируется, или правило должно действовать на последующие курсоры независимо?

> ❓ Открытый вопрос: планируется ли задействовать объявленные, но неиспользуемые коды `WEBSOCKET_DEFINE_ERROR` и `CONSTRUCTOR_PROPERTY_TYPE_ERROR`?

> ❓ Открытый вопрос: зачем в `package.src.json` держать `main: "./src/index.ts"`, если `prebuild` всегда перекрывает это поле значением из `scripts/jsons/package.dist.json`?

> ❓ Открытый вопрос автору (`KI-ROUTER-17`, связано с `KI-ROUTER-08`, частично закрыт 2026-09-21 — риск утечки чужому коду снят вместе с `KI-ROUTER-16`): хуки `@OnInstance` одного класса всё ещё идут через `Promise.all` без отмены соседей — при отказе одного стоит ли отменять/не запускать остальные, или независимость хуков — часть контракта? Вопрос вынесен в долг: https://github.com/aom-js/main/issues/2.

> ❓ Открытый вопрос автору (`KI-ROUTER-18`, найдено аудитом): наследник без `@Controller()` пропускает `@OnInstance`-хуки родителя и тем самым — проверку доступа через `@This`; достаточно ли инварианта «`@This`-цель обязана быть `@Controller()`», или нужна отдельная защита?
