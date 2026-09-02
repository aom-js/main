# `@aom-js/router`

Пакет строит карту HTTP/WS-маршрутов из классов-контроллеров со статическими методами и исполняет запрос как линейную цепочку курсоров. Здесь же живут DI через `state`, отложенные ссылки, маркеры и генерация документа OpenAPI 3.1. Состояние на 2026-09-02.
Читать до: `main/packages/core/readme.md` (реестр мета-инстансов, фазы, наследование). Читать после: `main/packages/api/readme.md` (сервер, билдеры, доступ), `test/docs/request-lifecycle.md` (трассировки запросов приложения).
Термины — `test/docs/README.md#словарь`.

## Назначение и место в стеке

Пакет отвечает за две задачи: **сборку** (из дерева контроллеров получить `Router.routes` — плоские маршруты с путём, методом и списком курсоров) и **исполнение** (`AomRoute.apply(values)` — последовательный прогон курсоров с DI и сборкой аргументов). Метаданные не хранятся в самом пакете: каждый класс и каждый его декорированный метод получают мета-инстанс `AomApi` — наследника `AomCore` из `@aom-js/core`, с прикладными полями `element` (роль метода и списки связей) и `openApi` (декларации для документа). Декораторы пакета только заполняют эти поля (`packages/router/src/common/classes.ts:155-198`); когда именно выполняется тело декоратора, определяет фаза из `@aom-js/core` (`packages/core/src/defines/core.ts:99-113, 521-614`).

Зависимости: `@aom-js/core` (реестр, фазы, наследование, `resolveFor`), `@aom-js/schemer` (`Schemer` + `SchemasCollector` для рендера компонент-схем в `components.schemas`), `rxjs` (последовательное исполнение), `openapi3-ts` (типы документа). Потребители: `@aom-js/api` — `Server` матчит путь и вызывает `route.apply(...)`, билдеры и `BaseAccessController` строятся на декораторах и маркерах роутера; приложение импортирует роутер напрямую в каждом контроллере (`test/src/modules/orgs/api/index.ts:1-12`). Полный граф пакетов и порядок сборки монорепо — `main/docs/architecture.md` §«Состав…».

## Публичный API

Экспорт — `src/index.ts:1-9`: `decorators`, `specials`, `types`, `classes`, `common/openapi`, `common/classes`, `common/types`. Файлы `common/references.ts` и `constants/errors.ts` в реэкспорт не входят — контейнеры ссылок и коды ошибок доступны только как типы в сигнатурах и как строки в сообщениях `Error`.

Число в колонке «Используется приложением» — количество файлов `test/src`, импортирующих символ из `"@aom-js/router"` (не количество применений: например, у `This` 154 импорта при 646 применениях `@This(`); после числа — путь к файлу-образцу со строкой импорта.

### Классы и модель маршрута

| Экспорт | Сигнатура | Назначение | Используется приложением |
|---|---|---|---|
| `Router` | `new Router(root: ClassType, docs: OpenApi)`; `routes: AomRoute[]`; `sockets: AomRoute[]` | Обход дерева контроллеров по бриджам, сборка маршрутов, регистрация их в OpenAPI | да (`test/src/modules/*/api/index.ts`) |
| `OpenApi` | `new OpenApi(initData: OpenAPIObject)`; `registerPath(route)`; `toJSON()`; `static tagsSeparator = " > "`; `static readonly refPointerPrefix` | Накопитель и генератор документа OpenAPI 3.1 | да (`test/src/modules/*/api/init.ts`) |
| `AomApi` | `class AomApi extends AomCore { openApi; element; delayStack; delayRealized; title?; description?; toString(); static instanceWithHooks(target, args) }` | Мета-класс роутера; `AomApi.instance(target, property?)` — доступ к реестру | да (`test/src/modules/orgs/api/routes/permissions/init/controllers/org-users/current-value.ts`) |
| `AomCursor` | `new AomCursor($: AomApi, origin: AomApi, prefix: string, endpoint?: AomEndpoint)`; `$`, `origin`, `prefix`, `endpoint`, `index` | Единица исполнения цепочки; при создании перепривязывается и реализует `delayStack` | да, как тип (`test/src/modules/tickets/api/routes/tickets/init/controllers/value.ts`) |
| `AomRoute` | `router; endpoint; path; method; markers: MarkerType; cursors: AomCursor[]; apply(context: HttpContextValues): Promise<any>` | Готовый маршрут | да (`test/src/common/controllers/protected.ts:22`) |
| `TagsRules` | `enum { IGNORE, MERGE, REPLACE }` | Правило слияния тегов | нет |
| `RxContext` | `values; state: ClassInstanceMap; route; run(cursors)` | Контекст одного исполнения маршрута. **Не экспортируется** (`common/classes.ts:329`) | нет |
| `FwdContainer` / `ThisRefContainer` / `RouteRefContainer` | `exec(constructor?)` | Контейнеры отложенных ссылок. **Не экспортируются** (`common/references.ts:17-32`), создаются фабриками | нет |

### Декораторы структуры

| Экспорт | Сигнатура | Назначение | Используется приложением |
|---|---|---|---|
| `Controller` | `Controller(): ClassDecorator` | Наследование декораторов предков + разбор LAST-очереди | да (207; `test/src/modules/orgs/api/routes/orgs/index.ts:1`) |
| `Get/Post/Put/Patch/Delete/Options/All` | `(path?: string): MethodDecorator`; `(path: string, handler): ClassDecorator` | Эндпоинт; классовая форма подключает чужой `@Nextpoint()` | да, только методная форма |
| `Endpoint` | `Endpoint(method: HTTPMethods, path = "/")` | Базовый эндпоинт-декоратор | нет |
| `Nextpoint` | `Nextpoint(): MethodDecorator` | Метод-продолжение для `@Next` и классовой формы эндпоинта | да (45; `test/src/common/controllers/entity.ts:22`) |
| `WebSocketPoint` | `WebSocketPoint(path?: string)` | Эндпоинт метода `sockets` → `Router.sockets` | нет |
| `Middleware` | `Middleware(): MethodDecorator` | Помечает метод как middleware | да (135; `test/src/modules/orgs/api/routes/orgs/index.ts:2`) |
| `Before` / `After` | `(...mw: Array<MiddlewareHandler \| FwdContainer>): CombinedDecorator` | pre/post-middleware класса или метода | да (123 / 49; `test/src/modules/orgs/api/routes/orgs/index.ts:1-2`) |
| `Bridge` | `Bridge(prefix: string, next: ClassType): CombinedDecorator` | Монтирование дочернего контроллера под префиксом | да (44; `test/src/modules/orgs/api/routes/orgs/index.ts:2`) |
| `Next` | `Next(handler: HandlerFunction \| FwdContainer): MethodDecorator` | Назначает методу nextpoint | да (66; `test/src/modules/orgs/api/routes/orgs/index.ts:2`) |
| `OnInstance` | `OnInstance(): MethodDecorator` | Хук после создания инстанса класса | да (11; `test/src/common/controllers/current-data/current-org.ts:2`) |
| `Marker` / `UseMarker` | `Marker(): MethodDecorator`; `UseMarker(handler: MarkerHandler \| FwdContainer)` | Build-time обработчик маршрута | нет (через `@aom-js/api`) |

### Декораторы аргументов

Все — параметр-декораторы фазы LAST, объявлены в `src/decorators/arguments/index.ts`.

| Экспорт | Сигнатура | Назначение | Используется приложением |
|---|---|---|---|
| `Args` | `Args(handler?: (args: {context, cursor, route}) => any)` | Базовый декоратор аргумента | нет (через `@aom-js/api`) |
| `Query` / `Body` / `Params` / `Cookies` / `Headers` | `(handler?: Function \| ThisRefContainer \| RouteRefContainer \| string)` | Значение из соответствующего поля контекста | нет напрямую; обёрнуты билдерами `@aom-js/api` |
| `Session` / `Files` | `(name?: string)` | `values.session` / `values.files` целиком или по ключу | `Files` — да (`test/src/modules/files/api/routes/files/index.ts`) |
| `Ctx` / `Req` / `Res` | `()` | `values.ctx` / `values.req` / `values.res` | `Ctx` — да (2; `test/src/modules/files/api/routes/files/index.ts:3`) |
| `Cursor` / `Route` | `()` | Текущий курсор / маршрут | да (по 1; `test/src/modules/tickets/api/routes/tickets/init/controllers/value.ts:1`, `test/src/common/controllers/protected.ts:3`) |
| `State` | `State(constructor?)` | Инстанс из `state` или весь `state` | нет |
| `This` | `This(ctor?: ClassConstructor \| FwdContainer \| RouteRefContainer)` | Инстанс класса из `state`, создаётся при отсутствии | да (154; `test/src/modules/orgs/api/routes/orgs/index.ts:2`) |
| `Run` | `Run()` | Функция `(...handlers) => Promise<any>` — прогон дополнительных курсоров | нет |
| `Err` | `Err(ErrorConstructor = Error)` | Фабрика ошибки со `status`/`data` | нет |

### Декораторы документации и OpenAPI

| Экспорт | Сигнатура | Назначение | Используется приложением |
|---|---|---|---|
| `Title` / `Description` | `(value: string): CombinedDecorator` | `summary`/`description` операции; `Title` также задаёт имя тега | да (65 / 3; `test/src/modules/orgs/api/routes/orgs/index.ts:1`, `test/src/modules/auth/api/routes/index.ts:4`) |
| `Responses` | `Responses(...schemas: OpenApiResponse[])` | Ответы операции | да (74; `test/src/common/controllers/current-data/current-org.ts:2`) |
| `RequestBody` | `RequestBody(schema: OpenApiRequestBody)` | Тело запроса | да (1; `test/src/modules/files/api/routes/files/index.ts:3`) |
| `PathParameters` | `PathParameters(...schemas: OpenApiPathParameters[])` | Параметры пути; ключ — литеральный сегмент пути | нет (через `ParamsBuilder`) |
| `QueryParameters` / `CookieParameters` / `Parameters` | `(...schemas)` | Параметры `query` / `cookie` / произвольные | нет (через билдеры) |
| `Security` | `Security(schema: OpenApiSecuritySchema): CombinedDecorator` | Схема безопасности операции | нет (через auth-контроллеры) |
| `UseTag` | `UseTag(constructor: ClassType)` | Тег операции по классу | да (40; `test/src/modules/orgs/api/routes/orgs/index.ts:2`) |
| `IgnoreNextTags` / `MergeNextTags` / `ReplaceNextTags` | `()` | Правило слияния тегов | `MergeNextTags` — да (5; `test/src/modules/tickets/api/routes/index.ts:1`) |
| `DelayRefStack` | `DelayRefStack(handler: FwdContainer \| ThisRefContainer \| RouteRefContainer): MethodDecorator` | Отложенные декораторы, реализуемые при создании курсора | да (2; `test/src/common/controllers/protected.ts:2`) |

### Фабрики ссылок и типы

| Экспорт | Сигнатура | Назначение | Используется приложением |
|---|---|---|---|
| `FwdRef` | `FwdRef(fn: () => HandlerFunction \| ClassType): FwdContainer` | Ссылка без контекста (циклические импорты) | нет |
| `ThisRef` | `ThisRef(fn?: (ctor: ClassType) => any): ThisRefContainer` | Ссылка с классом текущего курсора | да (2; `test/src/common/controllers/protected.ts:2`) |
| `RouteRef` | `RouteRef(fn?): RouteRefContainer` | Ссылка с классом эндпоинта маршрута | нет |
| `HttpContextValues` | `{ctx, req, res, body, files, query, params, cookies, headers, session}` | Контракт входа `AomRoute.apply` (`src/types/index.ts:5-16`) | нет напрямую |
| `RunFunction` | `(...middlewares: HandlerFunction[]) => Promise<any>` | Тип результата `@Run()` | нет |
| `HTTPMethods` | `"get" \| "post" \| "put" \| "patch" \| "delete" \| "options" \| "all" \| "sockets"` | Методы маршрута | да (через `@aom-js/api`) |
| `HandlerFunction` / `MiddlewareHandler` / `FwdFunction` / `RefFunction` / `ContainerFunction` | `src/common/types.ts:13-21` | Базовые функциональные типы | `RefFunction` — да (2; `test/src/common/controllers/protected.ts:2`) |
| `AomBridge` / `AomEndpoint` / `MarkerType` / `MarkerHandler` / `ArgumentsHandlerParameters` / `ArgumentsDecoratorHandler` | `src/common/classes.ts:26-53` | Структурные типы | `MarkerType` — да (1; `test/src/common/controllers/module/controller.ts:2`) |
| `OpenApiPossibleSchema` / `OpenApiSchemaObject` / `OpenApiSecuritySchema` / `OpenApiParameterObject` / `OpenApiResponse` / `OpenApiRequestBody` / `OpenApiPathParameterObject` / `OpenApiPathParameters` | `src/common/openapi.ts:6-51` | Типы деклараций OpenAPI | `OpenApiResponse` — да (2; `test/src/common/controllers/entity.ts:22`) |
| `OpenAPIObject` | реэкспорт `openapi3-ts/oas31` | Тип документа | нет |

## Внутренние модули

| Файл | Ответственность | Ключевые символы |
|---|---|---|
| `src/index.ts` | Реэкспорт публичной поверхности; импорт `reflect-metadata` | — |
| `src/classes/router.ts` | Обход дерева контроллеров по бриджам, сборка `routes`/`sockets`, регистрация в OpenAPI | `Router`, приватный `build` |
| `src/classes/openapi.ts` | Накопление `paths`/`tags`/`securitySchemes`/`schemas` по курсорам, `toJSON()` | `OpenApi`, `registerPath`, `storeSecurityScheme`, `schemaExtract` |
| `src/common/classes.ts` | Модель пакета: мета-класс, курсор, маршрут, контекст исполнения | `AomApi`, `AomCursor`, `AomRoute`, `RxContext`, `TagsRules`, `AomApiElement`, `AomHttpOpenApi`, `AomHttpParameters` |
| `src/common/references.ts` | Контейнеры отложенных ссылок | `RefContainer` (приватный), `FwdContainer`, `ThisRefContainer`, `RouteRefContainer` |
| `src/common/openapi.ts` | Типы деклараций OpenAPI (схема — класс, контейнер ссылки или объект) | `OpenApiPossibleSchema`, `OpenApiResponse`, `OpenApiPathParameters` |
| `src/common/types.ts` | Базовые функциональные типы и перечень методов | `HTTPMethods`, `HandlerFunction`, `RefFunction` |
| `src/types/index.ts` | Контракт входа `AomRoute.apply` | `HttpContextValues`, `RunFunction` |
| `src/decorators/controllers/index.ts` | `@Controller()`: наследование декораторов предков и `$._.apply()` | `Controller` |
| `src/decorators/endpoints/index.ts` | Эндпоинты, nextpoint, websocket | `Endpoint`, `Nextpoint`, `WebSocketPoint`, `defineEndpoint` (приватная) |
| `src/decorators/middlewares/index.ts` | Связи между методами и контроллерами | `Before`, `After`, `Middleware`, `Bridge`, `Marker`, `UseMarker`, `Next`, `OnInstance` |
| `src/decorators/arguments/index.ts` | Вычисление аргументов метода из контекста запроса | `Args`, `This`, `Run`, `Err`, `Query`, `Body`, … |
| `src/decorators/docs/index.ts` | `summary`/`description` операции | `Title`, `Description` |
| `src/decorators/openapi/index.ts` | Декларации операции + `DelayRefStack` | `Responses`, `RequestBody`, `PathParameters`, `Security`, `DelayRefStack` |
| `src/decorators/openapi/tags.ts` | Теги и правила их слияния | `UseTag`, `MergeNextTags`, `IgnoreNextTags`, `ReplaceNextTags` |
| `src/specials/references.ts` | Фабрики контейнеров ссылок | `FwdRef`, `ThisRef`, `RouteRef` |
| `src/constants/errors.ts` | Строковые коды ошибок определения (`message === код`) | `MIDDLEWARE_DEFINE_ERROR`, `ENDPOINT_DEFINE_ERROR`, … |
| `test/*.test.ts` | Vitest-тесты пакета (5 файлов) | см. §«Тесты» |

## Ключевые механизмы

### Фазы декораторов и `@Controller`

Все декораторы — тонкие обёртки над фабриками мета-класса (`AomApi.classDecorator/methodDecorator/combinedDecorator/parameterDecorator`), которые кладут ленивый вызов в очередь нужной фазы. Фаза по умолчанию — `FIRST` (`packages/core/src/defines/core.ts:521-614`): обработчик выполняется сразу при декорировании и сохраняется для наследников. Фаза `LAST` откладывает вызов до `$._.apply()`, который делает `@Controller()`. Сам `@Controller()` — `INSTANT`: он не сохраняется в callstack (иначе рекурсия при переносе), вызывает `$._.inherit()` для ближайшего прототипа и поднимается по цепочке выше только пока очередной предок сам не помечен `@Controller()` (иначе его собственный `inherit` уже перенёс всё, что лежит выше), затем — `$._.apply()` (`packages/router/src/decorators/controllers/index.ts:4-26`).

Отсюда два жёстких правила: `@Controller()` ставится верхним декоратором класса (выполняется последним), и наследник контроллера тоже обязан быть `@Controller()`: перенос декораторов предка делает только сам `@Controller()` (`packages/router/src/decorators/controllers/index.ts:10-23`). Положительный случай — потомок-контроллер получает маршруты родителя — зафиксирован тестом `packages/router/test/router-build.test.ts:55-71`; отрицательный случай (потомок без `@Controller()`) тестами не покрыт.

| Декоратор | Цель | Фаза | Что делает | Где хранится |
|---|---|---|---|---|
| `@Controller()` | класс | INSTANT | `inherit` ближайшего прототипа (вверх — только через предков без `@Controller()`) + `apply()` | `element.isController` |
| `@Bridge(prefix, Next)` | класс, метод | FIRST | Регистрирует бридж; на методе — ставит метод первым pre-middleware дочернего контроллера | `$._.root.element.bridges`; `next.element.pre_middlewares` |
| `@Endpoint(method, path)`, `@Get/@Post/@Put/@Patch/@Delete/@Options/@All(path?)` | метод | FIRST | Помечает метод эндпоинтом и регистрирует его у класса | `element.isEndpoint`; `$._.root.element.endpoints` |
| `@Get(path, handler)` и аналоги | класс | FIRST | Подключает чужой `@Nextpoint()` как эндпоинт класса | `$.element.endpoints` |
| `@Nextpoint()` | метод | FIRST | Помечает метод продолжением | `element.isNextpoint` |
| `@WebSocketPoint(path)` | метод | FIRST | Эндпоинт с методом `sockets` | `element.isWebsocket`; `$._.root.element.websockets` |
| `@Middleware()` | метод | FIRST | Помечает метод middleware | `element.isMiddleware` |
| `@Before(...)` | класс, метод | LAST, `PREPEND` | Фильтрует аргументы по `isMiddleware`, доразрешает через `resolveFor` | `element.pre_middlewares` |
| `@After(...)` | класс, метод | LAST | То же, но в пост-список | `element.post_middlewares` |
| `@Next(handler)` | метод | LAST | Требует `isNextpoint` у аргумента | `element.nextpoint` |
| `@OnInstance()` | метод | FIRST | Регистрирует хук создания инстанса класса | `element.isInstance`; `$._.root.element.instanceHooks` |
| `@Marker()` | метод | FIRST | Помечает build-time обработчик | `element.isMarker` |
| `@UseMarker(handler)` | метод | LAST | Требует `isMarker` у аргумента | `element.markers` |
| `@Title(v)` / `@Description(v)` | класс, метод | FIRST | Текст операции; `title` тега берётся отсюда же | `$.title` / `$.description` |
| `@UseTag(Class)` | класс, метод | FIRST | Назначает тег | `$.openApi.tag.$` |
| `@IgnoreNextTags/@MergeNextTags/@ReplaceNextTags` | класс, метод | FIRST | Правило слияния | `$.openApi.tag.rule` |
| `@Security(schema)` | класс, метод | FIRST | Схема безопасности | `$.openApi.security` |
| `@RequestBody(schema)` | метод | FIRST | Тело запроса | `$.openApi.requestBody` |
| `@Responses(...)` | метод | FIRST | Ответы | `$.openApi.responses` |
| `@PathParameters(...)` | метод | FIRST | Параметры пути | `$.openApi.path` |
| `@QueryParameters/@CookieParameters/@Parameters(...)` | метод | FIRST | Прочие параметры (с проставленным `in`) | `$.openApi.parameters` |
| `@DelayRefStack(container)` | метод | FIRST | Кладёт контейнер в стек отложенных декораторов | `$.delayStack` |
| `@Args(handler)` и производные | параметр | LAST | Записывает обработчик по индексу параметра | `$.element.parameters.handlers[i]` |

Evidence: `packages/router/src/decorators/middlewares/index.ts:9-130`; `packages/router/src/decorators/endpoints/index.ts:11-75`; `packages/router/src/decorators/openapi/index.ts:18-78`; `packages/router/src/decorators/openapi/tags.ts:4-26`; `packages/router/src/decorators/docs/index.ts:6-16`; `packages/router/src/decorators/arguments/index.ts:17-24`.

### Сборка маршрутов (`Router.build`)

`new Router(root, docs)` берёт мета-инстанс корневого класса, рекурсивно спускается по бриджам и в конце регистрирует каждый собранный маршрут в документе (`packages/router/src/classes/router.ts:13-18`). Приватный `build` на каждом уровне: копирует унаследованные курсоры, дописывает курсоры классовых `@Before`, **этим составом** уходит в бриджи, затем отдельно строит курсоры классовых `@After` и создаёт по маршруту на каждый эндпоинт и на каждый websocket.

`packages/router/src/classes/router.ts:20-43`

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

Следствия: классовые `@Before` наследуются вниз по бриджам, классовые `@After` — нет; путь нормализуется через `resolve(join(prefix, endpoint.prefix))` (POSIX, `packages/router/src/common/classes.ts:270`); объекты курсоров классового уровня **общие** для всех маршрутов контроллера и его бриджей (см. `KI-ROUTER-03`); `sockets` в OpenAPI не регистрируются (`router.ts:17` перебирает только `routes`).

### Раскладка курсоров и порядок исполнения (`AomRoute.plain`)

Конструктор маршрута получает курсоры классового уровня, проставляет им `endpoint`, добавляет к ним курсор самого эндпоинта и раскладывает всё рекурсивно; затем нумерует курсоры и на каждом вызывает объявленные маркеры (`packages/router/src/common/classes.ts:266-293`).

`packages/router/src/common/classes.ts:295-322`

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

Классовый `@After` стоит **до** эндпоинта: он попадает в `postCursors`, а те приписываются к входному списку `AomRoute` рядом с `preCursors`, тогда как эндпоинт добавляется последним (`router.ts:35`, `classes.ts:276-282`). Порядок подтверждён пробой и тестом наследования: при `@Before`/`@After` на базовом и дочернем контроллерах цепочка выходит `parent-before → child-before → child-after → parent-after → endpoint` (`packages/router/test/router-exec.test.ts:92-99`). При наследовании родительские `@Before` встают перед собственными (`InheritPlacement.PREPEND`, `packages/router/src/decorators/middlewares/index.ts:10-24`), а `@After` — после собственных (`APPEND` по умолчанию).

На этот порядок ссылается `test/docs/request-lifecycle.md`.

### Исполнение запроса (`RxContext.run`)

`AomRoute.apply(values)` создаёт новый `RxContext` (значения запроса + пустая `state`) и прогоняет список курсоров (`packages/router/src/common/classes.ts:324-342`).

`packages/router/src/common/classes.ts:349-378`

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

Курсоры идут строго последовательно (`concatMap`). `takeWhile((result) => result === undefined, true)` обрывает цепочку на первом не-`undefined` результате, и подписчик резолвит его как ответ; если все курсоры вернули `undefined`, промис резолвится в `undefined`; брошенная или **возвращённая** ошибка отправляется в `reject` (`classes.ts:379-391`). `this` внутри метода — сам класс (`Reflect.apply(..., target, args)`), потому что все обработчики статические. Обработчики аргументов вызываются с тем же `this` (`classes.ts:91-95`).

Evidence: `packages/router/test/router-exec.test.ts:102-153` (перехват ответа middleware, `Error` → reject, `throw` → reject).

### Инстансы, `state` и `@OnInstance` (`AomApi.instanceWithHooks`)

`state` — `ClassInstanceMap` (карта «конструктор → экземпляр»), новая на каждый `apply()`, поэтому один инстанс класса на класс на запрос. Перед вызовом метода курсора рантайм проверяет наличие инстанса класса-владельца и создаёт его при необходимости — даже если `@This()` нигде не запрошен (`classes.ts:355-358`).

`packages/router/src/common/classes.ts:175-197`

```ts
  static async instanceWithHooks(target: ClassConstructor, args: ArgumentsHandlerParameters) {
    const { context, cursor } = args;

    const $target = AomApi.instance(target);
    const instanceArgs = await Promise.all($target.element.parameters.apply(args));
    const instance = Reflect.construct(target, instanceArgs);

    // зафиксируем его в переданном контексте
    context.state.set(target, instance);

    // используем механику, аналогичную процедуре run, только в качестве источника
    // курсоров используем список instanceHooks
    const { prefix, endpoint } = cursor;

    // асинхронно запустим все хуки (порядок должен быть не важен)
    await Promise.all(
      $target.element.instanceHooks.map(($) => {
        const nextCursor = new AomCursor($, cursor.$, prefix, endpoint);
        return context.run([nextCursor]);
      }),
    );
    return instance;
  }
```

Аргументы конструктора берутся из тех же `parameters.handlers` (декораторы параметров конструктора регистрируются на мета-инстансе класса, `property === undefined`). Инстанс кладётся в `state` **до** запуска хуков — иначе хук с `@This()` на собственный класс зациклился бы. Хуки идут параллельно (`Promise.all`), их результат игнорируется, ошибка — reject.

`@This(...)` (`packages/router/src/decorators/arguments/index.ts:232-268`) разрешает цель в порядке: `FwdContainer` → `exec()`; `RouteRefContainer` → `exec(cursor.endpoint.$._.target)`; класс — как есть; без аргумента — класс текущего курсора. Затем `state.get(target)` или `instanceWithHooks`. Проверено тестом `router-exec.test.ts:171-206`: конструктор получает `@Query("user")`, `@OnInstance()`-хук вызывается однократно, новый запрос даёт новый инстанс.

### Декораторы аргументов (`Args`)

`Args(handler)` кладёт обработчик по индексу параметра в фазе LAST; обработчик получает `{context, cursor, route}` и может быть асинхронным — все обработчики метода разрешаются через `Promise.all`.

| Декоратор | Что получает | Формы аргумента |
|---|---|---|
| `@Args(h)` | результат `h({context, cursor, route})` | функция; по умолчанию — тождественная (возвращает весь объект) |
| `@Query`, `@Body`, `@Params`, `@Cookies`, `@Headers` | `values.query/body/params/cookies/headers` | строка — значение по ключу; функция — вызывается со всем объектом; `ThisRef` — вызывается с классом курсора, результат применяется как функция; `RouteRef` — то же с классом эндпоинта; без аргумента — весь объект |
| `@Session(name?)`, `@Files(name?)` | `values.session` / `values.files` | строковый ключ либо ничего |
| `@Ctx()`, `@Req()`, `@Res()` | `values.ctx` / `values.req` / `values.res` | нет |
| `@Cursor()`, `@Route()` | текущий `AomCursor` / `AomRoute` | нет |
| `@State(ctor?)` | инстанс из `state` либо весь `state` | конструктор |
| `@This(ctor?)` | инстанс класса (создаётся при отсутствии) | класс, `FwdRef`, `RouteRef`, пусто |
| `@Run()` | функция `(...handlers) => Promise<any>`, строящая новые курсоры с тем же эндпоинтом и прогоняющая их в текущем контексте | нет |
| `@Err(Ctor = Error)` | фабрика `(message, status?, data?) => Error` со `status` из аргумента, инстанса или статики класса | класс-наследник `Error` |

Evidence: `packages/router/src/decorators/arguments/index.ts:27-138` (значения контекста), `:141-183` (`Run`, `Ctx`, `Err`), `:204-268` (`Cursor`, `Route`, `State`, `This`).

### Отложенные ссылки и `DelayRefStack`

Контейнеры `FwdContainer`/`ThisRefContainer`/`RouteRefContainer` хранят функцию и различаются аргументом её вызова: `FwdRef` — без аргумента (обход циклических импортов), `ThisRef` — класс текущего курсора, `RouteRef` — класс эндпоинта маршрута (`packages/router/src/common/references.ts:4-32`, фабрики — `packages/router/src/specials/references.ts:9-19`).

`@DelayRefStack(container)` откладывает целые декораторы: функция контейнера должна вернуть массив декораторов, которые применяются к методу в момент создания курсора — то есть уже в контексте конкретного потомка. Это то, на чём стоят билдеры `@aom-js/api` (базовый класс объявляет middleware, потомок задаёт статическое значение — схему или имя параметра).

`packages/router/src/common/classes.ts:229-250`

```ts
  private realizeDelay() {
    const { $ } = this;

    const { target, property } = $._;
    // отложенный стек реализуется на инстансе однократно; при ошибке признак не взводится
    // и стек не расходуется — проблема привязки воспроизводится на каждой сборке, а не гаснет тихо
    if (!$.delayRealized && $.delayStack.length) {
      for (const handler of $.delayStack) {
        // вызовем отложенные действия
        if (handler instanceof FwdContainer) {
          Reflect.decorate([...handler.exec()], target, property!);
        } else if (handler instanceof ThisRefContainer) {
          Reflect.decorate([...handler.exec(target)], target, property!);
        } else if (handler instanceof RouteRefContainer) {
          Reflect.decorate([...handler.exec(this.endpoint!.$._.target)], target, property!);
        }
      }
      $.delayRealized = true;
      // применим вероятные отложенные вызовы
      $._.apply();
    }
  }
```

Перед реализацией стека конструктор курсора перепривязывает мета-инстанс: `this.$ = AomApi.resolveFor($, origin._.target)` (`classes.ts:216-227`). Это нужно, когда ссылка `Self.Method` зафиксировала статику родителя до того, как отработал `@Controller()` потомка: `resolveFor` возвращает инстанс каррированной копии потомка, если она есть (`packages/core/src/defines/core.ts:508-518`). Ту же перепривязку делают `@Before`, `@After`, `@UseMarker` и `@Next` в контексте класса-декларатора; `@Before/@After/@UseMarker/@Next` дополнительно принимают `FwdContainer` и разворачивают его перед разрешением (`packages/router/src/decorators/middlewares/index.ts:9-39, 83-111`). В генераторе документа `ThisRef`/`RouteRef` в схемах исполняются с теми же контекстами (`packages/router/src/classes/openapi.ts:187-200`).

> ✏️ Не закоммичено: `src/common/classes.ts` и `src/decorators/middlewares/index.ts` на диске отличаются от HEAD — добавлены флаг `delayRealized` и проход `for-of` вместо расходования стека через `shift`, перепривязка курсора переведена на `AomApi.resolveFor`, `Before/After/UseMarker/Next` научились принимать `FwdContainer` и доразрешать ссылку; появился новый тест `test/inherited-static-refs.test.ts` (untracked). Правки опираются на незакоммиченный `AomCore.resolveFor` в `packages/core`, поэтому пакет нельзя коммитить отдельно от ядра. Собранный `dist` (25 августа) уже содержит эти изменения. Полный список незакоммиченных файлов — `main/docs/architecture.md` §«Состояние рабочего дерева».

### Маркеры

`@Marker()` помечает статический метод сигнатуры `(route: AomRoute, cursor: AomCursor) => void`; `@UseMarker(marker)` привязывает его к методу. При создании маршрута для каждого курсора вызываются все маркеры его мета-инстанса, с `this` = класс маркера (`packages/router/src/common/classes.ts:284-292`). Это **build-time** механизм: на запросе маркеры не выполняются, результат живёт в `route.markers` (`Record<string, any>`).

`packages/api/src/controllers/access/access-controller.ts:257-259`

```ts
  // установить типичный доступ с учетом требований к конкретным типам партнерств
  @Marker()
  static setAccessMark(route: AomRoute, cursor: AomCursor): void {
```

Маркер срабатывает столько раз, сколько курсоров с ним в маршруте, и читает `cursor.origin._` — место сцепки, а не место объявления. На этом построена карта доступа: `@aom-js/api` собирает `route.markers[markerName]`, а приложение фильтрует по нему список маршрутов. Механика маркера доступа — `main/packages/api/readme.md`.

### Сборка OpenAPI (`OpenApi.registerPath`)

`Router` вызывает `docs.registerPath(route)` для каждого маршрута. Метод формирует одну операцию: `operationId = ${Класс}_${метод}` эндпоинта, `summary`/`description` — из `@Title`/`@Description` эндпоинта (`packages/router/src/classes/openapi.ts:56-66`), затем проходит **по всем курсорам по порядку** и накапливает:

- **теги** (`openapi.ts:99-112`): правило обновляется только на курсоре, где есть `@UseTag`; `REPLACE` (по умолчанию) заменяет последний тег, `MERGE` добавляет, `IGNORE` пропускает; имя тега — `$.title` класса-тега либо имя класса; итог — одна строка, склеенная `OpenApi.tagsSeparator` (`" > "`). Проба: `@UseTag` на middleware + `@UseTag` + `@MergeNextTags` на эндпоинте дают тег `"Раздел > TagB"`, без `@MergeNextTags` — `"TagB"`;
- **параметры пути** (`openapi.ts:114-124`): ключ структуры `@PathParameters` — литеральный сегмент пути, он заменяется на `{name}`, параметр добавляется как `in: "path", required: true`;
- **прочие параметры** (`:126-132`), **ответы** (`:134-146`, статус — ключ, поэтому последний курсор с тем же статусом выигрывает; `isArray` оборачивает схему в `{type: "array", items}`), **security** (`:148-154`), **requestBody** (`:156-162`, последний выигрывает).

Схемы проходят через `schemaExtract`: `ThisRef`/`RouteRef` исполняются, результат отдаётся `SchemasCollector.extract` из `@aom-js/schemer`, который превращает компонент-класс в `{$ref}` и складывает рендер в `components` (`openapi.ts:187-200`; подробности сборщика — `main/packages/schemer/readme.md`).

`toJSON()` собирает документ из `initData`, накопленных `securitySchemes` (ключ — имя класса курсора, `openapi.ts:179-185`), `schemas`, `tags` и `paths`, прогоняя результат через `JSON.parse(JSON.stringify(...))` (`openapi.ts:203-232`).

### Ошибки определения

Ошибки сборки — синхронный `throw new Error(КОД)` в момент декорирования; текста нет, `message` равен коду (`packages/router/src/constants/errors.ts:1-14`). Коды не экспортируются из пакета.

| Код | Когда бросается | Evidence |
|---|---|---|
| `MIDDLEWARE_DEFINE_ERROR` | `@Middleware()` на методе, уже помеченном nextpoint/endpoint/websocket/instance | `middlewares/index.ts:44-56` |
| `ENDPOINT_DEFINE_ERROR` | эндпоинт-декоратор на методе с `isMiddleware`/`isWebsocket` | `endpoints/index.ts:66-74` |
| `NEXPOINT_DEFINE_ERROR` | `@Nextpoint()` на middleware; `@WebSocketPoint()` на middleware/nextpoint | `endpoints/index.ts:32-39, 45-53` |
| `ON_INSTANCE_DEFINE_ERROR` | `@OnInstance()` на nextpoint/endpoint/websocket/middleware | `middlewares/index.ts:116-129` |
| `COMMON_ENDPOINT_ERROR` | классовая форма `@Get(path, handler)`, где `handler` не `@Nextpoint()` | `endpoints/index.ts:20-27` |
| `USE_NEXT_DEFINE_ERROR` | `@Next(h)`, где `h` не `@Nextpoint()` | `middlewares/index.ts:99-111` |
| `USE_MARKER_DEFINE_ERROR` | `@UseMarker(h)`, где `h` не `@Marker()` | `middlewares/index.ts:83-96` |
| `CONSTRUCTOR_TYPE_ERROR` | `@This(x)`, где `x` не функция, не `FwdRef` и не `RouteRef` (в том числе `ThisRef`) | `arguments/index.ts:235-244` |
| `ERROR_CONSTRUCTOR_ERROR` | `@Err(C)`, где `C` не `Error` и не его наследник | `arguments/index.ts:171-173` |
| `PARAMETER_HANDLER_ERROR` | `Args(h)`, где `h` не функция | `arguments/index.ts:20` |
| `WEBSOCKET_DEFINE_ERROR`, `CONSTRUCTOR_PROPERTY_TYPE_ERROR` | не используются нигде | `constants/errors.ts:4, 9` |

Ошибки времени запроса возвращаются как `reject` промиса `route.apply(...)`; преобразование их в HTTP-ответ — задача `Server` из `@aom-js/api`.

## Инварианты и подводные камни

- `@Controller()` — верхний декоратор каждого класса, у которого есть декораторы роутера; наследник контроллера тоже `@Controller()`.
- Контроллер — класс со статическими методами; `this` внутри обработчика равен классу, per-request данные живут только в инстансах из `state`.
- В `@Before`/`@After` попадают только методы с `@Middleware()`; эндпоинт или nextpoint туда не поставить.
- Middleware продолжает цепочку, только вернув `undefined`. Любое другое значение — ответ.
- Ключ реестра для статического метода — сама функция дескриптора (`packages/core/src/defines/core.ts:411-418`), поэтому после наследования у потомка другой ключ и нужна перепривязка `resolveFor`.
- Классовые `@Before` проталкиваются в бриджи, классовые `@After` — нет.
- Тег операции задаёт `@UseTag` на курсоре (middleware или эндпоинте). На самом классе `@UseTag` смысла не имеет: класс не является курсором маршрута (проба).
- Декоратора `Summary` не существует: `summary` операции задаёт `@Title`.

### Известные дефекты

Полный реестр с последствиями для приложения — `test/docs/known-issues.md`.

> ⚠️ Дефект: два `@This(X)` в одном методе создают два инстанса `X` и дважды прогоняют `@OnInstance`.
> Evidence: `packages/router/src/decorators/arguments/index.ts:261-264` (async check-then-create без дедупликации), `packages/router/src/common/classes.ts:359-361` (`Promise.all` по обработчикам); тест `packages/router/test/router-exec.test.ts:208-228` (`it.fails`).
> Последствия: разъехавшиеся per-request данные, двойной хук.
> Как обходить: запрашивать `@This(X)` один раз, второй параметр брать из первого. См. `KI-ROUTER-01` в `test/docs/known-issues.md`.

> ⚠️ Дефект: классовый `@After` исполняется **до** эндпоинта, а не после него.
> Evidence: `packages/router/src/classes/router.ts:31-36` (постмиддлвари кладутся во входной список маршрута), `packages/router/src/common/classes.ts:276-282`; проба и `packages/router/test/router-exec.test.ts:92-99`.
> Последствия: «завершающий» шаг, объявленный на классе, видит состояние до обработчика.
> Как обходить: ставить `@After` на методе-эндпоинте. См. `KI-ROUTER-02`.

> ⚠️ Дефект: курсоры классовых middleware — общие объекты для всех маршрутов контроллера и его бриджей, и `AomRoute` их мутирует.
> Evidence: `packages/router/src/common/classes.ts:277-280` (`cursor.endpoint = endpoint`), `:291` (`cursor.index = index`); проба: у курсора маршрута `/a` поле `endpoint` указывает на эндпоинт `/b`, собранный позже.
> Последствия: `RouteRef` внутри такого middleware разрешается в эндпоинт последнего собранного маршрута; `RouteRef` в `@DelayRefStack` на классовом middleware падает `TypeError` — курсор в `Router.build` создаётся без `endpoint` (`router.ts:25` → `classes.ts:243`).
> Как обходить: `RouteRef` использовать только на методах эндпоинта и его `@Before`. См. `KI-ROUTER-03`.

> ⚠️ Дефект: `@Before`/`@After` молча отбрасывают всё, что не помечено `@Middleware()`.
> Evidence: `packages/router/src/decorators/middlewares/index.ts:19, 36` (`.filter(($) => $.element.isMiddleware)`); проба: маршрут с `@Before(Plain.notMw)` собирается с единственным курсором-эндпоинтом.
> Последствия: опечатка в ссылке не даёт ошибки — шаг просто исчезает из цепочки.
> Как обходить: проверять состав `route.cursors` при отладке. См. `KI-ROUTER-04`.

> ⚠️ Дефект: без `@Controller()` на классе декораторы аргументов не срабатывают, аргументы приходят `undefined`.
> Evidence: фаза LAST у `Args` (`packages/router/src/decorators/arguments/index.ts:21-23`) разбирается только в `$._.apply()` из `@Controller()` (`decorators/controllers/index.ts:23`); проба: метод с `@Query("q")` в классе без `@Controller()` получает `undefined` при непустом `values.query`.
> Последствия: тихий `undefined` вместо ошибки; касается и классов-целей `@This` с декорированным конструктором.
> Как обходить: `@Controller()` на каждом классе с декораторами. См. `KI-ROUTER-05`.

> ⚠️ Дефект: `@WebSocketPoint()` без аргумента ломает сборку.
> Evidence: `packages/router/src/decorators/endpoints/index.ts:51` (`prefix: path!` без значения по умолчанию, в отличие от `Endpoint(method, path = "/")`); проба: `TypeError: The "paths[1]" property must be of type string`. Там же: `Router.sockets` не регистрируются в OpenAPI (`classes/router.ts:17`), а коды `WEBSOCKET_DEFINE_ERROR` и `CONSTRUCTOR_PROPERTY_TYPE_ERROR` не используются.
> Последствия: websocket-ветка пакета не готова к применению.
> Как обходить: указывать путь явно. См. `KI-ROUTER-06`.

> ⚠️ Дефект: `OpenApi.toJSON()` затирает `components`, `tags` и `paths`, переданные в `initData`.
> Evidence: `packages/router/src/classes/openapi.ts:221-231` (`{...this.data, components: {...}, tags, paths}`); проба: `components.schemas` из `initData` пропадает. Смежное в том же узле: `securitySchemes` ключуются именем класса курсора (`openapi.ts:179-185`) — одноимённые классы делят схему; `@PathParameters` заменяет **первое** вхождение сегмента в пути (`openapi.ts:118`); правила `@MergeNextTags`/`@IgnoreNextTags`/`@ReplaceNextTags` учитываются только там, где на том же элементе есть `@UseTag` (`openapi.ts:100-101`).
> Последствия: предзаданные компоненты и теги документа теряются.
> Как обходить: не класть `components`/`tags`/`paths` в `initData`. См. `KI-ROUTER-07`.

> ⚠️ Дефект: `@OnInstance`-хуки одного класса выполняются параллельно, порядок не определён.
> Evidence: `packages/router/src/common/classes.ts:189-195` (`Promise.all`, комментарий «порядок должен быть не важен»).
> Последствия: хуки, зависящие друг от друга по данным инстанса, работают недетерминированно.
> Как обходить: один хук на класс либо явная последовательность внутри него. См. `KI-ROUTER-08`.

> ⚠️ Дефект: любое не-`undefined` значение из middleware (включая `null`, `false`, `0`, `""`) прерывает цепочку и становится ответом; возвращённый `Error` эквивалентен брошенному.
> Evidence: `packages/router/src/common/classes.ts:369-386`.
> Последствия: `return false` из проверки доступа отдаётся клиенту как тело ответа.
> Как обходить: middleware не возвращает ничего, ошибки бросает. См. `KI-ROUTER-09`.

> ⚠️ Дефект: `delayRealized` взводится один раз на мета-инстанс, поэтому `@DelayRefStack` реализуется в контексте первого встреченного при сборке потомка.
> Evidence: `packages/router/src/common/classes.ts:235-249` (✏️ не закоммичено).
> Последствия: если один и тот же узел-родитель встретится в маршрутах двух разных потомков, второй получит декораторы, вычисленные для первого. Для билдеров `@aom-js/api` это безопасно: `@Controller()` на потомке даёт ему собственную каррированную копию метода и, значит, собственный узел.
> Как обходить: помечать потомков билдеров `@Controller()`. См. `KI-ROUTER-10`.

### Легаси и мёртвый код

> 🧱 Легаси: `Router.routesMap` (карта `метод:путь → маршрут`) и метод `route(method, path)` закомментированы.
> Где: `packages/router/src/classes/router.ts:11, 15, 45-47`. Почему: сопоставление пути с маршрутом делает `RouteMatcher` в `@aom-js/api`. Чем заменено: линейный `Router.routes` + `RouteMatcher`.

> 🧱 Легаси: разбор `delayStack` внутри `OpenApi.registerPath` закомментирован целиком.
> Где: `packages/router/src/classes/openapi.ts:75-95`. Почему: стек реализуется раньше — в конструкторе курсора (`common/classes.ts:229-250`), а версия в `registerPath` расходовала стек через `shift`. Чем заменено: `AomCursor.realizeDelay` с флагом `delayRealized`.

> 🧱 Легаси: `AomHttpOpenApi.delayStack` (закомментированное поле) и тип `AomMarker`.
> Где: `packages/router/src/common/classes.ts:44-47, 73`. Почему: стек переехал на сам `AomApi` (`classes.ts:160-163`), маркеры хранятся списком `AomApi`. Чем заменено: `AomApi.delayStack`, `AomApiElement.markers`.

> 🧱 Легаси: `AomApiElement.parametersHandlers` объявлен, но нигде не читается и не пишется.
> Где: `packages/router/src/common/classes.ts:125`. Почему: обработчики живут в `parameters.handlers` (`classes.ts:82-96`). Чем заменено: `AomHttpParameters`.

## Как использует приложение

Корень сервера модуля — контроллер без методов, собранный из бриджей; `Router` строится один раз при импорте модуля и передаётся в `Server`:

`test/src/modules/orgs/api/index.ts:7-12`

```ts
@Controller()
@Bridge("/", ModuleRoot)
@Bridge("/api", OrgsRoutes)
class Index {}

export default new Server(settings, new Router(Index, Docs), i18nizer);
```

Ресурс собирается из классового `@Before` (общая подготовка), бриджа на дочерний контроллер по ID-сегменту и эндпоинтов, каждый из которых цепляет свои `@Before` и `@Next`:

`test/src/modules/orgs/api/routes/orgs/index.ts:30-36`

```ts
  @Get("/")
  @Before(Orgs.PrepareBaseQuery)
  @Next(OrgsData.PagerData)
  @Title("Список организаций")
  static async Index() {
    //
  }
```

Здесь же — ``@Bridge(`/id-${OrgIDValue}`, Org)`` (`test/src/modules/orgs/api/routes/orgs/index.ts:15`): шаблонная строка разворачивается в сегмент `:orgId(...)` через `toString()` ID-параметра из `@aom-js/api`. Отложенные ссылки приложение применяет по образцу билдеров: `ThisRef` + `@DelayRefStack` в `test/src/common/controllers/entity.ts:32-38, 187, 194` (подстановка `Responses` со схемой конкретного потомка) и в `test/src/common/controllers/protected.ts:9-20` (подстановка `@Next` на `Index` конкретного корневого контроллера модуля).

Единственное место, где приложение пишет в структуры роутера, — фильтрация карты маршрутов по маркерам доступа: `router.routes = router.routes.filter(...)` в `test/src/common/controllers/protected.ts:27`. Мутируется общий объект `Router`, разделяемый всеми запросами процесса (`KI-COMMON-04` в `test/docs/known-issues.md`).

Правила применения роутера на стороне приложения — `test/docs/principles.md` §«Композиция через декораторы», §«DI через @This и жизненный цикл инстансов»; трассировки конкретных запросов — `test/docs/request-lifecycle.md`.

## Сборка и потребление

Сборка: `bun run build:router` в корне ядра (то же, что `bun --filter @aom-js/router build`). Скрипт чистит `dist/`, запускает `tsc` трижды — `tsconfig.build.json` (CommonJS → `dist/cjs`), `tsconfig.build.mjs.json` (ESM → `dist/mjs`), `tsconfig.build.types.json` (только декларации → `dist/types`) — и завершается `node ../../scripts/post-build.js`, который дописывает расширения относительным импортам и кладёт `dist/cjs/package.json`. Сам `package.json` пакета генерируется `main/scripts/prebuild.js`: скрипт мержит `package.version.json` + `package.src.json` пакета с общим `scripts/jsons/package.dist.json` (`scripts/files.js:3`, `scripts/prebuild.js:19-27`), поэтому `main: "./src/index.ts"` из `package.src.json` в итоговом манифесте перекрывается `main: "./dist/cjs/index.js"` из dist-манифеста. Править нужно `package.src.json` и `scripts/jsons`, а не сгенерированный `package.json`.

Приложение подключает пакет симлинком `test/node_modules/@aom-js/router → main/packages/router` и импортирует **собранный** `dist`, поэтому правки `src` не видны приложению без `bun run build`. Тесты ядра, наоборот, идут по `src` через алиасы `main/vitest.config.ts:19-27`. На диске `dist` собран 25 августа и уже содержит незакоммиченные правки (см. блок `✏️` выше), `src/common/classes.ts` датирован 15 августа — пересборка не требуется. Полная схема сборки монорепо и dist-потребления — `main/docs/architecture.md`.

## Тесты

### Что покрыто

| Файл | Что проверяет |
|---|---|
| `test/router-build.test.ts` | Эндпоинты класса → маршруты с методом и путём; `@Bridge` в два уровня вложенности; наследник контроллера получает маршруты родителя; конфликты ролей метода (`MIDDLEWARE_DEFINE_ERROR`, `ENDPOINT_DEFINE_ERROR`) |
| `test/router-exec.test.ts` | Порядок middleware и эндпоинта; `PREPEND`-наследование `@Before`/`@After`; перехват ответа middleware; возвращённый `Error` и `throw` → reject; `@Body`/`@Query`; `@This` + конструктор-аргументы + `@OnInstance`; новый инстанс на новый запрос |
| `test/openapi.test.ts` | `operationId`/`summary`/`description`; `@Responses` с компонент-схемой → `$ref` и массивная обёртка; компонент попадает в `components.schemas` один раз; `@RequestBody`; `@PathParameters` заменяет сегмент на `{name}`; `@Security` |
| `test/integration.test.ts` | Контроллер + `@ComponentSchema` + class-validator + OpenAPI из одних метаданных: валидное тело трансформируется, невалидное даёт reject со статусом 400, та же схема отражена в документе |
| `test/inherited-static-refs.test.ts` (untracked) | Паттерн билдеров: `@Before(Self.Inherited)` резолвится в инстанс потомка; курсор реализует `delayStack` в контексте потомка; страховочная перепривязка `AomCursor`; `FwdRef`; `@UseMarker(Self.Inherited)`; `realizeDelay` не расходует стек при ошибке |

### Expected-fail

`test/router-exec.test.ts:211` — `it.fails("два @This одного класса в одном методе дают один инстанс (дефект: гонка Promise.all)")` с комментарием `// FINDING` (`:208-210`). Тест фиксирует `KI-ROUTER-01` без исправления. Политика характеризационных тестов — `test/docs/testing.md`.

### Пробелы

Не покрыты тестами: `@Marker`/`@UseMarker` и содержимое `route.markers`; цепочки `@Next`/`@Nextpoint`; классовая форма `@Get(path, handler)`; `@Run()`, `@State()`, `@Cursor()`, `@Route()`, `@Headers`, `@Cookies`, `@Params`, `@Session`, `@Files`; `@WebSocketPoint`/`Router.sockets`; правила тегов и `tagsSeparator`; `@QueryParameters`/`@CookieParameters`/`@Parameters`; `ThisRef`/`RouteRef` в схемах документа; общие курсоры между маршрутами; классовый `@After` до эндпоинта (зафиксирован лишь косвенно в тесте наследования); `@Bridge` на методе; потомок контроллера без `@Controller()`.

### Как запускать

```bash
cd main && bun run test          # весь монорепо
cd main && bunx vitest run packages/router
```

Текущий результат по пакету: 5 файлов, 27 passed, 1 expected fail.

## Расхождения с историческими заметками

| Заметка | Утверждение | Фактически | Evidence |
|---|---|---|---|
| `packages/router/readme.md` (прежний) | «Basic routes builder» — одна строка | Пакет отвечает и за сборку, и за исполнение, и за OpenAPI | этот документ |
| `packages/router/src/readme.md` | Интеграция через `$aom.eachRoute(({method, path, middlewares}) => ...)`, функции `in`/`out`, `next` в контексте | `eachRoute` и `middlewares` отсутствуют; есть `Router.routes[]` и `AomRoute.apply(HttpContextValues)` без поля `next`; интеграцию делает `Server` из `@aom-js/api` | `packages/router/src/classes/router.ts:6-18`; `packages/router/src/types/index.ts:5-16` |
| `packages/router/src/readme.md` | Классы `AomHttp`/`AomAPI`, декоратор `@UseNext` | Класс называется `AomApi`, сборщик — `Router`, декоратор — `Next` | `packages/router/src/common/classes.ts:155`; `packages/router/src/decorators/middlewares/index.ts:99` |
| `main/docs/lazy-evaluations.md` | Отложенные декораторы запускаются через `setTimer`/DELAY после всех наследований; middleware через `@Use(...)`; `relationMap`/`AomRouteMap` | Роутер фазу DELAY не использует: `@Before`/`@After` — LAST и разбираются синхронно в `@Controller()`; отложенные ссылки реализуются в конструкторе курсора; декоратор называется `Before`; `AomRouteMap`/`relationMap` отсутствуют | `packages/router/src/decorators/middlewares/index.ts:9-25`; `packages/router/src/common/classes.ts:216-250` |
| `main/docs/lazy-evaluations.md` | В сборке эндпоинты обрабатываются до бриджей, есть `routesMap.set` | `Router.build` сначала рекурсивно обходит бриджи, затем эндпоинты; `routesMap` нет | `packages/router/src/classes/router.ts:27-42` |
| `main/docs/on-instance-hook.md` | `@OnInstance`-хуки формируются «в нужном порядке» стандартной процедурой `context.run` | Хуки запускаются параллельно (`Promise.all`, каждый — отдельный `context.run([cursor])`), порядок не гарантирован | `packages/router/src/common/classes.ts:189-195` |
| `main/docs/correct-extends.md` | Родительские декораторы всегда попадают в конец списка потомка | Появился `InheritPlacement.PREPEND`: классовый `@Before` родителя переносится в начало; `@After` — по-прежнему в конец | `packages/router/src/decorators/middlewares/index.ts:10-24`; `packages/router/test/router-exec.test.ts:92-99` |
| `main/docs/openapi.md` | Схема собирается «на базе рутового контроллера» (текст обрывается) | Собирается по маршрутам: `Router` вызывает `docs.registerPath(route)` для каждого `AomRoute`, теги/параметры/ответы копятся по курсорам | `packages/router/src/classes/router.ts:17`; `packages/router/src/classes/openapi.ts:42-177` |
| `packages/router/src/specials/readme.md` | Используются `RouteRef` и `ThisRef` | Есть также `FwdRef`/`FwdContainer` (без аргумента), принимаемый `@Before`/`@After`/`@UseMarker`/`@Next`/`@This`/`@DelayRefStack` | `packages/router/src/specials/references.ts:9-19`; `packages/router/src/decorators/middlewares/index.ts:9, 30, 83, 99` |
| `packages/router/src/decorators/openapi/readme.md` | «Поддерживает ту же идею, что и предыдущая вариация» | Содержательной документации нет; описание декораторов — в этом документе | файл из 3 строк |
| Черновики и обсуждения | Существует декоратор `Summary` | Декоратора `Summary` нет ни в роутере, ни в `@aom-js/api`; `summary` операции задаёт `@Title` | `packages/router/src/classes/openapi.ts:61`; `grep -r Summary packages/*/src` — пусто |

## Открытые вопросы

> ❓ Открытый вопрос: намеренно ли классовый `@After` выполняется до эндпоинта (фактически это «после всех `@Before`»), или ожидалась семантика «после эндпоинта»?

> ❓ Открытый вопрос: должны ли курсоры классовых middleware быть уникальными на маршрут — сейчас они разделяются между маршрутами и мутируются (`endpoint`, `index`)?

> ❓ Открытый вопрос: нужна ли дедупликация в `@This` (например, in-flight промис в `state`) для устранения гонки `KI-ROUTER-01`?

> ❓ Открытый вопрос: каким должен быть путь у `@WebSocketPoint()` без аргумента — `"/"`, как у `Endpoint`?

> ❓ Открытый вопрос: ожидается ли, что `@MergeNextTags` без `@UseTag` на том же элементе игнорируется, или правило должно действовать на последующие курсоры независимо?

> ❓ Открытый вопрос: планируется ли задействовать объявленные, но неиспользуемые коды `WEBSOCKET_DEFINE_ERROR` и `CONSTRUCTOR_PROPERTY_TYPE_ERROR`?

> ❓ Открытый вопрос: зачем в `package.src.json` держать `main: "./src/index.ts"`, если `prebuild` всегда перекрывает это поле значением из `scripts/jsons/package.dist.json`?
