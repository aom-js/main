# `@aom-js/api`

Пакет «батареек» над `@aom-js/router`: HTTP-сервер на `node:http`, билдеры контроллеров из компонент-схем, базовые контроллеры (корень модуля, доступ, авторизация, ID-параметры, логгер), классы ответов и ошибок, локализатор. Документ фиксирует состояние кода на 2026-09-02 и является единым источником истины по `Server`, `RouteMatcher`, `I18nizer`, билдерам, `BaseRootController`, `BaseAccessController`, auth-middleware, `IDController`, `Logger` и ответам.
Читать до: `packages/router/readme.md` (курсоры, маршруты, `OpenApi`), `packages/schemer/readme.md` (`PropertySchema`, `Schemer.validate`). Читать после: `test/docs/principles.md` §«Доступ» и §«Ответы, ошибки, сообщения и локали» — как приложение параметризует эти механизмы. Реестр дефектов — `test/docs/known-issues.md`. Термины — `test/docs/README.md#словарь`.

## Назначение и место в стеке

Роутер (`@aom-js/router`) умеет разложить дерево контроллеров в список маршрутов и исполнить маршрут над объектом значений запроса, но не знает ни про сокеты, ни про HTTP-статусы, ни про валидацию тела. `@aom-js/api` закрывает этот разрыв: `Server` (`packages/api/src/server/http.ts:98-292`) поднимает `node:http`, сопоставляет входящий путь с маршрутом, готовит значения (`body`/`query`/`params`/`cookies`/`headers`), вызывает `route.apply(...)` и превращает возвращённое значение в HTTP-ответ. Всё остальное в пакете — переиспользуемые контроллеры и схемы, которые кладутся в цепочки маршрутов приложения.

Зависимости: `@aom-js/core` (мета-классы для `AomAccessCore`), `@aom-js/schemer` (`@ComponentSchema`, `Schemer.validate`), `@aom-js/router` (декораторы, `Router`, `OpenApi`), плюс `ws`, `dayjs`, `es-toolkit`, `reflect-metadata` (`packages/api/package.json:16-24`). Потребитель у пакета один — приложение `test/` (124 импорта `@aom-js/api` в `test/src`); другие пакеты ядра от `api` не зависят. Полный граф пакетов и схема сборки монорепо — в `main/docs/architecture.md` §«Состав…».

Два каталога исходников намеренно не попадают в публичный экспорт: `src/constants` (коды сообщений и словари) не реэкспортируется из `src/index.ts:1-10`, а `src/controllers/events` не реэкспортируется из `src/controllers/index.ts:1-5`. Детали — §«Легаси и мёртвый код».

## Публичный API

Колонка «Используется приложением» проверена по `test/src` (grep по имени символа).

### Сервер и локализация

| Экспорт | Сигнатура | Назначение | Используется приложением |
|---|---|---|---|
| `Server` | `new Server(settings: AomServerSettings, router: Router, i18nizer?: I18nizer)`; `readonly server: http.Server`; `static routesAmount: number` | HTTP-сервер вокруг роутера; `listen()` вызывается в конструкторе | да (`test/src/modules/*/api/index.ts:12`) |
| `I18nizer` | `new I18nizer(defaultLocale?, headerKey?, queryKey?, localesStruct?, init?)`; `defineLocale(headers, query)`, `localize(text, locale)`, `addLocalesStruct(struct)`, `addLocalesMap(locale, map)`, `setDefaultLocale(locale)`, `getDefaultLocale()`, `getLocales()`, `JSONSchema(in?)`; статики `DEFAULT_LOCALE`/`HEADER_KEY`/`QUERY_KEY` | Подстановка текстов вместо кодов сообщений в готовом ответе | да (`test/src/config/aom/i18nizer.ts:1-5`) |
| `I18nizerInitFunction`, `I18nizerInPath` | `(i18n: I18nizer) => void \| Promise<void>`; `'query' \| 'header'` | Типы `I18nizer` | нет |
| `AomServerSettings` | `{ port: number; url: string; name?: string }` | Настройки сервера | да (`test/src/modules/orgs/api/init.ts:14`) |

### Билдеры

| Экспорт | Сигнатура | Назначение | Используется приложением |
|---|---|---|---|
| `BodyBuilder` | `BodyBuilder<T>(schema: T, description?: string)` → класс с `body: InstanceType<T>`, `static Body`, `static JSONSchema(description?)` | Валидация JSON-тела по схеме + `RequestBody` в OpenAPI | да (71 упоминание; `test/src/modules/orgs/api/routes/orgs/init/bodies.ts:6-7`) |
| `QueryStringBuilder` | `QueryStringBuilder<T>(schema: T)` → `query`, `static Query`, `static NotEmpty`, `static JSONSchema()` | Валидация query-string + `QueryParameters` | да (44 упоминания) |
| `HeadersBuilder` | `HeadersBuilder<T>(schema: T)` → `headers`, `static Headers`, `static ImplicitHeaders` | Валидация заголовков; `Headers` дополнительно описывает их в OpenAPI | да (`test/src/common/controllers/current-data/schemas.ts:19`) |
| `CookieBuilder` | `CookieBuilder<T>(schema: T)` → `cookies`, `static Cookie`, `static NotEmpty` | Валидация cookies + `CookieParameters` | нет |
| `ParamsBuilder` | `ParamsBuilder<T>(schema: T)` → `params`, `value`, `static attr/jsonSchema/toString()/JSONSchema()`, `static Params`, `static NotEmpty` | Один path-параметр из компонент-схемы ровно с одним свойством | нет |
| `ResponseBuilder` | `ResponseBuilder<T>(schema: T, status = 200)` → `static JSONSchema(description?, status?)`, `static Response` | Объявление `Responses` для схемы | да (`test/src/modules/references/api/routes/settings/countries/init.ts:26`) |
| `PlainBuildersBase`, `HeaderBuildersBase`, `QueryStringBuildersBase`, `CookieBuildersBase` | `static readonly schema`; `static JSONSchema(path)` | Базы билдеров, **не экспортируются** из `src/index.ts` (`builders/index.ts:1-6` не включает `common`) | нет |

### Базовые контроллеры

| Экспорт | Сигнатура | Назначение | Используется приложением |
|---|---|---|---|
| `BaseRootController` | поля `ident`, `docs: OpenApi`, `RouteElement`; `static RoutesStructure`, `static docsJSON`; `markersToRoute(el, markers)`; `static Index`, `JSONDocs`, `Swagger` | Корень модуля: карта маршрутов, `/openapi.json`, `/swagger.html` | да (`test/src/common/controllers/module/controller.ts:9`) |
| `RouteElement`, `RoutesStructure` | `RouteElement {method, path, operationId}`; `RoutesStructure<RE> {ident, routes: RE[]}` | Схемы ответа `Index` | да (наследуются в `test/src/common/controllers/module/schemas.ts`) |
| `BaseAccessController` | статики `markerName`, `allowedAccessTypes`, `AccessMarker`, `AccessCore`; методы `checkAccessPoint(ident, marker)`, `generateAccessMap(types, roles)`; `static Init`, `Required`, `CheckLayerPass`, `setAccessMark`, `TypesRequired(...)`, `SetExtraAccess(...)`, `ExtraAccess(...)` | Контроль доступа через маркеры маршрутов | да (`test/src/common/controllers/access/controller.ts:9-17`) |
| `AomAccessCore`, `AomAccessMapStructure`, `ActiveAccessTypes`, `IAomAccessPoint`, `AomAccessPlainStructure` | `AomAccessCore extends AomCore {extraAccess, extraAccessMiddlewares, accessTypes}`; `AomAccessMapStructure {fullAccess, structure}` | Мета-класс доступа и структуры карты | частично: только `AomAccessCore` (`test/src/common/controllers/access/schemas.ts:15`); остальные — нет |
| `AomAccessMarkerElement`, `AomAccessToModulesStructure`, `AomAccessModuleElements`, `AomAccessIdentElement` | `AomAccessMarkerElement {accessPoints, accessTypes}`; `AomAccessToModulesStructure {fullAccess, modulesAccess}` | Компонент-схемы маркера и ролей | частично: `AomAccessMarkerElement` (`test/src/common/controllers/access/schemas.ts:6`), `AomAccessModuleElements` (`test/src/modules/orgs/entities/postgres/Roles/Roles.ts:51, 56`); `AomAccessToModulesStructure`/`AomAccessIdentElement` — нет |
| `AuthBasic`, `BasicSecuritySchema` | `static BASIC_AUTH: string`; `static Required` | Basic-авторизация | `AuthBasic` — да (`test/src/config/aom/auth.ts:3`); `BasicSecuritySchema` — нет |
| `AuthHeaderToken`, `HeaderTokenSecuritySchema` | `static TOKEN_NAME = 'Bearer'`, `static HEADERS_KEYS = ['authorization']`; `value`, `type`; `static Required` | Bearer-токен из заголовка | `AuthHeaderToken` — да (`test/src/common/controllers/current-data/current-user.ts:2, 18, 24`); `HeaderTokenSecuritySchema` — нет |
| `AuthCookieToken`, `CookieTokenSecuritySchema` | `static COOKIE_NAME = 'sessionId'`; `value`; `static Required` | Токен из cookie | нет |
| `IDController`, `IDValue`, `UUIDParam`, `MongoIDParam`, `NanoIDParam`, `NumberIDParam` | `IDValue(attr, Schema)` → класс с `static attr/pattern`, `value`, `static PathID/QueryID/HeaderID`, `static toString()/param()/JSONSchema(in)` | Типизированный параметр пути/query/заголовка | да (`UUIDParam` — 26 упоминаний; `test/src/modules/orgs/api/routes/orgs/init/controllers/id.ts:5`) |
| `ParamIDSchema`, `NumberIDSchema`, `MongoIDSchema`, `NanoIDSchema`, `UUIDSchema` | `{regexp; schema(); format(name); value(v)}` | Шаблоны регулярных выражений ID | нет (используются косвенно через `UUIDParam`) |
| `Logger` | `static ENGINE: AomLoggerEngine = console`; `static Init`, `Attach`, `Watch` | Логирование запросов | частично: подменяется только `ENGINE` (`test/src/config/aom/logger.ts:4`) |

### Ответы

| Экспорт | Сигнатура | Назначение | Используется приложением |
|---|---|---|---|
| `ErrorMessage` | `new ErrorMessage(message, status?, data?)`; `static status = 500`, `static description`; `toJSON(): {message,status,data}`; `static JSONSchema(description?)` | База ошибок-ответов | да (`test/src/modules/files/api/routes/files/index.ts:67`) |
| `ServerErrorResponse` | `new (message, data?)`, `status = 500` | 500 | нет |
| `NotFoundResponse` | `status = 404` | 404 | да |
| `ConflictResponse` | `status = 409` | 409 | да |
| `WrongDataResponse` | `status = 400` | 400 | да |
| `LockedResponse` | `status = 423` | 423 | нет |
| `FailedDependencyResponse` | `status = 424` | 424 | нет |
| `AccessDenyResponse` | `status = 403` | 403 | да |
| `PaymentRequiredResponse` | `status = 402` | 402 | нет |
| `AuthRequiredResponse` | `status = 401` | 401 | да |
| `SeeOtherResponse` | `status = 303` | 303 | нет |
| `CommonResponse` | `extends ResponseJSONSchema`; `static status = 200`, `static description` | База успешных ответов | да (15 упоминаний) |
| `MessageResponse` | `new (message?)`; `message?: string` | Ответ-сообщение | да (31 упоминание) |
| `DataResponse` | `new (message?, data?)`; `data?: any` | Сообщение с данными; приложение объявляет собственный `DataResponse` поверх `MessageResponse` | частично (`test/src/common/responses/messages.ts:6`) |
| `NumberResponse`, `BooleanResponse`, `StringResponse` | `new (value?)`; `value` | Скалярные ответы | `NumberResponse`/`BooleanResponse` — да; `StringResponse` — нет |

### Декораторы, функции, схемы, типы

| Экспорт | Сигнатура | Назначение | Используется приложением |
|---|---|---|---|
| `SafeData` | `SafeData(ctor): (data) => values` (бросает `WrongDataResponse`) | Валидация plain-данных через `Schemer` | нет напрямую (только внутри билдеров) |
| `SafeBody`, `SafeQuery` | `SafeBody(ctor) = Body(SafeData(ctor))` | Готовые параметр-декораторы | нет |
| `IsNullable` | `IsNullable(options?): PropertyDecorator` | `ValidateIf(value !== null)` | нет |
| `QueryBoolean` | `QueryBoolean(): PropertyDecorator` | `'true'`/`'false'`/число → boolean + `IsBoolean` | нет |
| `TransformEmpty`, `TransformTrim`, `TransformToArray`, `TransformToDate` | `TransformToDate({startOf?, endOf?, format?})` | class-transformer-преобразования | только `TransformToArray` (9 упоминаний) |
| `plainJsonSchema` | `plainJsonSchema(ctor, in): OpenApiParameterObject[]` | Класс → список параметров OpenAPI | нет |
| `responseJsonSchema` | `responseJsonSchema(ctor, description?, status?): OpenApiResponse` | Класс → описание ответа | да (`test/src/common/controllers/entity.ts:162`) |
| `pathVariants` | `'path' \| 'query' \| 'header' \| 'cookie'` | Тип места параметра | нет |
| `checkLocales` | `checkLocales(hint, source, target): void` | Диагностический вывод разницы ключей словарей | да (`test/src/common/constants/locales/ru/errors.ts:8`) |
| `ResponseJSONSchema`, `PlainJSONSchema`, `QueryJSONSchema`, `HeaderJSONSchema`, `ParamJSONSchema`, `CookieJSONSchema` | `static JSONSchema(...)` | Базовые классы схем с готовым `JSONSchema` | `ResponseJSONSchema` — да, остальные — нет |
| `HttpRequest`, `HttpResponse`, `HttpSocket`, `HttpCtx`, `SocketCtx` | `HttpCtx = {req: IncomingMessage; res: ServerResponse}`; `SocketCtx = {req; res: Stream.Duplex}` | Типы контекста | `HttpCtx` — да, `SocketCtx` — нет |
| `ClassConstructor` | реэкспорт из `@aom-js/core` | Тип конструктора | нет (приложение берёт тип напрямую из `@aom-js/core` — `test/src/modules/tickets/api/routes/tickets/init/aom.ts:1-6`) |

## Внутренние модули

| Файл | Ответственность | Ключевые символы |
|---|---|---|
| `packages/api/src/index.ts` | `import "reflect-metadata"` и реэкспорт `server`/`builders`/`types`/`controllers`/`decorators`/`functions`/`responses`/`schemas`; `constants` не реэкспортируются | — |
| `packages/api/src/server/http.ts` | HTTP-сервер и сопоставление путей; парсинг тела/cookies/query/заголовков; диспетчеризация результата; обработчик `upgrade` | `Server`, `RouteMatcher` (не экспортируется) |
| `packages/api/src/server/i18nizer.ts` | Словари локалей, выбор локали, regexp-подстановка текстов | `I18nizer` |
| `packages/api/src/server/types.ts` | Настройки сервера | `AomServerSettings` |
| `packages/api/src/builders/common.ts` | Базы билдеров с `static schema` и `JSONSchema(path)` | `PlainBuildersBase`, `HeaderBuildersBase`, `QueryStringBuildersBase`, `CookieBuildersBase` |
| `packages/api/src/builders/{body,query-string,headers,cookie,params,response}.ts` | Фабрики контроллеров из компонент-схем | `BodyBuilder`, `QueryStringBuilder`, `HeadersBuilder`, `CookieBuilder`, `ParamsBuilder`, `ResponseBuilder` |
| `packages/api/src/controllers/root.ts` | Корневой контроллер модуля и схемы его ответа | `BaseRootController`, `RouteElement`, `RoutesStructure` |
| `packages/api/src/controllers/swagger.ts` | HTML-строка Swagger UI (default-экспорт) | `swagger` |
| `packages/api/src/controllers/access/access-controller.ts` | Маркеры доступа, `Required`, `TypesRequired`, слои доступа, карта доступа | `BaseAccessController` |
| `packages/api/src/controllers/access/{types,schemas,init}.ts` | Мета-класс `AomAccessCore`, компонент-схемы маркера и ролей, пустой `enum AccessTypes` | `AomAccessCore`, `AomAccessMarkerElement`, `AomAccessToModulesStructure`, `AccessTypes` |
| `packages/api/src/controllers/auth/{basic,headerToken,cookieToken}.ts` | Извлечение учётных данных и security-схемы OpenAPI | `AuthBasic`, `AuthHeaderToken`, `AuthCookieToken` |
| `packages/api/src/controllers/id-value/{controller,schemas}.ts` | Типизированный ID-параметр и шаблоны регулярных выражений | `IDController`, `IDValue`, `UUIDParam`, `UUIDSchema` |
| `packages/api/src/controllers/logger/{logger,types}.ts` | Логирование запроса по событиям `finish`/`error` | `Logger`, `AomLoggerEngine` (тип не экспортируется наружу) |
| `packages/api/src/controllers/events/{websockets,sse}.ts` | WebSocket-контроллер поверх `ws`; `sse.ts` пуст. Каталог не реэкспортируется | `AomWebSockets`, `WebSocketsController`, `Ws` |
| `packages/api/src/responses/{error-message,error-responses,data-responses,types}.ts` | Классы ответов и ошибок со `status`, `toJSON`, `JSONSchema` | `ErrorMessage`, `*Response`, `CommonResponse` |
| `packages/api/src/decorators/{safe-data,is-nullable,query-boolean,transforms}.ts` | Валидация через `Schemer` и обёртки class-validator/class-transformer | `SafeData`, `IsNullable`, `QueryBoolean`, `Transform*` |
| `packages/api/src/functions/{json-schema,check-locales}.ts` | Класс → структуры OpenAPI; диагностика словарей | `plainJsonSchema`, `responseJsonSchema`, `checkLocales` |
| `packages/api/src/schemas/json-schema.ts` | Базовые классы со `static JSONSchema()` | `ResponseJSONSchema`, `PlainJSONSchema` и наследники |
| `packages/api/src/constants/messages/*` | Коды вида `AOM_API:<NAME>` | `PREFIX`, `PREFIX_VALUE` |
| `packages/api/src/constants/locales/{ru,en}/errors.ts` | Словари для части кодов ошибок | `locales` |
| `packages/api/src/types/{http,common}.ts` | Алиасы `node:http`/`node:stream`, реэкспорт `ClassConstructor` | `HttpCtx`, `SocketCtx` |
| `packages/api/{tsconfig.build*.json,package.json,package.src.json}` | Три прохода `tsc`; `package.json` генерируется корневым `scripts/prebuild.js` из `package.version.json` + `package.src.json` + `scripts/jsons/package.dist.json` (`scripts/files.js:3`, `scripts/prebuild.js:19-27`) | — |
| тесты | отсутствуют (каталога `test/` в пакете нет) | — |

## Ключевые механизмы

### Конвейер HTTP-запроса (Server)

Конструктор регистрирует в `RouteMatcher` все `router.routes` (наращивая статический счётчик `Server.routesAmount`) и все `router.sockets`, вливает встроенные словари пакета в переданный локализатор и сразу вызывает `listen(settings.port)` (`server/http.ts:110-124, 230-231`).

На каждый запрос обработчик выставляет три фиксированных CORS-заголовка и отвечает `204` на `OPTIONS` (`http.ts:126-135`). Затем строится URL как `new URL(path.join(settings.url, req.url))`, ищется маршрут, собираются `query` (повтор ключа → массив, `http.ts:247-258`) и `headers` (только определённые значения, `http.ts:237-245`), определяется локаль (`http.ts:137-147`). Отсутствие совпадения — `404` c телом `NotFoundResponse(PATH_NOT_FOUND)` (`http.ts:157-161`). Иначе вызывается `route.apply` с полным набором значений, включая всегда пустые `session` и `files` (`http.ts:163-175`).

`packages/api/src/server/http.ts:177-191`

```ts
if (typeof result === "string") {
  res.writeHead(200, { "Content-Type": "text/html" });
  res.end(localize(result));
} else if (result instanceof Stream) {
  result.pipe(res);
} else {
  let status = 200;
  if (result instanceof ErrorMessage) {
    status = result.status;
  } else if (result instanceof Error) {
    status = 500;
  }
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(localize(JSON.stringify(result)));
}
```

Статус `ErrorMessage` отдаётся и при `return`, и при `throw`: ветка `catch` берёт `err.status || 500` и сериализует ошибку (`http.ts:192-196`). Запросы `upgrade` матчатся по псевдо-методу `sockets` и при отсутствии маршрута закрывают сокет (`http.ts:199-228`).

Evidence: `packages/api/src/server/http.ts:105-135`, `137-161`, `163-197`, `199-231`, `237-291`.

### RouteMatcher: путь → RegExp

`RouteMatcher` (не экспортируется) хранит маршруты по методу в нижнем регистре, а regexp и валидаторы — по строке пути. `convertPathToRegex` вырезает сегменты вида `:name(pattern)`, кладёт для каждого валидатор `^pattern$` и подставляет в путь голую группу `(pattern)`; оставшиеся `:name` превращаются в `([^/]+)`, слеши экранируются, результат оборачивается в `^...$` (`http.ts:34-59`). `match` перебирает маршруты метода в порядке регистрации и возвращает первый, чей regexp совпал, попутно раскладывая значения по именам параметров (`http.ts:61-95`).

Evidence: `packages/api/src/server/http.ts:16-33`, `34-59`, `61-95`, `116-123`, `199-201`.

### I18nizer

Словари — `Record<locale, Record<code, text>>`. При каждом `addLocalesMap` перестраивается regexp локали: ключи экранируются, сортируются по убыванию длины и склеиваются через `|` с флагом `g` (`i18nizer.ts:84-101`). `localize` выполняет `text.replace(RE, code => dict[code] ?? code)` — то есть подстановка идёт по **уже сериализованной** строке ответа, а не по объекту (`i18nizer.ts:68-76`). `defineLocale` берёт первое непустое из `[query[queryKey], headers[headerKey.toLowerCase()]]`, при отсутствии такой локали в словаре откатывается на `defaultLocale`, затем на первую локаль структуры (`i18nizer.ts:42-58`).

`packages/api/src/server/i18nizer.ts:21-35`

```ts
  constructor(
    /** Default Locale */
    private defaultLocale: I18nLocale = I18nizer.DEFAULT_LOCALE,

    /** Header Key for locale value */
    private headerKey: string = I18nizer.HEADER_KEY,

    /** Query Key for locale value */
    private queryKey: string = I18nizer.QUERY_KEY,

    /** Locales Map */
    private localesStruct: I18nLocalesStructure = {},

    init?: I18nizerInitFunction
  ) {
```

Значения по умолчанию читаются из статик в момент вызова конструктора — значит статики обязаны быть выставлены **до** `new I18nizer()`. `Server` при создании добавляет собственные словари пакета (`http.ts:112-114`); в них 16 кодов из 33, объявленных в `constants/messages/errors.ts` (`constants/locales/ru/errors.ts:4-21`).

Evidence: `packages/api/src/server/i18nizer.ts:13-40`, `42-58`, `68-101`, `107-115`; `packages/api/src/server/http.ts:112-114`, `149-155`.

### Билдеры: схема → контроллер

`XBuilder(schema)` возвращает анонимный класс-наследник базового `XBuilderConstructor` со `static schema = schema` (`builders/body.ts:39-45`, `query-string.ts:48-53`, `headers.ts:43-49`, `cookie.ts:46-52`, `response.ts:32-40`). База помечена `@Controller()` и содержит статические middleware, аргументы которых декорированы `@Body/@Query/@Headers/@Cookies/@Params(SafeOrigin)`, где `SafeOrigin = ThisRef(({schema}) => SafeData(schema))` — схема достаётся у реального потомка в момент создания курсора. Описание для OpenAPI навешивается через `@DelayRefStack(SafeOriginParameters)` тем же приёмом.

`packages/api/src/builders/body.ts:9-10, 31-36`

```ts
const SafeOrigin = ThisRef((<T extends typeof BodyBuilderConstructor>({ schema }: T) =>
  SafeData(schema)) as RefFunction);
...
  @Middleware()
  @DelayRefStack(SafeOriginRequestBody)
  @Responses(WrongDataResponse.JSONSchema())
  static async Body(@Body(SafeOrigin) body: any, @This() self: BodyBuilderConstructor<any>) {
    self.body = body;
  }
```

`SafeData` прогоняет данные через `schemer.validate(constructor, data)` и при ошибках бросает `WrongDataResponse(ERROR_WRONG_DATA, errors)` — 400 (`decorators/safe-data.ts:18-29`). Особенности отдельных билдеров: `HeadersBuilder.Headers` — пустая middleware, которая только регистрирует параметры в OpenAPI и через `@Before` подключает `ImplicitHeaders`, где и происходит валидация (`headers.ts:27-40`); `QueryStringBuilder`, `CookieBuilder` и `ParamsBuilder` дополнительно дают `NotEmpty`, бросающую `WrongDataResponse(REQUIRED_DATA_MISSING)` на пустом наборе; `ParamsBuilder` требует компонент-схему ровно с одним свойством и даёт `static toString()`, пригодный как сегмент пути (`params.ts:34-41, 63-83`); `ResponseBuilder.Response` не делает ничего, кроме регистрации `Responses` (`response.ts:26-29`).

> ✏️ Не закоммичено: `packages/api/src/builders/common.ts` и `packages/api/src/builders/query-string.ts` на диске отличаются от HEAD ядра. В `common.ts:8-15` отладочный `console.log("PlainBuildersBase render", ...)` заменён на `throw new Error('schema is not defined for <name>: …')` при отсутствии `static schema`; в `query-string.ts:33` `return new WrongDataResponse(...)` заменён на `throw` — на наблюдаемое поведение это не влияет: `RxContext.run` и так останавливает цепочку на любом не-`undefined` результате (`packages/router/src/common/classes.ts:379`) и перебрасывает возвращённый `Error` как исключение (`packages/router/src/common/classes.ts:370-372`), а `WrongDataResponse` — наследник `Error`; правка приводит код к единому стилю с `cookie.ts:31` и `params.ts:47`. `dist` собран 25 августа уже с этими правками, то есть приложение исполняет новое поведение. Полный список незакоммиченных файлов ядра — `main/docs/architecture.md` §«Состояние рабочего дерева».

Evidence: `packages/api/src/builders/common.ts:5-34`, `body.ts:9-45`, `query-string.ts:13-53`, `headers.ts:12-49`, `cookie.ts:13-52`, `params.ts:15-83`, `response.ts:8-40`, `decorators/safe-data.ts:10-29`.

### BaseRootController

`Index` — эндпоинт `@Get()` и одновременно `@Nextpoint()`: берёт `route.router.routes`, на каждый маршрут создаёт экземпляр `self.RouteElement`, заполняет `method`, `path`, `operationId = route.endpoint.$.toString()`, отдаёт маркеры маршрута в `self.markersToRoute(...)` и складывает всё в `new this.RoutesStructure(ident)` (`root.ts:78-99`). Базовая реализация `markersToRoute` бросает ошибку — наследник обязан её переопределить (`root.ts:68-74`).

`packages/api/src/controllers/root.ts:86-97`

```ts
const { routes } = route.router;
const { ident } = self;
const result = new this.RoutesStructure(ident);
routes.forEach((route) => {
  const { method, path } = route;
  const routeElement = new self.RouteElement();
  routeElement.method = method;
  routeElement.path = path;
  routeElement.operationId = route.endpoint.$.toString();
  self.markersToRoute(routeElement, route.markers);
  result.routes.push(routeElement);
});
```

`JSONDocs` (`GET /openapi.json`) кэширует `docs.toJSON()` в `static docsJSON` того класса, на котором вызван, а `Swagger` (`GET /swagger.html`) возвращает статическую HTML-строку; оба закрыты `@Before(AuthBasic.Required)` (`root.ts:101-128`). Страница Swagger UI грузит скрипты и стили `swagger-ui-dist@5.11.0` с unpkg и обращается к `/openapi.json` по абсолютному пути от корня хоста (`controllers/swagger.ts:10-20`).

Evidence: `packages/api/src/controllers/root.ts:50-76`, `78-99`, `101-128`; `packages/api/src/controllers/swagger.ts:1-33`.

### BaseAccessController

Класс параметризуется четырьмя абстрактными статиками, которые обязан задать наследник: `markerName`, `allowedAccessTypes`, `AccessMarker` (наследник `AomAccessMarkerElement`) и `AccessCore` (наследник `AomAccessCore`) — `access-controller.ts:37-43`. Собственный `enum AccessTypes` в пакете пуст и наружу не экспортируется (`controllers/access/init.ts:1`): типы полномочий поставляет приложение.

**Маркировка при сборке.** `Required` несёт `@DelayRefStack(SafeAccessMarker)`, где `SafeAccessMarker = ThisRef(constructor => [UseMarker(constructor.setAccessMark)])` — маркер берётся у реального наследника (`access-controller.ts:31-33, 236-238`). `setAccessMark` выполняется один раз на создание маршрута: получает или создаёт `route.markers[markerName]`, читает мета-инстанс `AccessCore` в точке прикрепления курсора, **сужает** список допустимых типов пересечением с уже накопленным (пустое пересечение — старые значения сохраняются) и добавляет точку доступа `{ident, title, extra, method, path}`, если такого `ident` в маркере ещё нет (`access-controller.ts:258-336`).

`packages/api/src/controllers/access/access-controller.ts:285-293`

```ts
const newAccessTypes = currentAccessControl.accessTypes.length
  ? _.intersection(<string[]>currentAccessControl.accessTypes, <string[]>extraAccessTypes)
  : extraAccessTypes;

currentAccessControl.accessTypes = newAccessTypes.length
  ? newAccessTypes
  : currentAccessControl.accessTypes;
```

**Проверка в рантайме.** `Required` вычисляет `ident` (для эндпоинта — сам эндпоинт, иначе `cursor.origin`) и вызывает `checkAccessPoint`; при отрицательном результате бросает `AccessDenyResponse(ERROR_ACCESS_DENY)` (`access-controller.ts:239-255`).

`packages/api/src/controllers/access/access-controller.ts:56, 60, 64-73`

```ts
    const { accessMap, activeAccessTypes } = this;
...
    let isAllowed = !this.enabled;
...
    const { accessTypes } = accessMarker;
    _.each(accessTypes, (accessType) => {
      const typeIsActive = activeAccessTypes[<string>accessType];
      // откроем доступ, если для текущего типа доступа был разрешен полный доступ, или нужная точка есть в структуре
      if (typeIsActive) {
        isAllowed = isAllowed || accessMap.fullAccess || !!accessMap.structure[ident];
      }
    });

    return isAllowed;
```

**Карта доступа.** `generateAccessMap(allowedAccessTypes, userRoles)` отмечает переданные типы в `activeAccessTypes`, создаёт `AomAccessMapStructure` и сливает в `structure` элементы тех ролей, чей `moduleIdent` совпадает с `this.moduleIdent`, ключуя их по `ident`; `fullAccess` — дизъюнкция по ролям (`access-controller.ts:76-106`).

**Включение.** Единственное место, где `enabled` становится `true`, — middleware `Init` (`access-controller.ts:108-111`). Пока `Init` не отработал, `enabled === undefined` и `checkAccessPoint` возвращает `true` на первой же строке.

**Декларации на маршрутах.** `TypesRequired(...types)` — комбинированный декоратор: проверяет непустоту списка и вхождение в `allowedAccessTypes`, дописывает типы в мета-инстанс `AccessCore` и навешивает `@Before(this.Required)` (`access-controller.ts:113-128`). `SetExtraAccess(...types)` помечает middleware как слой доступа (`extraAccess = true`) и добавляет ей `@Before(CheckLayerPass)`; `ExtraAccess(...middlewares)` проверяет, что каждая переданная middleware — слой, и подключает их через `@Before` (`access-controller.ts:138-150, 210-234`). `CheckLayerPass` в рантайме ищет в `route.cursors` ближайший курсор своего слоя после текущего и выставляет `self.layerPassed` по наличию `extra`-идентификатора в `accessMap.structure[originIdent].extra` (`access-controller.ts:155-207`).

Как приложение строит карту доступа из ролей организации — `test/docs/principles.md` §«Доступ».

Evidence: `packages/api/src/controllers/access/access-controller.ts:31-51`, `54-106`, `108-150`, `155-207`, `210-255`, `258-336`; `controllers/access/types.ts:6-25`; `controllers/access/schemas.ts:26-37, 77-94`; `controllers/access/init.ts:1`.

### Auth-middleware

`AuthBasic.Required` разбирает заголовок `Authorization`, и только если задан `static BASIC_AUTH`, выставляет `WWW-Authenticate: Basic` и сверяет вторую часть заголовка с base64 от `BASIC_AUTH`; иначе middleware не делает ничего (`auth/basic.ts:20-29`). `AuthHeaderToken.Required` перебирает `HEADERS_KEYS` (по умолчанию `['authorization']`), у первого найденного значения заменяет `Bearer_` на `Bearer ` (разрешение прокидывать токен через `sec-websocket-protocol`), разбивает по пробелу в `self.type`/`self.value` и бросает `AUTH_NO_TOKEN` либо `AUTH_WRONG_TOKEN_TYPE` (`auth/headerToken.ts:24-46`). `AuthCookieToken.Required` читает `cookies[COOKIE_NAME]` и бросает `AUTH_NO_COOKIE`; имя cookie попадает в security-схему OpenAPI через `ThisRef` + `DelayRefStack` (`auth/cookieToken.ts:17-41`). Все три бросают `AuthRequiredResponse` (401).

Evidence: `packages/api/src/controllers/auth/basic.ts:13-29`, `headerToken.ts:11-46`, `cookieToken.ts:17-41`.

### Ответы и ошибки

`ErrorMessage extends Error` и одновременно `@ComponentSchema`: `status` берётся из аргумента или из `static status` конструктора, `toJSON()` отдаёт `{message, status, data}`, `static JSONSchema(description)` строит описание ответа через `responseJsonSchema(this, description, this.status)` (`responses/error-message.ts:7-39`). Наследники добавляют только статусы и описания через промежуточный `ErrorWithStatusResponse` с сигнатурой `(message, data?)` (`responses/error-responses.ts:7-83`).

| Класс | status | Описание (`static description`) |
|---|---|---|
| `SeeOtherResponse` | 303 | `SEE_OTHER_RESPONSE` |
| `WrongDataResponse` | 400 | `ERROR_WRONG_DATA` |
| `AuthRequiredResponse` | 401 | `ERROR_AUTH_REQUIRED` |
| `PaymentRequiredResponse` | 402 | `PAYMENT_REQUIRED` |
| `AccessDenyResponse` | 403 | `ERROR_ACCESS_DENY` |
| `NotFoundResponse` | 404 | `ERROR_NOT_FOUND` |
| `ConflictResponse` | 409 | `ERROR_CONFLICT` |
| `LockedResponse` | 423 | `ERROR_WRONG_DATA` |
| `FailedDependencyResponse` | 424 | `ERROR_WRONG_DATA` |
| `ServerErrorResponse` | 500 | `SERVER_ERROR` |
| `ErrorMessage` | 500 | `ERROR_MESSAGE` |

Успешные ответы наследуют `ResponseJSONSchema` → `CommonResponse` (`static status = 200`): `MessageResponse {message?}`, `DataResponse {message?, data?}`, `NumberResponse`/`BooleanResponse`/`StringResponse {value}` (`responses/data-responses.ts:7-79`). `responseJsonSchema` подставляет `status || 200` и трактует массив в `description` как признак `isArray` (`functions/json-schema.ts:32-43`).

Evidence: `packages/api/src/responses/error-message.ts:7-39`, `error-responses.ts:7-83`, `data-responses.ts:7-79`; `packages/api/src/functions/json-schema.ts:32-43`.

### IDController / UUIDParam

`IDValue(attr, Schema)` создаёт наследника `IDController` со `static attr` и `static pattern = new Schema()`; `toString()` возвращает `pattern.format(attr)`, то есть сегмент `:attr(regexp)`, пригодный для интерполяции в `@Bridge`/`@Get` (`id-value/controller.ts:66-68, 87-92`; `id-value/schemas.ts:15-23`). `UUIDParam`/`MongoIDParam`/`NanoIDParam`/`NumberIDParam` — обёртки над соответствующими шаблонами (`controller.ts:94-107`).

`packages/api/src/controllers/id-value/controller.ts:28-31, 61-64`

```ts
  @Middleware()
  @DelayRefStack(PathRefParams)
  @After(IDController.PathValue)
  static async PathID() { }
...
  @Middleware()
  static async Assign(@This() self: IDController) {
    self.value = self.source[this.attr];
  }
```

`PathID`/`QueryID`/`HeaderID` регистрируют описание параметра в OpenAPI и через `@After` вызывают `PathValue`/`QueryValue`/`HeaderValue`, которые копируют источник в `self.source`, а затем `Assign` кладёт `self.value = self.source[attr]`. Никакой дополнительной проверки значения на этом пути нет — валидность обеспечивается regexp самого маршрута.

Evidence: `packages/api/src/controllers/id-value/controller.ts:9-16`, `18-64`, `66-107`; `id-value/schemas.ts:15-23, 60-68`.

### Logger

`Logger.Init` вешает один и тот же обработчик на события `finish` и `error` объекта `res`: фиксирует `finishDate`, `status = res.statusCode`, `lifetime`/`duration` и пишет в `ENGINE.error` либо `ENGINE.info`; попутно кладёт себя в контекст (`Object.assign(ctx, { log: self })`) — `logger/logger.ts:54-84`. `Attach` запоминает класс-владелец курсора как `LoggerAttachments`, чей `toJSON()` вернёт мета-инстанс на момент сериализации лога (`logger.ts:86-94`); `Watch` пишет отладочный фрагмент по текущему курсору (`logger.ts:96-107`). `ENGINE` по умолчанию — `console` (`logger.ts:23`).

Evidence: `packages/api/src/controllers/logger/logger.ts:8-18`, `20-52`, `54-107`.

## Инварианты и подводные камни

- Глобальные статики конфигурируются **до** сборки роутера и до создания зависимых объектов: `I18nizer.DEFAULT_LOCALE`/`HEADER_KEY`/`QUERY_KEY` — до `new I18nizer()`, `AuthBasic.BASIC_AUTH`, `AuthHeaderToken.TOKEN_NAME`/`HEADERS_KEYS`, `AuthCookieToken.COOKIE_NAME`, `Logger.ENGINE` — до первого запроса.
- Класс-потомок билдера обязан быть помечен `@Controller()`, иначе его middleware не привяжутся к нему как к отдельному узлу и `ThisRef` вернёт схему базового класса (`test/src/modules/orgs/api/routes/orgs/init/bodies.ts:6-7`; тест паттерна — `packages/router/test/inherited-static-refs.test.ts:19-43`, файл не закоммичен).
- Абстрактные статики базовых контроллеров объявлены как `static readonly x: T;` без значения; наследник обязан задать их все: для `BaseAccessController` — `markerName`, `allowedAccessTypes`, `AccessMarker`, `AccessCore`; для `BaseRootController` — `ident`, `docs`, `RoutesStructure`, `RouteElement` и переопределённый `markersToRoute` (`packages/api/src/controllers/access/access-controller.ts:37-43`, `packages/api/src/controllers/root.ts:52-60`).
- Валидация всегда проходит через `Schemer.validate`; class-validator-декораторы задаются в компонент-схеме опцией `decorators` — см. `packages/schemer/readme.md`.
- Коды сообщений пакета имеют вид `AOM_API:<NAME>` (`constants/messages/prefix.ts:1-3`); клиенту уходит код, текст подставляет локализатор.
- Тело запроса разбирается только при заголовке `content-type`, **строго равном** `application/json`; `multipart/form-data` не разбирается, `files` и `session` в контексте всегда пусты (`http.ts:260-277`, `173-174`).
- `cookies` парсятся через `split(";")` и `split("=")` — значение, содержащее `=`, обрезается по первому вхождению (`http.ts:279-291`).
- `Server.routesAmount` — статический счётчик, общий для всех экземпляров `Server` в процессе (`http.ts:99, 118`).
- Подстановка локализованных текстов идёт по сериализованной строке ответа целиком, поэтому код вида `AOM_API:...`, попавший в пользовательские данные, тоже будет заменён (`i18nizer.ts:68-76`).
- `es-toolkit` используется как `es-toolkit/compat` (`_.each`, `_.merge`, `_.keyBy`, `_.intersection`) — `access-controller.ts:1`. `class-validator`/`class-transformer` импортируются в `decorators/*`, но в `dependencies` пакета не объявлены (`packages/api/package.json:16-24`) и разрешаются из корня монорепо.

### Известные дефекты

> ⚠️ Дефект: `RouteMatcher.match` не отклоняет маршрут при непрохождении валидатора параметра — `return null` стоит внутри колбэка `forEach` и лишь прерывает итерацию.
> Evidence: `packages/api/src/server/http.ts:77-88` (`return null` в строках 83-85 выходит из колбэка, а не из `match`).
> Последствия: маршрут возвращается всё равно; спасает то, что тот же паттерн уже вшит в общий regexp пути (`http.ts:47-51`), поэтому несоответствующее значение до этой проверки не доходит. Проверка мертва, а не опасна.
> Как обходить: не полагаться на неё; ограничения задавать шаблоном в самом пути (`IDValue`/`UUIDParam`). См. `KI-API-01` в `test/docs/known-issues.md`.

> ⚠️ Дефект: тело запроса читается только при точном `content-type: application/json`; `application/json; charset=utf-8` и `multipart/form-data` дают пустой `body`.
> Evidence: `packages/api/src/server/http.ts:262`, `273-275`.
> Последствия: клиент с charset получает `{}` и падает на валидации; загрузка файлов в пакете не поддерживается — приложение разбирает `multipart` самостоятельно (formidable).
> Как обходить: отправлять `content-type: application/json` без параметров. См. `KI-API-02`.

> ⚠️ Дефект: обычный `Error` уходит клиенту как `{}` со статусом 500; ответ `404` отдаётся без `Content-Type` и без локализации; `Stream`-результат пайпится без статуса и заголовков.
> Evidence: `packages/api/src/server/http.ts:157-161`, `180-181`, `186-196` (`JSON.stringify` над обычным `Error` даёт `"{}"`, так как поля `Error` неперечислимы).
> Последствия: диагностика ошибки теряется, `404` не проходит через `I18nizer`, у потокового ответа нет ни статуса, ни типа контента.
> Как обходить: бросать наследников `ErrorMessage`, а не голый `Error`; для потоков выставлять заголовки в самом обработчике. См. `KI-API-03`.

> ⚠️ Дефект: `checkLocales` сравнивает имена экспортов модуля кодов с ключами словаря (а ключи словаря — это значения тех же экспортов), поэтому множества не пересекаются никогда.
> Evidence: `packages/api/src/functions/check-locales.ts:8-14`; вызов `checkLocales("locales/ru/errors", errors, locales)` в `packages/api/src/constants/locales/ru/errors.ts:24`, где `errors` — namespace с ключами `ERROR_MESSAGE`, а `locales` — карта с ключами `AOM_API:ERROR_MESSAGE`.
> Последствия: при каждом импорте пакета в консоль печатаются все 33 ключа для `ru` и для `en`; в тестовом выводе — шум.
> Как обходить: игнорировать вывод. См. `KI-API-04` и `KI-TEST-03`.

> ⚠️ Дефект: `BodyBuilder.JSONSchema(description)` использует аргумент как флаг, а в OpenAPI кладёт `static description` потомка.
> Evidence: `packages/api/src/builders/body.ts:24-29` — `description: description ? String(this.description) : ""`.
> Последствия: если `static description` не задан, а аргумент передан, в документацию попадает строка `"undefined"`; переданный текст теряется.
> Как обходить: задавать описание вторым аргументом `BodyBuilder(schema, description)`. См. `KI-API-05`.

> ⚠️ Дефект: код `API_ERROR_423_DATA_LOCKED` содержит значение `AOM_API:API_ERROR_432_DATA_LOCKED`; `LockedResponse` и `FailedDependencyResponse` используют чужое описание `ERROR_WRONG_DATA`.
> Evidence: `packages/api/src/constants/messages/errors.ts:34`; `packages/api/src/responses/error-responses.ts:43-55`.
> Последствия: код с опечаткой невозможно найти в словарях; описания 423/424 в OpenAPI не соответствуют смыслу.
> Как обходить: не полагаться на эти два класса — приложением они не используются. См. `KI-API-06`.

> ⚠️ Дефект: CORS захардкожен, `Access-Control-Allow-Headers` перечисляет только `Content-Type` и `Authorization`.
> Evidence: `packages/api/src/server/http.ts:126-128`.
> Последствия: браузерный preflight не пропустит прикладные заголовки `Data-Org-Id` и `Aom-Locale`; настроить список нельзя без правки пакета.
> Как обходить: терминировать CORS на обратном прокси. См. `KI-API-08`.

> ⚠️ Дефект: набор мелких особенностей эксплуатации, не настраиваемых снаружи: `Logger` считает ошибкой любой статус, отличный от 200 (включая 201/204/304) — `logger/logger.ts:65-70`; `Server.listen` вызывается прямо в конструкторе, что не даёт поднять сервер на свободном порту и отложить старт — `http.ts:231`; `Server.routesAmount` общий на процесс — `http.ts:99, 118`; страница `/swagger.html` тянет ассеты с unpkg и офлайн не работает — `controllers/swagger.ts:10-16`; `AuthBasic.Required` при незаданном `BASIC_AUTH` пропускает всех, то есть `/openapi.json` и `/swagger.html` открыты — `auth/basic.ts:22-27`.
> Последствия: шумные логи, невозможность запустить сервер в тесте на `port: 0`, потенциально открытая документация.
> Как обходить: задавать `BASIC_AUTH` явно (в приложении задан, но захардкожен — `KI-BOOT-04`). См. `KI-API-10`.

> ⚠️ Дефект: контроль доступа выключен, пока не выполнена middleware `Init`.
> Evidence: `packages/api/src/controllers/access/access-controller.ts:60` (`let isAllowed = !this.enabled`) и `108-111` (единственное присваивание `enabled = true`). В приложении `AccessController.Init` не подключён ни к одному маршруту (grep по `test/src` пуст).
> Последствия: все `Required` и `TypesRequired` пропускают любого аутентифицированного пользователя; маркеры доступа при этом собираются корректно и отдаются в `GET /` модуля.
> Как обходить: подключить `AccessController.Init` в цепочку после заполнения карты доступа. См. `KI-COMMON-01` в `test/docs/known-issues.md`.

> ⚠️ Дефект: локализация ответов приложения фактически не работает — `Server` вливает в локализатор только собственные словари пакета, а приложение создаёт `new I18nizer()` без словарей.
> Evidence: `packages/api/src/server/http.ts:112-114`; `test/src/modules/orgs/api/init.ts:26`.
> Последствия: клиент получает коды сообщений приложения как есть; из кодов ядра переводятся 16 из 33.
> Как обходить: передавать словари приложения через `addLocalesStruct` до старта сервера. См. `KI-COMMON-02`.

> ⚠️ Дефект: `CheckLayerPass` деструктурирует результаты `filter` без проверки на пустоту.
> Evidence: `packages/api/src/controllers/access/access-controller.ts:188-193` — `const [{ extra = [] }] = ...filter(...)` и `const [{ accessTypes }] = extra.filter(...)`.
> Последствия: если точка доступа или слой не найдены в маркере маршрута, будет `TypeError` вместо осмысленного отказа.
> Как обходить: механизм слоёв (`SetExtraAccess`/`ExtraAccess`) приложением не используется. Отдельного ID нет — см. «Дефекты без ID» ниже.

### Дефекты без ID

> ⚠️ Дефект: `OPTIONS`-запрос обрабатывается сервером до сопоставления маршрута, поэтому эндпоинты, объявленные декоратором `@Options()` роутера, недостижимы.
> Evidence: `packages/api/src/server/http.ts:131-135` (ответ 204 и `return` до `routeMatcher.match`); декоратор существует — `packages/router/src/decorators/endpoints/index.ts:149-158`.
> Последствия: маршрут собирается, попадает в OpenAPI и в карту маршрутов модуля, но никогда не исполняется.
> Как обходить: не использовать `@Options()`; preflight обслуживает сам сервер.

### Легаси и мёртвый код

> 🧱 Легаси: каталог `packages/api/src/controllers/events` (`websockets.ts` с `AomWebSockets`, `WebSocketsController`, `Ws`; пустой `sse.ts`) не реэкспортируется из `packages/api/src/controllers/index.ts:1-5` и потому недоступен потребителям пакета, хотя `Server` обработчик `upgrade` реализует (`http.ts:199-228`). Внутри `websockets.ts:157-187` закомментированы middleware `Init`, `AuthorizedInit`, `Param`. Заменено: приложение сокеты не использует.
> См. `KI-API-09`.

> 🧱 Легаси: `packages/api/src/constants` (коды `AOM_API:*` и словари `ru`/`en`) не экспортируется из `packages/api/src/index.ts:1-10`. Приложение держит собственные наборы кодов и словарей и импортирует из пакета только `checkLocales`. См. `KI-API-09` и `KI-COMMON-02`.

> 🧱 Легаси: `enum AccessTypes` в `packages/api/src/controllers/access/init.ts:1` пуст и не экспортируется; он остаётся лишь как тип-заглушка для `@PropertySchema.Enum` в `access/schemas.ts:52-57, 87-92`. Заменён на `allowedAccessTypes` + `AccessMarker` наследника (в приложении — `PermissionsTypes`).

> 🧱 Легаси: неиспользуемые импорты — `parse` из `node:url` (`server/http.ts:3`), `fs`/`path` (`controllers/root.ts:1-2`), `After` в `access-controller.ts:9` (`Route` из той же группы импортов используется — `access-controller.ts:158, 242`). На рантайм не влияют.

## Как использует приложение

Сервер модуля создаётся одной строкой: корневой класс с двумя бриджами передаётся в `Router`, тот — в `Server` вместе с настройками из env и локализатором (`test/src/modules/orgs/api/index.ts:7-12`). Настройки (`AomServerSettings`), документ `OpenApi` и корневой контроллер объявляются в `api/init.ts` того же модуля; там же `new I18nizer()` (`test/src/modules/orgs/api/init.ts:14-34`).

Базовые контроллеры параметризуются один раз в общем слое: `ModuleRootController extends BaseRootController` задаёт `RoutesStructure`/`RouteElement`, переопределяет `markersToRoute` (переносит маркер доступа в элемент маршрута) и в конструкторе связывает `AccessController.moduleIdent` с `ident` модуля (`test/src/common/controllers/module/controller.ts:9-23`); `AccessController extends BaseAccessController` задаёт четыре абстрактных статики, включая `allowedAccessTypes = Object.values(PermissionsTypes)` (`test/src/common/controllers/access/controller.ts:9-17`). Карта доступа заполняется при разборе текущей организации: `access.generateAccessMap(allowedAccessTypes, roles)` (`test/src/common/controllers/current-data/current-org.ts:177`), а требования ставятся на конкретных эндпоинтах: `@AccessController.TypesRequired(PermissionsTypes.ADMIN)` (`test/src/modules/references/api/routes/cities/index.ts:39`).

Билдеры используются как базы объявляемых в `init/` контроллеров: `@Controller() class SubOrgBody extends BodyBuilder(OrgDataDTO) {}` (`test/src/modules/orgs/api/routes/orgs/init/bodies.ts:6-7`), `@Controller() class OrgIDValue extends UUIDParam("orgId") {}` (`test/src/modules/orgs/api/routes/orgs/init/controllers/id.ts:4-5`). Глобальные статики выставляются в `test/src/config/aom/*.ts`: локаль и ключи (`i18nizer.ts:3-5`), Basic-авторизация и имя токена (`auth.ts:3-4`), `Logger.ENGINE = pino(...)` (`logger.ts:4`).

Правила приложения (где ставить `Required`, как строятся сообщения и локали, как раскладывается `init/`) — `test/docs/principles.md`; трассировки конкретных запросов — `test/docs/request-lifecycle.md`.

## Сборка и потребление

Сборка — `bun run build:api` в корне ядра (или `bun run build` внутри `packages/api`): три прохода `tsc` (`tsconfig.build.json` → `dist/cjs` в CommonJS, `tsconfig.build.mjs.json` → `dist/mjs`, `tsconfig.build.types.json` → `dist/types`) и затем `node ../../scripts/post-build.js`, который дописывает расширения относительным импортам и кладёт `dist/cjs/package.json` с `{"type":"commonjs"}`; неразрешимый импорт останавливает сборку (`packages/api/package.json:55-61`; `main/scripts/post-build.js:38-65, 67-71, 73`). Файл `package.json` пакета генерируется скриптом `scripts/prebuild.js` — править следует `package.src.json`/`scripts/jsons`.

Приложение подключает пакет симлинком `test/node_modules/@aom-js/api → ../../../main/packages/api` и через `exports` читает `dist/types` и `dist/mjs`, а не исходники. Инвариант: **правки `src` не видны приложению без `bun run build`**. На диске `dist` собран 25 августа и уже включает незакоммиченные правки `builders/common.ts` и `builders/query-string.ts`, то есть `dist` согласован с рабочим деревом, а HEAD отстаёт. Полная схема сборки и dist-потребления — `main/docs/architecture.md` §«Сборка, тесты…» и §«Как приложение потребляет ядро».

## Тесты

### Что покрыто

Ничего. В `packages/api` нет каталога `test/` и ни одного `*.test.ts`; скрипт `test` в манифесте пакета — заглушка `echo "Error: no test specified" && exit 1` (`packages/api/package.json:56`).

Пакет не подключён и к vitest монорепо: в `main/vitest.config.ts:18-30` нет алиаса `@aom-js/api`, а `include` ограничен `packages/*/test/**/*.test.ts`. `bun run test` в корне ядра прогоняет 21 файл, 120 успешных тестов и 3 ожидаемых падения — все из `core`/`schemer`/`router`/`holder`/`transfer`/`codegen`. См. `KI-API-11` и `KI-TEST-03`.

### Expected-fail

Собственных `it.fails` у пакета нет. Косвенно на него влияют два findings монорепо: игнорирование `minValue: 0` в `schemer` (приложение задаёт `minValue: 0` в пейджере) и гонка при двух `@This(X)` одного класса в одном методе в `router` — паттерн встречается в фильтрах приложения.

### Пробелы

`Server` (маршрутизация, парсинг тела/query/cookies, статусы, `upgrade`); `RouteMatcher` (валидаторы параметров — известный дефект, порядок маршрутов); `I18nizer` (`defineLocale`, приоритет query над заголовком, `localize`); билдеры (валидация через `SafeData`, `JSONSchema`, `NotEmpty`); `BaseAccessController` (`setAccessMark` и сужение типов, `checkAccessPoint`, `generateAccessMap`, `ExtraAccess`/`CheckLayerPass`); auth-middleware; ответы (`status`/`toJSON`/`JSONSchema`); декораторы `QueryBoolean`, `TransformToArray`, `TransformToDate`, `IsNullable`; `checkLocales`.

### Как запускать

Прогона для этого пакета нет. Чтобы он появился, нужны алиас `"@aom-js/api": resolve(__dirname, "packages/api/src")` в `main/vitest.config.ts` и каталог `packages/api/test`; после этого — `bun run test -- packages/api`. `I18nizer`, ответы и декораторы тестируются как чистые юниты; `RouteMatcher` не экспортирован и проверяется только через `Server`, а `Server` из-за `listen` в конструкторе потребует `port: 0` и чтения `server.address()`; билдеры и доступ требуют сборки роутера — по образцу `packages/router/test/integration.test.ts`.

## Расхождения с историческими заметками

| Заметка | Утверждение | Фактически | Evidence |
|---|---|---|---|
| `main/docs/superpowers/plans/2026-07-20-test-coverage.md:14` | «Имя `@aom-js/api` в будущем получит новый пакет с батарейками — сейчас его НЕ существует, нигде на него не ссылаться» | Пакет существует, собирается (`build:api`) и используется приложением (124 импорта); в тестовую инфраструктуру не включён | `packages/api/package.json:1-3`; `main/package.json:26`; `main/vitest.config.ts:18-30` |
| `main/docs/superpowers/plans/2026-07-20-test-coverage.md:1802` | «Реальные HTTP-адаптеры (koa/express) появятся вместе с новым пакетом `@aom-js/api`» | Адаптер написан на голом `node:http`; koa и express в зависимостях отсутствуют | `packages/api/src/server/http.ts:1, 125`; `packages/api/package.json:16-24` |
| `main/docs/access-controller.md:11-15` | Конкретная реализация использует специфический `AccessTypes` проекта; заполнение карты полномочий должно вызываться внутри `Auth.Init` | Реализовано иначе: `AccessTypes` в пакете — пустой enum и не экспортируется, тип задаёт наследник через `AccessMarker`/`AccessCore`/`allowedAccessTypes`; карту заполняет `generateAccessMap`, которую приложение вызывает из `CurrentOrg`, а не из авторизации | `packages/api/src/controllers/access/init.ts:1`; `test/src/common/controllers/access/controller.ts:12-17`; `test/src/common/controllers/current-data/current-org.ts:177` |
| `main/docs/i18nizer.md` | Файл состоит из одного заголовка «Локализатор» | Механика реализована и работает (`I18nizer` + встроенные словари `ru`/`en` + подстановка в `Server`), но нигде не описана; словари покрывают 16 кодов из 33 | `packages/api/src/server/i18nizer.ts:13-115`; `packages/api/src/constants/locales/ru/errors.ts:4-21` |
| `main/readme.md:93-106` | `responseJsonSchema` возвращает `status: status` — как передан | В коде `status: status || 200`, то есть отсутствующий статус подменяется на 200 | `packages/api/src/functions/json-schema.ts:37-42` |
| `main/docs/e2e-test.md` | Пожелания к e2e-тестированию через разложение роутера на маршруты и переключение контекста | Ничего из этого в пакете нет; тестов нет вообще | `packages/api/package.json:56`; отсутствие каталога `packages/api/test` |
| `packages/api/readme.md` (прежний текст) | «API common components based on `@aom-js/*`» — три строки без содержания | Перезаписан настоящим документом | — |

## Открытые вопросы

> ❓ Открытый вопрос: каталог `controllers/events` заброшен или ждёт доработки? Экспорта наружу нет, `sse.ts` пуст, а часть middleware закомментирована (`packages/api/src/controllers/events/websockets.ts:157-187`) — при том, что `Server` обработчик `upgrade` реализует.

> ❓ Открытый вопрос: планируется ли экспортировать `constants` (коды и словари) из пакета, чтобы приложение не дублировало набор кодов и не оставалось без переводов ядра?

> ❓ Открытый вопрос: должен ли `RouteMatcher` отклонять маршрут при непрохождении валидатора параметра (сейчас проверка мертва), или валидация значения намеренно возложена на regexp пути и `IDController`?

> ❓ Открытый вопрос: комментарий «эта middleware в том числе для изучения гипотезы о баге каскадного наследования» в `packages/api/src/builders/response.ts:26` — гипотеза подтверждена или закрыта?

> ❓ Открытый вопрос: `checkLocales` задумывался как сравнение значений `source` (кодов `AOM_API:*`) с ключами `target`? В текущем виде сравниваются ключи обоих объектов (`functions/check-locales.ts:8-11`), поэтому вывод бесполезен.

> ❓ Открытый вопрос: должен ли `Server` разбирать `multipart/form-data` (сейчас `files` всегда пуст), или загрузка файлов остаётся зоной ответственности приложения?
