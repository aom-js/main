# `@aom-js/api`

Пакет «батареек» над `@aom-js/router`: HTTP-сервер на `node:http`, билдеры контроллеров из компонент-схем, базовые контроллеры (корень модуля, доступ, авторизация, ID-параметры, логгер), классы ответов и ошибок, локализатор. Документ — единый источник истины по `Server`, `RouteMatcher`, `I18nizer`, билдерам, `BaseRootController`, `BaseAccessController`, auth-middleware, `IDController`, `Logger` и ответам.
Читать до: `packages/router/readme.md` (курсоры, маршруты, `OpenApi`), `packages/schemer/readme.md` (`PropertySchema`, `Schemer.validate`). Читать после: `test/docs/principles.md` §«Доступ» и §«Ответы, ошибки, сообщения и локали» — как приложение параметризует эти механизмы. Реестр дефектов — `test/docs/known-issues.md`. Термины — `test/docs/README.md#словарь`.

## Назначение и место в стеке

Роутер (`@aom-js/router`) умеет разложить дерево контроллеров в список маршрутов и исполнить маршрут над объектом значений запроса, но не знает ни про сокеты, ни про HTTP-статусы, ни про валидацию тела. `@aom-js/api` закрывает этот разрыв: `Server` (`packages/api/src/server/http.ts`) поднимает `node:http`, сопоставляет входящий путь с маршрутом, готовит значения (`body`/`query`/`params`/`cookies`/`headers`), вызывает `route.apply(...)` и превращает возвращённое значение в HTTP-ответ. Всё остальное в пакете — переиспользуемые контроллеры и схемы, которые кладутся в цепочки маршрутов приложения.

Зависимости: `@aom-js/core` (мета-классы для `AomAccessCore`), `@aom-js/schemer` (`@ComponentSchema`, `Schemer.validate`), `@aom-js/router` (декораторы, `Router`, `OpenApi`), плюс `ws`, `dayjs`, `es-toolkit`, `reflect-metadata` (`packages/api/package.json` (`dependencies`)). Потребитель у пакета один — приложение `test/`; другие пакеты ядра от `api` не зависят. Полный граф пакетов и схема сборки монорепо — в `main/docs/architecture.md` §«Состав…».

Каталог `src/constants` (коды сообщений и словари) намеренно не попадает в публичный экспорт: он не реэкспортируется из `src/index.ts`. Детали — §«Легаси и мёртвый код». Каталог `src/controllers/events` (WebSocket-точки и SSE-ссылки) входит в публичный вход через `src/controllers/index.ts` — §«WebSocket-точки», §«SSE-ссылки».

## Публичный API

Колонка «Используется приложением» проверена по `test/src` (grep по имени символа); сколько раз символ встречается — `grep -rn "<Символ>" test/src | wc -l` из корня рабочего пространства.

### Сервер и локализация

| Экспорт                                  | Сигнатура                                                                                                                                                                                                                                                                                                                                | Назначение                                                                                                                                                                                        | Используется приложением                              |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `Server`                                 | `new Server(settings: AomServerSettings, router: Router, i18nizer?: I18nizer)`; `readonly server: http.Server`; `static routesAmount: number`; `stop(): Promise<void>`; `static stopAll(): Promise<void>`                                                                                                                                                                                            | HTTP-сервер вокруг роутера; `listen()` вызывается в конструкторе; `stop()`/`stopAll()` — аккуратная остановка                                                                                                                                  | да (`test/src/modules/*/api/index.ts`)                |
| `I18nizer`                               | `new I18nizer(defaultLocale?, headerKey?, queryKey?, localesStruct?, init?)`; `defineLocale(headers, query)`, `localize(text, locale)`, `addLocalesStruct(struct)`, `addLocalesMap(locale, map)`, `setDefaultLocale(locale)`, `getDefaultLocale()`, `getLocales()`, `JSONSchema(in?)`; статики `DEFAULT_LOCALE`/`HEADER_KEY`/`QUERY_KEY` | Подстановка текстов вместо кодов сообщений в готовом ответе                                                                                                                                       | да (`test/src/config/aom/i18nizer.ts`)                |
| `I18nizerInitFunction`, `I18nizerInPath` | `(i18n: I18nizer) => void \| Promise<void>`; `'query' \| 'header'`                                                                                                                                                                                                                                                                       | Типы `I18nizer`                                                                                                                                                                                   | нет                                                   |
| `AomServerSettings`                      | `{ port: number; url: string; name?: string; bodyLimit?: number; protocolHeaders?: string[] }`                                                                                                                                                                                                                                                                       | Настройки сервера; `bodyLimit` — глобальный лимит JSON-тела в байтах, `0` — без ограничения, по умолчанию `DEFAULT_BODY_LIMIT`; `protocolHeaders` — какие заголовки WebSocket-клиент может передать подпротоколом (не задано — все, `[]` — никакие)                                                                    | да (`test/src/modules/orgs/api/init.ts` (`settings`)) |
| `parseJsonBody`                          | `parseJsonBody(req: IncomingMessage, options?: BodyParseOptions): Promise<any>`                                                                                                                                                                                                                                                          | Разбор JSON-тела запроса с лимитом размера; вызывается `Server` лениво (см. §«Ленивое тело запроса и лимит размера»), но не зависит от него — готовый кирпич для адаптеров чужих HTTP-фреймворков | нет напрямую (используется `Server`)                  |
| `BodyParseOptions`                       | `{ limit?: number }`                                                                                                                                                                                                                                                                                                                     | Опции `parseJsonBody`; `limit: 0` — без ограничения                                                                                                                                               | нет                                                   |
| `protocolHeaders`                        | `protocolHeaders(value, allowed?): Record<string, string>` | Развёртка `Sec-WebSocket-Protocol` в обычные заголовки (раздел «WebSocket-точки») | нет |
| `DEFAULT_BODY_LIMIT`                     | `1_048_576` (1 МиБ)                                                                                                                                                                                                                                                                                                                      | Лимит тела по умолчанию, если не заданы `@BodyOptions` и `AomServerSettings.bodyLimit`                                                                                                            | нет                                                   |
| `BODY_UNREAD`                            | `unique symbol`                                                                                                                                                                                                                                                                                                                          | Метка на ошибке `parseJsonBody`: поток начали читать и бросили на полпути — вызывающий код обязан закрыть соединение (`Connection: close`), а не переиспользовать его                             | нет                                                   |

### Билдеры

| Экспорт                                                                                    | Сигнатура                                                                                                                               | Назначение                                                                                        | Используется приложением                                                                          |
| ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `BodyBuilder`                                                                              | `BodyBuilder<T>(schema: T, description?: string)` → класс с `body: InstanceType<T>`, `static Body`, `static JSONSchema(description?)`   | Валидация JSON-тела по схеме + `RequestBody` в OpenAPI                                            | да (`test/src/modules/orgs/api/routes/orgs/init/body.ts` (`SubOrgBody`))                          |
| `QueryStringBuilder`                                                                       | `QueryStringBuilder<T>(schema: T)` → `query`, `static Query`, `static NotEmpty`, `static JSONSchema()`                                  | Валидация query-string + `QueryParameters`                                                        | да                                                                                                |
| `HeadersBuilder`                                                                           | `HeadersBuilder<T>(schema: T)` → `headers`, `static Headers`, `static ImplicitHeaders`                                                  | Валидация заголовков; `Headers` дополнительно описывает их в OpenAPI                              | да (`test/src/common/controllers/current-data/schemas.ts` (`CurrentOrgHeader`))                   |
| `CookieBuilder`                                                                            | `CookieBuilder<T>(schema: T)` → `cookies`, `static Cookie`, `static NotEmpty`                                                           | Валидация cookies + `CookieParameters`                                                            | нет                                                                                               |
| `ParamsBuilder`                                                                            | `ParamsBuilder<T>(schema: T)` → `params`, `value`, `static attr/jsonSchema/toString()/JSONSchema()`, `static Params`, `static NotEmpty` | Один path-параметр из компонент-схемы ровно с одним свойством                                     | нет                                                                                               |
| `ResponseBuilder`                                                                          | `ResponseBuilder<T>(schema: T, status = 200)` → `static JSONSchema(description?, status?)`, `static Response`                           | Объявление `Responses` для схемы                                                                  | да (`test/src/modules/references/api/routes/settings/countries/init/schemas.ts` (`OrgCountriesResponse`)) |
| `PlainBuildersBase`, `HeaderBuildersBase`, `QueryStringBuildersBase`, `CookieBuildersBase` | `static readonly schema`; `static JSONSchema(path)`                                                                                     | Базы билдеров, **не экспортируются** из `src/index.ts` (`builders/index.ts` не включает `common`) | нет                                                                                               |

### Базовые контроллеры

| Экспорт                                                                                                     | Сигнатура                                                                                                                                                                                                                                                                            | Назначение                                                       | Используется приложением                                                                                                                                                                                                                                                                |
| ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BaseRootController`                                                                                        | поля `ident`, `docs: OpenApi`, `RouteElement`, `routes`; `static RoutesStructure`, `static docsJSON`; `markersToRoute(el, markers)`; `static InitRoutes`, `static Index`, `JSONDocs`, `Swagger`                                                                                      | Корень модуля: карта маршрутов, `/openapi.json`, `/swagger.html` | да (`test/src/common/controllers/module/controller.ts` (`ModuleRootController`))                                                                                                                                                                                                        |
| `RouteElement`, `RoutesStructure`                                                                           | `RouteElement {method, path, operationId}`; `RoutesStructure<RE> {ident, routes: RE[]}`                                                                                                                                                                                              | Схемы ответа `Index`                                             | да (наследуются в `test/src/common/controllers/module/schemas.ts`)                                                                                                                                                                                                                      |
| `BaseAccessController`                                                                                      | статики `markerName`, `allowedAccessTypes`, `AccessMarker`, `AccessCore`; методы `checkAccessPoint(ident, marker)`, `generateAccessMap(types, roles)`; `static Init`, `Required`, `CheckLayerPass`, `setAccessMark`, `TypesRequired(...)`, `SetExtraAccess(...)`, `ExtraAccess(...)` | Контроль доступа через маркеры маршрутов                         | да (`test/src/common/controllers/access/controller.ts` (`AccessController`))                                                                                                                                                                                                            |
| `AomAccessCore`, `AomAccessMapStructure`, `ActiveAccessTypes`, `IAomAccessPoint`, `AomAccessPlainStructure` | `AomAccessCore extends AomCore {extraAccess, extraAccessMiddlewares, accessTypes}`; `AomAccessMapStructure {fullAccess, structure}`                                                                                                                                                  | Мета-класс доступа и структуры карты                             | частично: только `AomAccessCore` (`test/src/common/controllers/access/schemas.ts` (`AccessCore`)); остальные — нет                                                                                                                                                                      |
| `AomAccessMarkerElement`, `AomAccessToModulesStructure`, `AomAccessModuleElements`, `AomAccessIdentElement` | `AomAccessMarkerElement {accessPoints, accessTypes}`; `AomAccessToModulesStructure {fullAccess, modulesAccess}`                                                                                                                                                                      | Компонент-схемы маркера и ролей                                  | частично: `AomAccessMarkerElement` (`test/src/common/controllers/access/schemas.ts` (`AccessMarkerElement`)), `AomAccessModuleElements` (`test/src/modules/orgs/entities/postgres/Roles/Roles.ts` (`Roles.modulesAccess`)); `AomAccessToModulesStructure`/`AomAccessIdentElement` — нет |
| `AuthBasic`, `BasicSecuritySchema`                                                                          | `static BASIC_AUTH: string`; `static Required`                                                                                                                                                                                                                                       | Basic-авторизация                                                | `AuthBasic` — да (`test/src/config/aom/auth.ts` (`AuthBasic.BASIC_AUTH`)); `BasicSecuritySchema` — нет                                                                                                                                                                                  |
| `AuthHeaderToken`, `HeaderTokenSecuritySchema`                                                              | `static TOKEN_NAME = 'Bearer'`, `static HEADERS_KEYS = ['authorization']`; `value`, `type`; `static Required`                                                                                                                                                                        | Bearer-токен из заголовка                                        | `AuthHeaderToken` — да (`test/src/common/controllers/current-data/current-user.ts` (`CurrentUser.Required`, `CurrentUser.Init`)); `HeaderTokenSecuritySchema` — нет                                                                                                                     |
| `AuthCookieToken`, `CookieTokenSecuritySchema`                                                              | `static COOKIE_NAME = 'sessionId'`; `value`; `static Required`                                                                                                                                                                                                                       | Токен из cookie                                                  | нет                                                                                                                                                                                                                                                                                     |
| `IDController`, `IDValue`, `UUIDParam`, `MongoIDParam`, `NanoIDParam`, `NumberIDParam`                      | `IDValue(attr, Schema)` → класс с `static attr/pattern`, `value`, `static PathID/QueryID/HeaderID`, `static toString()/param()/JSONSchema(in)`                                                                                                                                       | Типизированный параметр пути/query/заголовка                     | да (`UUIDParam`; `test/src/modules/orgs/api/routes/orgs/init/params.ts` (`OrgIDValue`))                                                                                                                                                                         |
| `ParamIDSchema`, `NumberIDSchema`, `MongoIDSchema`, `NanoIDSchema`, `UUIDSchema`                            | `{regexp; schema(); format(name); value(v)}`                                                                                                                                                                                                                                         | Шаблоны регулярных выражений ID                                  | нет (используются косвенно через `UUIDParam`)                                                                                                                                                                                                                                           |
| `Logger`                                                                                                    | `static ENGINE: AomLoggerEngine = console`; `static Init`, `Attach`, `Watch`                                                                                                                                                                                                         | Логирование запросов                                             | частично: подменяется только `ENGINE` (`test/src/config/aom/logger.ts` (`Logger.ENGINE`))                                                                                                                                                                                               |
| `AomWebSockets`, `WebSocketsController`, `Ws`, `WebSocket` | `new AomWebSockets(onMessage?)`; `connections: Map<string, WebSocket[]>`; `send(id, data)`, `broadcast(data)`, `connect(id, socket)`, `disconnect(id, socket)`; `WebSocketsController`: поле `id`, `static Define`, `static Connect`, `static wssMap`; `Ws()` — параметр-декоратор сокета из контекста; `WebSocket` — реэкспорт из `ws` | WebSocket-точки (§«WebSocket-точки») | да: `AomWebSockets`, `WebSocketsController`, `WebSocket` (`test/src/modules/orgs/api/routes/permissions/socket.ts` (`MyPermissionsSocket`), `test/src/modules/tickets/api/routes/tickets/socket.ts` (`TicketSocket`)); `Ws` — нет |
| `AomServerEvents`, `formatServerEvent`, `AomServerEventsOptions`, `EventEnvelope` | `new AomServerEvents(schemas, { heartbeat?, retry?, validate? })`; `connections: Map<string, PassThrough[]>`; `connect(id, res)` → `PassThrough`, `disconnect(id, stream)`, `send(id, type, value, eventId?)`, `broadcast(type, value, eventId?)`, `sendEnvelope(id, envelope, eventId?)`, `broadcastEnvelope(envelope, eventId?)`, `JSONSchema(description, status = 200)`; `formatServerEvent(data, eventId?)` — текст кадра; `EventEnvelope<E>` — конверт `{ type, [type]: значение }` словаря | SSE-ссылки (§«SSE-ссылки») | да: `AomServerEvents` (`test/src/modules/notifications/api/routes/events.ts` (`NotificationsEvents`)); `formatServerEvent`, `EventEnvelope`, `*Envelope` — нет |

### Ответы

| Экспорт                                               | Сигнатура                                                                                                                                                      | Назначение                                                                                    | Используется приложением                                                            |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `ErrorMessage`                                        | `new ErrorMessage(message, status?, data?)`; `static status = 500`, `static description`; `toJSON(): {message,status,data}`; `static JSONSchema(description?)` | База ошибок-ответов                                                                           | да (`test/src/modules/files/api/routes/files/routes.ts` (`ErrorMessage.JSONSchema`)) |
| `ServerErrorResponse`                                 | `new (message, data?)`, `status = 500`                                                                                                                         | 500                                                                                           | нет                                                                                 |
| `NotFoundResponse`                                    | `status = 404`                                                                                                                                                 | 404                                                                                           | да                                                                                  |
| `ConflictResponse`                                    | `status = 409`                                                                                                                                                 | 409                                                                                           | да                                                                                  |
| `PayloadTooLargeResponse`                             | `status = 413`                                                                                                                                                 | 413 (тело запроса больше лимита)                                                              | нет                                                                                 |
| `WrongDataResponse`                                   | `status = 400`                                                                                                                                                 | 400                                                                                           | да                                                                                  |
| `LockedResponse`                                      | `status = 423`                                                                                                                                                 | 423                                                                                           | нет                                                                                 |
| `FailedDependencyResponse`                            | `status = 424`                                                                                                                                                 | 424                                                                                           | нет                                                                                 |
| `AccessDenyResponse`                                  | `status = 403`                                                                                                                                                 | 403                                                                                           | да                                                                                  |
| `PaymentRequiredResponse`                             | `status = 402`                                                                                                                                                 | 402                                                                                           | нет                                                                                 |
| `AuthRequiredResponse`                                | `status = 401`                                                                                                                                                 | 401                                                                                           | да                                                                                  |
| `SeeOtherResponse`                                    | `status = 303`                                                                                                                                                 | 303                                                                                           | нет                                                                                 |
| `CommonResponse`                                      | `extends ResponseJSONSchema`; `static status = 200`, `static description`                                                                                      | База успешных ответов                                                                         | да                                                                                  |
| `MessageResponse`                                     | `new (message?)`; `message?: string`                                                                                                                           | Ответ-сообщение                                                                               | да                                                                                  |
| `DataResponse`                                        | `new (message?, data?)`; `data?: any`                                                                                                                          | Сообщение с данными; приложение объявляет собственный `DataResponse` поверх `MessageResponse` | частично (`test/src/common/responses/messages.ts` (`DataResponse`))                 |
| `NumberResponse`, `BooleanResponse`, `StringResponse` | `new (value?)`; `value`                                                                                                                                        | Скалярные ответы                                                                              | `NumberResponse`/`BooleanResponse` — да; `StringResponse` — нет                     |

### Декораторы, функции, схемы, типы

| Экспорт                                                                                                               | Сигнатура                                                                                        | Назначение                                                                                                                                          | Используется приложением                                                                                                               |
| --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `SafeData`                                                                                                            | `SafeData(ctor): (data) => values` (бросает `WrongDataResponse`)                                 | Валидация plain-данных через `Schemer`                                                                                                              | нет напрямую (только внутри билдеров)                                                                                                  |
| `SafeBody`, `SafeQuery`                                                                                               | `SafeBody(ctor) = Body(SafeData(ctor))`                                                          | Готовые параметр-декораторы                                                                                                                         | нет                                                                                                                                    |
| `IsNullable`                                                                                                          | `IsNullable(options?): PropertyDecorator`                                                        | `ValidateIf(value !== null)` — дословная копия одноимённого экспорта `@aom-js/schemer`, который теперь публичный (см. `packages/schemer/readme.md`) | нет                                                                                                                                    |
| `QueryBoolean`                                                                                                        | `QueryBoolean(): PropertyDecorator`                                                              | `'true'`/`'false'`/число → boolean + `IsBoolean`                                                                                                    | нет                                                                                                                                    |
| `TransformEmpty`, `TransformTrim`, `TransformToArray`, `TransformToDate`                                              | `TransformToDate({startOf?, endOf?, format?})`                                                   | class-transformer-преобразования                                                                                                                    | только `TransformToArray`                                                                                                              |
| `plainJsonSchema`                                                                                                     | `plainJsonSchema(ctor, in): OpenApiParameterObject[]`                                            | Класс → список параметров OpenAPI                                                                                                                   | нет                                                                                                                                    |
| `responseJsonSchema`                                                                                                  | `responseJsonSchema(ctor, description?, status?): OpenApiResponse`                               | Класс → описание ответа                                                                                                                             | да (`test/src/common/controllers/entity.ts` (`EntityController.JSONSchema`))                                                           |
| `pathVariants`                                                                                                        | `'path' \| 'query' \| 'header' \| 'cookie'`                                                      | Тип места параметра                                                                                                                                 | нет                                                                                                                                    |
| `BodyOptions`                                                                                                         | `BodyOptions(options: BodyParseOptions): MethodDecorator`                                        | Маркер-декоратор: перекрывает лимит тела для эндпоинта или для middleware маршрута; вешается на любой из них                                        | нет                                                                                                                                    |
| `BODY_OPTIONS_MARKER`                                                                                                 | `"aom:bodyOptions"`                                                                              | Ключ, под которым `@BodyOptions` кладёт `BodyParseOptions` в `route.markers`                                                                        | нет                                                                                                                                    |
| `checkLocales`                                                                                                        | `checkLocales(hint, source, target): void`                                                       | Диагностический вывод разницы: значения `source` (коды), которых нет среди ключей `target` (словарь)                                                | нет (у приложения своя копия — `test/src/constants/locales/check-locales.ts` (`checkLocales`))                                         |
| `ResponseJSONSchema`, `PlainJSONSchema`, `QueryJSONSchema`, `HeaderJSONSchema`, `ParamJSONSchema`, `CookieJSONSchema` | `static JSONSchema(...)`                                                                         | Базовые классы схем с готовым `JSONSchema`                                                                                                          | `ResponseJSONSchema` — да, остальные — нет                                                                                             |
| `HttpRequest`, `HttpResponse`, `HttpSocket`, `HttpCtx`, `SocketCtx`                                                   | `HttpCtx = {req: IncomingMessage; res: ServerResponse}`; `SocketCtx = {req; res: Stream.Duplex}` | Типы контекста                                                                                                                                      | `HttpCtx` — да, `SocketCtx` — нет                                                                                                      |
| `ClassConstructor`                                                                                                    | реэкспорт из `@aom-js/core`                                                                      | Тип конструктора                                                                                                                                    | нет (приложение берёт тип напрямую из `@aom-js/core` — `test/src/modules/tickets/api/routes/tickets/init/aom.ts` (`ClassConstructor`)) |

### Выгрузка цепочек (`@aom-js/api/testing`)

Второй путь пакета — `@aom-js/api/testing` (`src/testing/index.ts`, `exports` в `package.src.json`): вид шага, выведенный из классов этого пакета, и выгрузка цепочек маршрутов для тестов приложения. Живёт здесь, а не в `@aom-js/router/testing`, потому что вид `checkpoint` и `input` выводится из `BaseAccessController`, баз билдеров и `IDController`, а роутер от `api` не зависит. В рантайм сервера не входит: импортируют его только тесты и скрипт дампа.

| Экспорт | Сигнатура | Назначение | Используется приложением |
| --- | --- | --- | --- |
| `kindOf` | `kindOf(cursor, options?: ManifestOptions): AomCursorKind` | вид шага: `@CursorKind`, эндпоинт — `handler`, `options.kindOf` приложения, наследник `BaseAccessController` — `checkpoint`, унаследованный шаг базы билдера или `IDController` — `input`, пустой классовый шаг — `meta`, иначе `step` | да (`test/src/lib/manifest/index.ts`) |
| `describeRoute`, `describeRouter` | `describeRoute(route, options?): DescribedRoute`; `describeRouter(router, options?): {version: 1; routes}` | `toJSON()` маршрута или роутера, у каждого шага `parent` (`parentsOf`) и `kind` | да (там же) |
| `manifestOf` | `manifestOf(router, options?): string` | текст файла дампа | да (там же, `test/scripts/manifests.ts`) |
| `ManifestOptions`, `DescribedStep`, `DescribedRoute` | типы | `kindOf?` — вид классов приложения, `undefined` — решают правила пакета | нет (типы выводятся) |

Порядок правил вида, граница «ядро — приложение» и общие правила цепочки — [`docs/testing.md`](../../docs/testing.md).

## Внутренние модули

| Файл                                                                                 | Ответственность                                                                                                                                                                                                                                                      | Ключевые символы                                                                                           |
| ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `packages/api/src/index.ts`                                                          | `import "reflect-metadata"` и реэкспорт `server`/`builders`/`types`/`controllers`/`decorators`/`functions`/`responses`/`schemas`; `constants` не реэкспортируются                                                                                                    | —                                                                                                          |
| `packages/api/src/server/http.ts`                                                    | HTTP-сервер и сопоставление путей; безопасный разбор URL; парсинг тела/cookies/query/заголовков; диспетчеризация результата (строка/поток/JSON/ошибка); единый `catch` с кодами по статусу; обработчик `upgrade`                                                     | `Server`, `RouteMatcher` (не экспортируется), `STATUS_ERROR_MESSAGES`                                      |
| `packages/api/src/server/i18nizer.ts`                                                | Словари локалей, выбор локали, regexp-подстановка текстов                                                                                                                                                                                                            | `I18nizer`                                                                                                 |
| `packages/api/src/server/protocol-headers.ts`                                        | Развёртка подпротокола WebSocket в заголовки | `protocolHeaders` |
| `packages/api/src/server/types.ts`                                                   | Настройки сервера, включая `bodyLimit` и `protocolHeaders`                                                                                                                                                                                                                               | `AomServerSettings`                                                                                        |
| `packages/api/src/server/body.ts`                                                    | Разбор JSON-тела с лимитом размера; не зависит от `Server`, экспортируется наружу пакета                                                                                                                                                                             | `parseJsonBody`, `DEFAULT_BODY_LIMIT`, `BODY_UNREAD`, `BodyParseOptions`                                   |
| `packages/api/src/decorators/body-options.ts`                                        | Маркер-декоратор лимита тела на маршруте                                                                                                                                                                                                                             | `BodyOptions`, `BODY_OPTIONS_MARKER`                                                                       |
| `packages/api/src/builders/common.ts`                                                | Базы билдеров с `static schema` и `JSONSchema(path)`; бросает, если `schema` не задана                                                                                                                                                                               | `PlainBuildersBase`, `HeaderBuildersBase`, `QueryStringBuildersBase`, `CookieBuildersBase`                 |
| `packages/api/src/builders/{body,query-string,headers,cookie,params,response}.ts`    | Фабрики контроллеров из компонент-схем                                                                                                                                                                                                                               | `BodyBuilder`, `QueryStringBuilder`, `HeadersBuilder`, `CookieBuilder`, `ParamsBuilder`, `ResponseBuilder` |
| `packages/api/src/controllers/root.ts`                                               | Корневой контроллер модуля и схемы его ответа                                                                                                                                                                                                                        | `BaseRootController`, `RouteElement`, `RoutesStructure`                                                    |
| `packages/api/src/controllers/swagger.ts`                                            | HTML-строка Swagger UI (default-экспорт)                                                                                                                                                                                                                             | `swagger`                                                                                                  |
| `packages/api/src/controllers/access/access-controller.ts`                           | Маркеры доступа, `Required`, `TypesRequired`, слои доступа, карта доступа                                                                                                                                                                                            | `BaseAccessController`                                                                                     |
| `packages/api/src/controllers/access/{types,schemas,init}.ts`                        | Мета-класс `AomAccessCore`, компонент-схемы маркера и ролей, пустой `enum AccessTypes`                                                                                                                                                                               | `AomAccessCore`, `AomAccessMarkerElement`, `AomAccessToModulesStructure`, `AccessTypes`                    |
| `packages/api/src/controllers/auth/{basic,headerToken,cookieToken}.ts`               | Извлечение учётных данных и security-схемы OpenAPI                                                                                                                                                                                                                   | `AuthBasic`, `AuthHeaderToken`, `AuthCookieToken`                                                          |
| `packages/api/src/controllers/id-value/{controller,schemas}.ts`                      | Типизированный ID-параметр и шаблоны регулярных выражений                                                                                                                                                                                                            | `IDController`, `IDValue`, `UUIDParam`, `UUIDSchema`                                                       |
| `packages/api/src/controllers/logger/{logger,types}.ts`                              | Логирование запроса по событиям `finish`/`error`                                                                                                                                                                                                                     | `Logger`, `AomLoggerEngine` (тип не экспортируется наружу)                                                 |
| `packages/api/src/controllers/events/{websockets,sse}.ts` | WebSocket-точки поверх `ws`: реестр соединений, рукопожатие, приём сообщений; SSE-ссылки: реестр потоков, кадр события, описание ответа. Реэкспортируется из `controllers/index.ts` (кроме экспорта по умолчанию `websockets.ts`) | `AomWebSockets`, `WebSocketsController`, `Ws`, `WebSocket`, `AomServerEvents`, `formatServerEvent` |
| `packages/api/src/responses/{error-message,error-responses,data-responses,types}.ts` | Классы ответов и ошибок со `status`, `toJSON`, `JSONSchema`                                                                                                                                                                                                          | `ErrorMessage`, `*Response`, `CommonResponse`                                                              |
| `packages/api/src/decorators/{safe-data,is-nullable,query-boolean,transforms}.ts`    | Валидация через `Schemer` и обёртки class-validator/class-transformer                                                                                                                                                                                                | `SafeData`, `IsNullable`, `QueryBoolean`, `Transform*`                                                     |
| `packages/api/src/functions/{json-schema,check-locales}.ts`                          | Класс → структуры OpenAPI; диагностика словарей                                                                                                                                                                                                                      | `plainJsonSchema`, `responseJsonSchema`, `checkLocales`                                                    |
| `packages/api/src/schemas/json-schema.ts`                                            | Базовые классы со `static JSONSchema()`                                                                                                                                                                                                                              | `ResponseJSONSchema`, `PlainJSONSchema` и наследники                                                       |
| `packages/api/src/constants/messages/*`                                              | Коды вида `AOM_API:<NAME>`                                                                                                                                                                                                                                           | `PREFIX`, `PREFIX_VALUE`                                                                                   |
| `packages/api/src/constants/locales/{ru,en}/errors.ts`                               | Словари для кодов ошибок (все коды `messages/errors.ts` переведены на обе локали)                                                                                                                                                                              | `locales`                                                                                                  |
| `packages/api/src/types/{http,common}.ts`                                            | Алиасы `node:http`/`node:stream`, реэкспорт `ClassConstructor`                                                                                                                                                                                                       | `HttpCtx`, `SocketCtx`                                                                                     |
| `packages/api/{tsconfig.build*.json,package.json,package.src.json}`                  | Три прохода `tsc`; `package.json` генерируется корневым `scripts/prebuild.js` из `package.version.json` + `package.src.json` + `scripts/jsons/package.dist.json` (`scripts/files.js` (`srcPackageJsons`), `scripts/prebuild.js`)                                     | —                                                                                                          |
| `packages/api/test/{server,units,body-options}.test.ts`                              | Интеграционные тесты `Server` (поднимает реальный сервер на `port: 0`, включая ленивое тело и лимит размера), юнит-тесты `checkLocales`/`BodyBuilder.JSONSchema`/кодов 423-424/`CheckLayerPass`, юнит-тесты `@BodyOptions` (маркер и перекрытие middleware↔эндпоинт) | —                                                                                                          |

## Ключевые механизмы

### Конвейер HTTP-запроса (Server)

Конструктор регистрирует в `RouteMatcher` все `router.routes` (наращивая статический счётчик `Server.routesAmount`) и все `router.sockets`, вливает встроенные словари пакета в переданный локализатор и сразу вызывает `listen(settings.port)` (`server/http.ts` (`Server`)).

**Разбор адреса запроса — безопасно относительно хоста.** `req.url` — это путь запроса, а не адрес: абсолютная форма (`GET http://evil.com/admin`), authority-form (`//evil.com/admin`) и её вариант с обратным слэшем (`/\evil.com/admin` — WHATWG для `http`/`https` считает `\` тем же `/`) не должны позволять хосту из запроса участвовать в сопоставлении маршрута — иначе прокси/WAF, фильтрующий по пути, обходится этим же запросом. `parseRequestUrl` фиксирует хост константой (`new URL("http://localhost")`) и заполняет только `pathname`/`search` через сеттеры — они разбирают строку в «path state»/«query state» отдельно от хоста, а не через общий алгоритм разрешения относительных ссылок (`new URL(path, base)`), поэтому ведущие `//` или `\` не могут быть приняты за network-path reference и подменить хост. Префикс из `settings.url` (если есть) по-прежнему приклеивается спереди — как и раньше. Фрагмент (после `#`) на сервер по HTTP-спеке не попадает — он отбрасывается вручную, до присвоения `pathname`/`search`, потому что эти сеттеры не знают про `#` как отдельный разделитель и percent-кодируют его как обычный символ пути/query.

`packages/api/src/server/http.ts` (`parseRequestUrl`):

```ts
const parseRequestUrl = (rawUrl: string | undefined): URL => {
  const requestPath = rawUrl && rawUrl.startsWith("/") ? rawUrl : `/${rawUrl || ""}`;
  const prefixPath = new URL(settings.url).pathname.replace(/\/$/, "");
  const joinedPath = prefixPath + requestPath;
  const hashIndex = joinedPath.indexOf("#");
  const combinedPath = hashIndex === -1 ? joinedPath : joinedPath.slice(0, hashIndex);
  const queryIndex = combinedPath.indexOf("?");
  const url = new URL("http://localhost");
  url.pathname = queryIndex === -1 ? combinedPath : combinedPath.slice(0, queryIndex);
  url.search = queryIndex === -1 ? "" : combinedPath.slice(queryIndex);
  return url;
};
```

На каждый запрос обработчик выставляет CORS-заголовки (`Access-Control-Allow-Origin: *`, `-Methods` фиксированным списком, `-Headers` — отражением `access-control-request-headers`, если браузер его прислал, иначе прежний дефолт `Content-Type,Authorization`) и только затем разбирает адрес и ищет маршрут. Ответ `204` на `OPTIONS` — это запасной preflight-дефолт: он отдаётся только тогда, когда для `OPTIONS` на этот путь нет собственного маршрута; если приложение объявило `@Options()`-эндпоинт, исполняется он (`server/http.ts` (`Server`)). Далее собираются `query` (повтор ключа → массив, `http.ts` (`Server.structurizeSearchParams`)) и `headers` (только определённые значения, `http.ts` (`Server.definedHeadersValues`)), определяется локаль (`http.ts` (`Server`)). Отсутствие совпадения — `404` c телом `NotFoundResponse(PATH_NOT_FOUND)` (`http.ts` (`Server`)). Иначе вызывается `route.apply` с полным набором значений, включая всегда пустые `session` и `files` (`http.ts` (`Server`)).

`packages/api/src/server/http.ts` (`Server`):

```ts
if (typeof result === "string") {
  if (!res.getHeader("Content-Type")) {
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
  }
  res.writeHead(200);
  res.end(localize(result));
} else if (result instanceof Readable) {
  if (!res.getHeader("Content-Type")) {
    res.setHeader("Content-Type", "application/octet-stream");
  }
  Stream.pipeline(result, res, (streamErr) => {
    if (!streamErr) return;
    if (streamErr.code === "ERR_STREAM_PREMATURE_CLOSE" && res.destroyed) return; // клиент ушёл сам
    console.error("Stream error:", streamErr);
    if (res.destroyed) return;
    if (res.headersSent) {
      res.destroy();
    } else {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify(new ServerErrorResponse(messages.SERVER_ERROR)));
    }
  });
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

**Строковый результат — `text/plain`, а не `text/html` (закрыт `KI-API-17`).** Строка, возвращённая обработчиком, часто несёт значения из запроса или из хранилища; отдать её как `text/html` без экранирования значило бы дать браузеру исполнить эти данные как разметку — отражённый XSS. Поэтому по умолчанию тип — `text/plain; charset=utf-8`, и сервер сам его не эскейпит (эскейпить нечего — это не HTML). Если обработчику нужен настоящий HTML, он выставляет `Content-Type` сам через `res.setHeader(...)` до `return`: `res.writeHead(200)` ниже вызывается без объекта заголовков и уже выставленный `setHeader` не перетирает (перетёр бы только `writeHead` с тем же ключом в собственном объекте заголовков). Оба готовых примера приёма — в этом же пакете: `BaseRootController.Swagger` (`controllers/root.ts` (`BaseRootController.Swagger`)) и `BaseVisualizerController.Page` (`controllers/visualizer.ts` (`BaseVisualizerController.Page`)) выставляют `Content-Type: text/html; charset=utf-8` вручную перед `return this.html`/`return swagger.toString()`.

Потоковый результат распознаётся именно как `Readable` (а не любой `Stream`) и пайпится через `Stream.pipeline`, а не `pipe`: `pipeline` сам разрушает источник при ошибке или при обрыве соединения клиентом, иначе оборванное скачивание оставляет источник (файл, сокет) висеть открытым; `Content-Type: application/octet-stream` подставляется только тогда, когда обработчик сам не выставил свой через `setHeader` (`setHeader`, в отличие от `writeHead`, не отправляет заголовки сразу). Уход клиента — `ERR_STREAM_PREMATURE_CLOSE` при уже разрушенном ответе (оборванное скачивание, закрытая SSE-ссылка) — не ошибка сервера и в `console.error` не пишется; прочие ошибки потока логируются как `Stream error:`. Тест — `packages/api/test/server-events.test.ts` («уход клиента: поток снят с реестра, console.error не вызван»).

**Единый `catch` с кодом ошибки по статусу.** Клиенту никогда не уходит текст или стек стороннего исключения — только готовый `ErrorMessage`, код из `STATUS_ERROR_MESSAGES` по числовому `status` исключения (400-599), либо общий `SERVER_ERROR`. Отдельно нормализуется финальный статус: `1xx` (промежуточный, не окончательный ответ — иначе клиент завис бы до таймаута) и всё вне диапазона `200..999` (`writeHead` с таким значением уронил бы процесс) заменяются на `ServerErrorResponse`. Если обработчик уже сам начал отвечать (`headersSent`) до броска — повторный `writeHead` невозможен (`ERR_HTTP_HEADERS_SENT`), поэтому соединение просто обрывается (`res.destroy()`). Логирование ошибки само обёрнуто в `try/catch`: если у брошенного объекта ломающийся `util.inspect.custom` (значит, само `console.error` бросает), сервер тоже не падает, а обрывает соединение.

`packages/api/src/server/http.ts` (`STATUS_ERROR_MESSAGES`, `Server`):

```ts
const STATUS_ERROR_MESSAGES: Record<number, string> = {
  400: messages.ERROR_WRONG_DATA,
  401: messages.ERROR_AUTH_REQUIRED,
  402: messages.PAYMENT_REQUIRED,
  403: messages.ERROR_ACCESS_DENY,
  404: messages.ERROR_NOT_FOUND,
  409: messages.ERROR_CONFLICT,
  413: messages.ERROR_PAYLOAD_TOO_LARGE,
  423: messages.ERROR_DATA_LOCKED,
  424: messages.ERROR_WRONG_DEPENDENCY,
  500: messages.SERVER_ERROR,
};
// ...
let errorResponse: ErrorMessage;
if (err instanceof ErrorMessage) {
  errorResponse = err;
} else if (Number.isInteger(err?.status) && err.status >= 400 && err.status <= 599) {
  errorResponse = new ErrorMessage(
    STATUS_ERROR_MESSAGES[err.status] ?? messages.ERROR_MESSAGE,
    err.status,
  );
} else {
  errorResponse = new ServerErrorResponse(messages.SERVER_ERROR);
}
if (
  !Number.isInteger(errorResponse.status) ||
  errorResponse.status < 200 ||
  errorResponse.status > 999
) {
  errorResponse = new ServerErrorResponse(messages.SERVER_ERROR);
}
```

Сериализация и локализация ошибки выполняются до `writeHead`: если `data` не сериализуется (`BigInt`, циклы), заголовки ещё не отправлены и можно откатиться на безопасный `500` во внешнем `try/catch` (`http.ts` (`Server`)). Снаружи всей логики запроса есть ещё одна защитная сетка (`http.ts` (`Server`)): она ловит исключения из самого разбора адреса или другой подготовки до основного `try` — без нее асинхронный бросок здесь стал бы необработанным отклонением промиса и уронил бы процесс.

Evidence: `packages/api/src/server/http.ts` (`Server`, `parseRequestUrl`) (конструктор, разбор URL), (CORS/OPTIONS, поиск маршрута, вызов `route.apply`), (диспетчеризация результата), (единый `catch` и внешняя защитная сетка), (`upgrade`); тесты `packages/api/test/server.test.ts` (весь файл, включая блок ленивого тела — describe «Server: ленивое чтение тела и лимит размера (KI-API-16)»).

### Остановка: `stop()` и `Server.stopAll()`

`stop()` вызывает `server.close()` — сервер больше не принимает соединения, простаивающие keep-alive соединения закрываются (так делают и Node 19+, и Bun). Долгие соединения сами не завершатся, поэтому `stop()` закрывает их сразу: ответы с `Content-Type: text/event-stream` завершаются (`res.end()`), сокеты после `upgrade` (WebSocket) разрываются — клиенты переподключаются к другой копии или к перезапущенному процессу. Запросы в работе дописывают ответ; их соединение закрывается после ответа (`Connection: close` или конец сокета, если заголовки уже ушли), запрос, пришедший во время остановки по уже открытому соединению, тоже получает `Connection: close`. `Promise` разрешается, когда `http.Server` закрыт; он не отклоняется, повторный вызов возвращает тот же `Promise`. Своего предела времени нет — общий таймаут остановки задаёт приложение.

Сервер учитывает свои ответы в работе и сокеты после `upgrade` сам: общий для процесса `WebSocketServer` (`packages/api/src/controllers/events/websockets.ts`) не знает, какому серверу принадлежит сокет.

`Server.stopAll()` останавливает все серверы процесса, которые ещё работают: сервер попадает в список при создании и выходит из него по событию `close` своего `http.Server`. Сигналы процесса `Server` не ловит: порядок остановки (HTTP → шина → база) и вызов `process.exit` — дело приложения.

```ts
// псевдокод: остановка в приложении
process.once("SIGTERM", async () => {
  await Server.stopAll(); // HTTP: новые не берём, начатые доводим
  await transfer.stop(); // @aom-js/transfer: то же для исполнителей шины
  await nats.drain();
  await db.close();
  process.exit(0);
});
```

Evidence: `packages/api/src/server/http.ts` (`Server.stop`, `Server.stopAll`); `packages/api/test/stop.test.ts` (весь файл).

### Ленивое тело запроса и лимит размера

До этой ревизии сервер читал тело целиком до запуска маршрута — то есть до любых проверок доступа и без ограничения размера. Теперь в контекст маршрута кладётся не готовое тело, а обёртка `lazy(...)` из `@aom-js/router`: разбор запускается не раньше первого обращения через `@Body` в цепочке маршрута, выполняется максимум один раз за запрос, а отказ (400 на битом JSON, 413 на превышении лимита) запоминается и переигрывается при повторном обращении к тому же `lazy`. Маршрут, которому тело не нужно, не читает поток вообще — например, отказ в доступе выше по цепочке курсоров отвечает сразу, не дожидаясь тела, которое клиент мог заявить в `Content-Length`, но не прислать.

`packages/api/src/server/http.ts` (`Server`):

```ts
const result = await match.route.apply({
  req,
  res,
  ctx: { req, res },
  body: lazy(async () => {
    const markerOptions: BodyParseOptions | undefined = match.route.markers[BODY_OPTIONS_MARKER];
    const limit = markerOptions?.limit ?? settings.bodyLimit ?? DEFAULT_BODY_LIMIT;
    try {
      return await parseJsonBody(req, { limit });
    } catch (err: any) {
      if (err?.[BODY_UNREAD] && !res.headersSent) {
        res.setHeader("Connection", "close");
      }
      throw err;
    }
  }),
  headers,
  query,
  params: match.params,
  cookies: this.parseCookies(req),
  session: {},
  files: {},
});
```

Сам разбор вынесен в `packages/api/src/server/body.ts` и от `Server` не зависит: `parseJsonBody(req, { limit })` — самостоятельная функция, экспортированная из пакета как готовый кирпич для адаптеров чужих HTTP-фреймворков. Лимит вычисляется не при старте сервера, а в момент обращения к телу, когда маршрут уже известен и его маркеры собраны: маркер маршрута `@BodyOptions({ limit })` → `AomServerSettings.bodyLimit` → дефолт пакета `DEFAULT_BODY_LIMIT = 1_048_576` (1 МиБ, `body.ts` (`DEFAULT_BODY_LIMIT`)); `limit: 0` на любом из трёх уровней означает «без ограничения» (`body.ts` (`parseJsonBody`)).

`@BodyOptions` (`decorators/body-options.ts`) — маркер-декоратор: вешается и на эндпоинт, и на middleware маршрута. Маркеры применяются в порядке курсоров, эндпоинт — последний, поэтому его значение перекрывает значение middleware — в обе стороны, и увеличивая, и уменьшая унаследованный лимит (`test/body-options.test.ts` («лимит эндпоинта перекрывает больший лимит middleware», «лимит эндпоинта перекрывает меньший лимит middleware»)):

```ts
@Middleware()
@BodyOptions({ limit: 4096 })
static async Mw() {}

@Get("/override-down")
@Before(App.Mw)
@BodyOptions({ limit: 1024 })
static async endpoint() {}
// route.markers[BODY_OPTIONS_MARKER] === { limit: 1024 } — эндпоинт победил
```

**Отказ по размеру — `413 PayloadTooLargeResponse`, код `ERROR_PAYLOAD_TOO_LARGE`.** Если заявленный `Content-Length` уже больше лимита, `parseJsonBody` отклоняет запрос до первого чтения потока (`body.ts` (`parseJsonBody`)): рантайм сам сольёт недочитанное тело, соединение остаётся рабочим, `Connection: close` не нужен. Если длина заранее не заявлена (`Transfer-Encoding: chunked`) и превышение обнаруживается уже по ходу чтения, ответ несёт `Connection: close` (`body.ts` (`parseJsonBody`, `BODY_UNREAD`), `http.ts` (`Server`)): часть тела к этому моменту уже вычитана из TCP-потока, и её недочитанный остаток на живом keep-alive соединении был бы разобран как начало следующего запроса. Практическая оговорка: этот путь достижим только там, где длина заранее неизвестна — при заявленном `Content-Length` меньше лимита node сам обрежет тело до лимита раньше, чем сработает счётчик в `onData`. `413` добавлен в общую карту `STATUS_ERROR_MESSAGES`, по которой единый `catch` определяет код ответа и для стороннего исключения с числовым `status` (`http.ts` (`STATUS_ERROR_MESSAGES`)).

Ошибки разбора тела (`400 WrongDataResponse` на битом JSON и `413 PayloadTooLargeResponse` на превышении лимита) теперь возникают внутри цепочки маршрута, а не до неё — их видят `@Run`-перехватчики и middleware приложения и могут подменить или залогировать (`test/server.test.ts` («413 виден перехватчику приложения (@Run) и доходит до клиента»)).

Не изменилось: `content-type`, отличный от `application/json`, по-прежнему даёт `{}`, и поток при этом не трогается вовсе (`body.ts` (`parseJsonBody`)) — на этом держится загрузка файлов через formidable в приложениях, и чинить это не нужно.

Оговорка про порядок: выигрыш «неавторизованный не заставляет читать тело» держится, только пока проверки доступа идут раньше по списку курсоров и сами не обращаются к `@Body`. Если повесить билдер тела (`@Before` с параметром `@Body`) раньше авторизации, тело снова читается первым.

```ts
// поднять лимит на конкретном эндпоинте выше глобального
@Post("/import")
@BodyOptions({ limit: 10 * 1024 * 1024 })
static async import(@Body() body: ImportPayload) { /* ... */ }

// снять ограничение глобально (например, за обратным прокси со своим лимитом)
const settings: AomServerSettings = { port: 3000, url: "http://localhost", bodyLimit: 0 };
```

Ответ 413:

```json
{ "message": "AOM_API:ERROR_PAYLOAD_TOO_LARGE", "status": 413 }
```

Evidence: `packages/api/src/server/http.ts` (`Server`) (обёртка `lazy`), (413 в карте статусов — `STATUS_ERROR_MESSAGES`), (`Connection: close`); `packages/api/src/server/body.ts` (`parseJsonBody`, лимит, `BODY_UNREAD`); `packages/api/src/decorators/body-options.ts` (`@BodyOptions`, `BODY_OPTIONS_MARKER`); `packages/api/src/server/types.ts` (`AomServerSettings`); `packages/api/src/responses/error-responses.ts` (`PayloadTooLargeResponse`); тесты `packages/api/test/server.test.ts` («Server: ленивое чтение тела и лимит размера (KI-API-16)»), `packages/api/test/body-options.test.ts`.

### RouteMatcher: путь → RegExp

`RouteMatcher` (не экспортируется) хранит маршруты по методу в нижнем регистре, а скомпилированный шаблон — по строке пути. Шаблон компилирует `compilePath` из `@aom-js/router` (`packages/router/src/common/path.ts`; до 2026-10-15 — `RouteMatcher.compilePath` здесь): одним проходом заменяет сегменты `:name(pattern)` на группу `(pattern)`, а `:name` без шаблона — на `([^/]+)`, попутно собирая имена параметров в порядке их групп; всё остальное экранируется как литерал (`KI-API-19`), результат оборачивается в `^...$`. Та же грамматика проверяет адреса в прогонщике зондов `@aom-js/router/testing`. Компиляция выполняется один раз при регистрации маршрута (`RouteMatcher.addRoute`), а не на каждом запросе. `RouteMatcher.match` перебирает маршруты метода в порядке регистрации и возвращает первый, чей regexp совпал, раскладывая группы по собранным именам параметров.

Evidence: `packages/api/src/server/http.ts` (`RouteMatcher.addRoute`, `RouteMatcher.match`), `packages/router/src/common/path.ts` (`compilePath`); тесты `packages/api/test/server.test.ts` («параметр с валидатором: значение по шаблону попадает в params», «параметр с валидатором: значение не по шаблону -> 404, а не маршрут без параметра»).

### I18nizer

Словари — `Record<locale, Record<code, text>>`. При каждом `addLocalesMap` перестраивается regexp локали: ключи экранируются, сортируются по убыванию длины и склеиваются через `|` с флагом `g` (`i18nizer.ts` (`I18nizer.addLocalesMap`, `I18nizer.buildRegexpMap`)). `localize` выполняет `text.replace(RE, code => dict[code] ?? code)` — то есть подстановка идёт по **уже сериализованной** строке ответа, а не по объекту (`i18nizer.ts` (`I18nizer.localize`)). `defineLocale` берёт первое непустое из `[query[queryKey], headers[headerKey.toLowerCase()]]`, при отсутствии такой локали в словаре откатывается на `defaultLocale`, затем на первую локаль структуры (`i18nizer.ts` (`I18nizer.defineLocale`)).

`packages/api/src/server/i18nizer.ts` (`I18nizer`):

```ts
  constructor(
    private defaultLocale: I18nLocale = I18nizer.DEFAULT_LOCALE,
    private headerKey: string = I18nizer.HEADER_KEY,
    private queryKey: string = I18nizer.QUERY_KEY,
    private localesStruct: I18nLocalesStructure = {},
    init?: I18nizerInitFunction
  ) {
```

Значения по умолчанию читаются из статик в момент вызова конструктора — значит статики обязаны быть выставлены **до** `new I18nizer()`. `Server` при создании добавляет собственные словари пакета (`http.ts` (`Server`)); теперь в них все коды из `constants/messages/errors.ts`, а не 16 из 33, как раньше (`constants/locales/ru/errors.ts`).

Evidence: `packages/api/src/server/i18nizer.ts` (`I18nizer`, `I18nizerInitFunction`, `I18nizerInPath`, `I18nizer.defineLocale`, `I18nizer.localize`, `I18nizer.addLocalesStruct`, `I18nizer.addLocalesMap`, `I18nizer.buildRegexpMap`, `I18nizer.getLocales`, `I18nizer.JSONSchema`); `packages/api/src/server/http.ts` (`Server`).

### Билдеры: схема → контроллер

`XBuilder(schema)` возвращает анонимный класс-наследник базового `XBuilderConstructor` со `static schema = schema` (`builders/body.ts` (`BodyBuilder`), `query-string.ts` (`QueryStringBuilder`), `headers.ts` (`HeadersBuilder`), `cookie.ts` (`CookieBuilder`), `response.ts` (`ResponseBuilder`)). База помечена `@Controller()` и содержит статические middleware, аргументы которых декорированы `@Body/@Query/@Headers/@Cookies/@Params(SafeOrigin)`, где `SafeOrigin = ThisRef(({schema}) => SafeData(schema))` — схема достаётся у реального потомка в момент создания курсора. Описание для OpenAPI навешивается через `@DelayRefStack(SafeOriginParameters)` тем же приёмом. `PlainBuildersBase.JSONSchema` (общая база `HeaderBuildersBase`/`QueryStringBuildersBase`/`CookieBuildersBase`) теперь явно бросает, если `static schema` не задана — раньше на этом месте был отладочный `console.log`, из-за которого ссылка на базовый класс вместо потомка (например, `@Controller()` забыт у наследника) молча отдавала пустую схему (`builders/common.ts` (`PlainBuildersBase.JSONSchema`)); `QueryStringBuilder.NotEmpty` и подобные middleware у других билдеров теперь единообразно `throw`, а не `return`, значение ошибки (`query-string.ts` (`QueryStringBuilder.NotEmpty`), `cookie.ts` (`CookieBuilder.NotEmpty`), `params.ts` (`ParamsBuilder.NotEmpty`)) — на наблюдаемое поведение это не влияет: `RxContext.run` и так останавливает цепочку на любом не-`undefined` результате (`packages/router/src/common/context.ts` (`RxContext.run`)) и перебрасывает возвращённый `Error` как исключение (там же), а `WrongDataResponse` — наследник `Error`.

`packages/api/src/builders/body.ts` (`SafeOrigin`, `BodyBuilderConstructor.Body`):

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

`SafeData` прогоняет данные через `schemer.validate(constructor, data)` и при ошибках бросает `WrongDataResponse(ERROR_WRONG_DATA, errors)` — 400 (`decorators/safe-data.ts` (`SafeData`)). `BodyBuilder.JSONSchema(description)` больше не использует переданный аргумент как флаг: раньше `description ? String(this.description) : ""` подставляло в OpenAPI `static description` потомка вместо переданного текста, а при отсутствии `static description` — строку `"undefined"`; теперь `description ?? this.description ?? ""` (`body.ts` (`BodyBuilder.JSONSchema`)) — переданный текст побеждает, `static description` — запасной вариант, а отсутствие обоих даёт пустую строку (закрытый `KI-API-05`; тесты `packages/api/test/units.test.ts` («BodyBuilder.JSONSchema (KI-API-05)»)). Особенности отдельных билдеров: `HeadersBuilder.Headers` — пустая middleware, которая только регистрирует параметры в OpenAPI и через `@Before` подключает `ImplicitHeaders`, где и происходит валидация (`headers.ts` (`HeadersBuilderConstructor.Headers`, `HeadersBuilderConstructor.ImplicitHeaders`)); `QueryStringBuilder`, `CookieBuilder` и `ParamsBuilder` дополнительно дают `NotEmpty`, бросающую `WrongDataResponse(REQUIRED_DATA_MISSING)` на пустом наборе; `ParamsBuilder` требует компонент-схему ровно с одним свойством и даёт `static toString()`, пригодный как сегмент пути (`params.ts` (`ParamsBuilderConstructor.toString`, `ParamsBuilderConstructor.Params`)); `ResponseBuilder.Response` не делает ничего, кроме регистрации `Responses` (`response.ts` (`ResponseBuilderConstructor.Response`)).

Evidence: `packages/api/src/builders/common.ts` (`PlainBuildersBase`, `PlainBuildersBase.JSONSchema`), `body.ts` (`BodyBuilderConstructor`, `BodyBuilder`), `query-string.ts` (`QueryStringBuilderConstructor`, `QueryStringBuilder`), `headers.ts` (`HeadersBuilderConstructor`, `HeadersBuilder`), `cookie.ts` (`CookieBuilderConstructor`, `CookieBuilder`), `params.ts` (`ParamsBuilderConstructor`, `ParamsBuilder`), `response.ts` (`ResponseBuilderConstructor`, `ResponseBuilder`), `decorators/safe-data.ts` (`SafeBody`, `SafeQuery`, `SafeData`); тесты `packages/api/test/units.test.ts` («BodyBuilder.JSONSchema (KI-API-05)»).

### BaseRootController

`Index` — эндпоинт `@Get()` и одновременно `@Nextpoint()`: берёт `self.routes`, на каждый маршрут создаёт экземпляр `self.RouteElement`, заполняет `method`, `path`, `operationId = route.endpoint.$.toString()`, отдаёт маркеры маршрута в `self.markersToRoute(...)` и складывает всё в `new this.RoutesStructure(ident)` (`root.ts` (`BaseRootController.Index`)). Базовая реализация `markersToRoute` бросает ошибку — наследник обязан её переопределить (`root.ts` (`BaseRootController.markersToRoute`)).

`self.routes` — копия `router.routes`, которую хук `@OnInstance()` `InitRoutes` делает при создании инстанса (`root.ts` (`BaseRootController.InitRoutes`)). Инстанс живёт в состоянии одного запроса, поэтому копия у каждого запроса своя: шаг перед `Index` может её сузить — например, по правам вызывающего, как `ProtectedController.Index` приложения (`test/src/common/controllers/protected.ts` (`ProtectedController.Index`)), — не трогая роутер, общий для всех запросов. Раньше `Index` читал `route.router.routes`, и приложение сужало общий список (`KI-COMMON-04`, закрыт). Тест: `packages/api/test/units.test.ts` («шаг перед Index сужает копию своего запроса, а не общий роутер»).

`packages/api/src/controllers/root.ts` (`BaseRootController.Index`):

```ts
const { ident, routes } = self;
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

`JSONDocs` (`GET /openapi.json`) кэширует `docs.toJSON()` в `static docsJSON` того класса, на котором вызван, а `Swagger` (`GET /swagger.html`) возвращает статическую HTML-строку; оба закрыты `@Before(AuthBasic.Required)` (`root.ts` (`BaseRootController.JSONDocs`, `BaseRootController.Swagger`)). Страница Swagger UI грузит скрипты и стили `swagger-ui-dist@5.34.0` (поддерживает OpenAPI 3.2) с unpkg и обращается к `/openapi.json` по абсолютному пути от корня хоста (`controllers/swagger.ts` (`swagger`)).

Evidence: `packages/api/src/controllers/root.ts` (`BaseRootController`, `BaseRootController.markersToRoute`, `BaseRootController.InitRoutes`, `BaseRootController.Index`, `BaseRootController.JSONDocs`, `BaseRootController.Swagger`); `packages/api/src/controllers/swagger.ts` (`swagger`).

### BaseAccessController

Класс параметризуется четырьмя абстрактными статиками, которые обязан задать наследник: `markerName`, `allowedAccessTypes`, `AccessMarker` (наследник `AomAccessMarkerElement`) и `AccessCore` (наследник `AomAccessCore`) — `access-controller.ts` (`BaseAccessController`). Собственный `enum AccessTypes` в пакете пуст и наружу не экспортируется (`controllers/access/init.ts` (`AccessTypes`)): типы полномочий поставляет приложение.

**Маркировка при сборке.** `Required` несёт `@DelayRefStack(SafeAccessMarker)`, где `SafeAccessMarker = ThisRef(constructor => [UseMarker(constructor.setAccessMark)])` — маркер берётся у реального наследника (`access-controller.ts` (`SafeAccessMarker`, `BaseAccessController.Required`)). `setAccessMark` выполняется один раз на создание маршрута: получает или создаёт `route.markers[markerName]`, читает мета-инстанс `AccessCore` в точке прикрепления курсора, **сужает** список допустимых типов пересечением с уже накопленным (пустое пересечение — старые значения сохраняются) и добавляет точку доступа `{ident, title, extra, method, path}`, если такого `ident` в маркере ещё нет (`access-controller.ts` (`BaseAccessController.setAccessMark`)).

`packages/api/src/controllers/access/access-controller.ts` (`BaseAccessController.setAccessMark`):

```ts
const newAccessTypes = currentAccessControl.accessTypes.length
  ? _.intersection(<string[]>currentAccessControl.accessTypes, <string[]>extraAccessTypes)
  : extraAccessTypes;

currentAccessControl.accessTypes = newAccessTypes.length
  ? newAccessTypes
  : currentAccessControl.accessTypes;
```

**Проверка в рантайме.** `Required` вычисляет `ident` (для эндпоинта — сам эндпоинт, иначе `cursor.origin`) и вызывает `checkAccessPoint`; при отрицательном результате бросает `AccessDenyResponse(ERROR_ACCESS_DENY)` (`access-controller.ts` (`BaseAccessController.Required`)).

**Карта доступа.** `generateAccessMap(allowedAccessTypes, userRoles)` отмечает переданные типы в `activeAccessTypes`, создаёт `AomAccessMapStructure` и сливает в `structure` элементы тех ролей, чей `moduleIdent` совпадает с `this.moduleIdent`, ключуя их по `ident` (пока `this.moduleIdent` не задан, гранты не берутся — иначе грант без ключа `moduleIdent` совпал бы с `undefined`, KI-ORGS-42); `fullAccess` — дизъюнкция по ролям (`access-controller.ts` (`BaseAccessController.generateAccessMap`)).

**Включение.** Единственное место, где `enabled` становится `true`, — middleware `Init` (`access-controller.ts` (`BaseAccessController.Init`)). Пока `Init` не отработал, `enabled === undefined` и `checkAccessPoint` возвращает `true` на первой же строке.

**Декларации на маршрутах.** `TypesRequired(...types)` — комбинированный декоратор: проверяет непустоту списка и вхождение в `allowedAccessTypes`, дописывает типы в мета-инстанс `AccessCore` и навешивает `@Before(this.Required)` (`access-controller.ts` (`BaseAccessController.TypesRequired`)). `SetExtraAccess(...types)` помечает middleware как слой доступа (`extraAccess = true`) и добавляет ей `@Before(CheckLayerPass)`; `ExtraAccess(...middlewares)` проверяет, что каждая переданная middleware — слой, и подключает их через `@Before` (`access-controller.ts` (`BaseAccessController.SetExtraAccess`, `BaseAccessController.ExtraAccess`)).

**`CheckLayerPass`.** В рантайме ищет в `route.cursors` ближайший курсор своего слоя после текущего и выставляет `self.layerPassed` по наличию `extra`-идентификатора в `accessMap.structure[originIdent].extra` (грант точки без `extra` — непройденный слой, а не `TypeError`; проверено на настоящем роутере — `test/units.test.ts`, describe «BaseAccessController: экстра-слой на настоящем роутере»). Раньше точка доступа и сам слой доставались через `const [{ ... }] = array.filter(...)` без проверки на пустой массив — если маркер маршрута не содержал искомый `ident` (например, из-за несовпадения идентификаторов в `TypesRequired`/`ExtraAccess`), деструктуризация пустого массива бросала `TypeError` вместо предсказуемого отказа. Теперь `accessPoints.find(...)`/`extra.find(...)` с явным `if (!found) return` на каждом шаге (`self.layerPassed` остаётся `false`) — закрытый `KI-API-13`.

`packages/api/src/controllers/access/access-controller.ts` (`BaseAccessController.CheckLayerPass`):

```ts
const accessPoint = routeAccessControl.accessPoints.find((value) => value.ident === originIdent);
if (!accessPoint) return;
const { extra = [] } = accessPoint;

const extraPoint = extra.find((value) => value.ident === extraIdent);
if (!extraPoint) return;
const { accessTypes } = extraPoint;
```

Как приложение строит карту доступа из ролей организации — `test/docs/principles.md` §«Доступ».

Evidence: `packages/api/src/controllers/access/access-controller.ts` (`BaseAccessController`, `BaseAccessController.checkAccessPoint`, `BaseAccessController.generateAccessMap`, `BaseAccessController.Init`, `BaseAccessController.TypesRequired`, `BaseAccessController.SetExtraAccess`, `BaseAccessController.CheckLayerPass`, `BaseAccessController.ExtraAccess`, `BaseAccessController.Required`, `BaseAccessController.setAccessMark`); `controllers/access/types.ts` (`AomAccessCore`, `ActiveAccessTypes`, `IAomAccessPoint`); `controllers/access/schemas.ts` (`AomAccessToModulesStructure`, `AomAccessMarkerElement`); `controllers/access/init.ts` (`AccessTypes`); тесты `packages/api/test/units.test.ts` («BaseAccessController.CheckLayerPass (KI-API-13)»).

### Auth-middleware

`AuthBasic.Required` разбирает заголовок `Authorization`, и только если задан `static BASIC_AUTH`, выставляет `WWW-Authenticate: Basic` и сверяет вторую часть заголовка с base64 от `BASIC_AUTH`; иначе middleware не делает ничего (`auth/basic.ts` (`AuthBasic.Required`)). `AuthHeaderToken.Required` перебирает `HEADERS_KEYS` (по умолчанию `['authorization']`), первое найденное значение разбивает по пробелу в `self.type`/`self.value` и бросает `AUTH_NO_TOKEN` либо `AUTH_WRONG_TOKEN_TYPE` (`auth/headerToken.ts` (`AuthHeaderToken.Required`)). `AuthCookieToken.Required` читает `cookies[COOKIE_NAME]` и бросает `AUTH_NO_COOKIE`; имя cookie попадает в security-схему OpenAPI через `ThisRef` + `DelayRefStack` (`auth/cookieToken.ts` (`SafeSecuritySchema`, `AuthCookieToken.Required`)). Все три бросают `AuthRequiredResponse` (401).

Evidence: `packages/api/src/controllers/auth/basic.ts` (`AuthBasic`, `AuthBasic.Required`), `headerToken.ts` (`AuthHeaderToken`, `AuthHeaderToken.Required`), `cookieToken.ts` (`SafeSecuritySchema`, `AuthCookieToken.Required`).

### Ответы и ошибки

`ErrorMessage extends Error` и одновременно `@ComponentSchema`: `status` берётся из аргумента или из `static status` конструктора, `toJSON()` отдаёт `{message, status, data}`, `static JSONSchema(description)` строит описание ответа через `responseJsonSchema(this, description, this.status)` (`responses/error-message.ts` (`ErrorMessage`)). Наследники добавляют только статусы и описания через промежуточный `ErrorWithStatusResponse` с сигнатурой `(message, data?)` (`responses/error-responses.ts` (`ErrorWithStatusResponse`)).

| Класс                      | status | Описание (`static description`)                            |
| -------------------------- | ------ | ---------------------------------------------------------- |
| `SeeOtherResponse`         | 303    | `SEE_OTHER_RESPONSE`                                       |
| `WrongDataResponse`        | 400    | `ERROR_WRONG_DATA`                                         |
| `AuthRequiredResponse`     | 401    | `ERROR_AUTH_REQUIRED`                                      |
| `PaymentRequiredResponse`  | 402    | `PAYMENT_REQUIRED`                                         |
| `AccessDenyResponse`       | 403    | `ERROR_ACCESS_DENY`                                        |
| `NotFoundResponse`         | 404    | `ERROR_NOT_FOUND`                                          |
| `ConflictResponse`         | 409    | `ERROR_CONFLICT`                                           |
| `PayloadTooLargeResponse`  | 413    | `ERROR_PAYLOAD_TOO_LARGE`                                  |
| `LockedResponse`           | 423    | `ERROR_DATA_LOCKED` (было — чужое `ERROR_WRONG_DATA`)      |
| `FailedDependencyResponse` | 424    | `ERROR_WRONG_DEPENDENCY` (было — чужое `ERROR_WRONG_DATA`) |
| `ServerErrorResponse`      | 500    | `SERVER_ERROR`                                             |
| `ErrorMessage`             | 500    | `ERROR_MESSAGE`                                            |

`API_ERROR_423_DATA_LOCKED` теперь действительно равен `AOM_API:API_ERROR_423_DATA_LOCKED` — раньше `PREFIX('API_ERROR_432_DATA_LOCKED')` давал значение с чужим номером и код было невозможно найти в словарях (закрытый `KI-API-06`; тесты `packages/api/test/units.test.ts` («коды и описания 423/424 (KI-API-06)»)). Успешные ответы наследуют `ResponseJSONSchema` → `CommonResponse` (`static status = 200`): `MessageResponse {message?}`, `DataResponse {message?, data?}`, `NumberResponse`/`BooleanResponse`/`StringResponse {value}` (`responses/data-responses.ts`). `responseJsonSchema` подставляет `status || 200` и трактует массив в `description` как признак `isArray` (`functions/json-schema.ts` (`responseJsonSchema`)).

Evidence: `packages/api/src/responses/error-message.ts` (`ErrorMessage`), `error-responses.ts`, `data-responses.ts`; `packages/api/src/functions/json-schema.ts` (`responseJsonSchema`); `packages/api/src/constants/messages/errors.ts`.

### IDController / UUIDParam

`IDValue(attr, Schema)` создаёт наследника `IDController` со `static attr` и `static pattern = new Schema()`; `toString()` возвращает `pattern.format(attr)`, то есть сегмент `:attr(regexp)`, пригодный для интерполяции в `@Bridge`/`@Get` (`id-value/controller.ts` (`IDValue`, `IDController.toString`); `id-value/schemas.ts` (`ParamIDSchema`)). `UUIDParam`/`MongoIDParam`/`NanoIDParam`/`NumberIDParam` — обёртки над соответствующими шаблонами (`controller.ts` (`UUIDParam`, `MongoIDParam`, `NanoIDParam`, `NumberIDParam`)).

`PathID`/`QueryID`/`HeaderID` регистрируют описание параметра в OpenAPI и через `@After` вызывают `PathValue`/`QueryValue`/`HeaderValue`, которые копируют источник в `self.source`, а затем `Assign` кладёт `self.value = self.source[attr]`. Никакой дополнительной проверки значения на этом пути нет — валидность обеспечивается regexp самого маршрута (тем же, что компилирует `RouteMatcher.compilePath` — см. `KI-API-01`).

Evidence: `packages/api/src/controllers/id-value/controller.ts` (`PathRefParams`, `RefParams`, `IDController`, `IDController.PathID`, `IDController.QueryID`, `IDController.HeaderID`, `IDController.Assign`, `IDController.toString`, `IDController.param`, `IDController.JSONSchema`, `IDValue`, `UUIDParam`, `MongoIDParam`, `NanoIDParam`, `NumberIDParam`); `id-value/schemas.ts` (`ParamIDSchema`, `NanoIDSchema`, `UUIDSchema`).

### Logger

`Logger.Init` вешает один и тот же обработчик на события `finish` и `error` объекта `res`: фиксирует `finishDate`, `status = res.statusCode`, `lifetime`/`duration` и пишет в `ENGINE.error` либо `ENGINE.info`; попутно кладёт себя в контекст (`Object.assign(ctx, { log: self })`) — `logger/logger.ts` (`Logger.Init`). `Attach` запоминает класс-владелец курсора как `LoggerAttachments`, чей `toJSON()` вернёт мета-инстанс на момент сериализации лога (`logger.ts` (`Logger.Attach`)); `Watch` пишет отладочный фрагмент по текущему курсору (`logger.ts` (`Logger.Watch`)). `ENGINE` по умолчанию — `console` (`logger.ts` (`Logger.ENGINE`)).

Evidence: `packages/api/src/controllers/logger/logger.ts` (`LoggerAttachments`, `Logger`, `Logger.Init`, `Logger.Attach`, `Logger.Watch`).

### WebSocket-точки

Каталог `controllers/events` входит в публичный вход пакета (`packages/api/src/controllers/index.ts`): `AomWebSockets`, `WebSocketsController`, `Ws` и реэкспорт `WebSocket` из `ws` (`packages/api/src/controllers/events/websockets.ts` (`WebSocket`)).

**Как объявить точку.** Контроллер держит реестр соединений в статическом поле `static sockets = new AomWebSockets(onMessage)` и объявляет точку `@WebSocketPoint(path)` с `@Before(<id-middleware>)`. id-middleware — обычный `@Middleware()` приложения с `@Before(WebSocketsController.Define)` и `@After(WebSocketsController.Connect)`: он берёт `@This(WebSocketsController)` и выставляет `ws.id` — ключ, под которым соединение попадёт в реестр. Id выставляет приложение, не пакет: готовые варианты `Init`, `AuthorizedInit`, `Param` закомментированы (§«Легаси и мёртвый код»). В приложении ключ — id сотрудника организации или id тикета (`test/src/modules/orgs/api/routes/permissions/socket.ts` (`MyPermissionsSocket.OrgUserID`), `test/src/modules/tickets/api/routes/tickets/socket.ts` (`TicketSocket.TicketID`)).

**Порядок шагов.** Обработчик `upgrade` в `Server` сопоставляет путь с `router.sockets` и исполняет цепочку маршрута (`packages/api/src/server/http.ts` (`Server`)):

1. гейт доступа — классовый `@Before` контроллера точки или его родителя по бриджу;
2. `WebSocketsController.Define` — проверяет, что у контроллера точки `sockets` — экземпляр `AomWebSockets`, иначе бросает `CONTROLLERS_WEBSOCKETS_WRONG_TARGET`; один раз на маршрут кладёт обёртку рукопожатия в `WebSocketsController.wssMap`;
3. id-middleware приложения — выставляет `ws.id`;
4. `WebSocketsController.Connect` — при пустом `id` разрывает соединение (`socket.destroy()`); иначе завершает рукопожатие через `ws`, регистрирует сокет (`sockets.connect(id, socket)`), подписывает приём сообщений на `onMessage(id, socket, data)` и снятие с регистрации на закрытие (`sockets.disconnect(id, socket)`);
5. тело точки — рукопожатие уже завершено, сокет в реестре; значение, которое тело возвращает, никуда не отправляется.

Исключение на любом шаге ловит обработчик `upgrade` и разрывает соединение (`socket.destroy()`): HTTP-ответа клиент не получает, сервер продолжает работать. Исключение в теле точки разрывает уже открытое соединение.

**Приём сообщений.** `onMessage` вызывается с `this = null`, поэтому обработчик обращается к реестру по имени класса, а не через `this`; текстовый кадр приходит строкой. Исключение или отклонённый промис обработчика пишется в `console.error`, соединение остаётся открытым — раньше оно уходило в необработанный reject и могло уронить процесс (`websockets.ts` (`WebSocketWrapper.handle`)).

**Отправка.** Соединения живут в памяти процесса: `sockets.send(id, data)` и `sockets.broadcast(data)` достают только сокеты этого экземпляра сервера. Поэтому сигнал из других модулей шлют через шину: изолятор `@Isolator(transfer)` с методом `@CustomTopic()`, а контроллер точки помечен `@Executor()` и наследует изолятор — его реализация метода вызывает `this.sockets.send(...)` или `broadcast(...)` (`test/src/modules/orgs/isolators/permissions-socket.ts` (`PermissionsSocketIsolator.TotalUnread`), `test/src/modules/orgs/api/routes/permissions/socket.ts` (`MyPermissionsSocket.TotalUnread`)). Метод без `@IsQueue`: такое сообщение получает каждый экземпляр-исполнитель и шлёт своим соединениям; с `@IsQueue` его взял бы один экземпляр, и клиенты остальных сигнала не увидели бы. Не `@CustomTopic(true)`: синглтон склеивает одновременные вызовы с одинаковыми аргументами в один, и два одинаковых сигнала подряд дошли бы одним. Механика шины — `packages/transfer/readme.md`.

**Особенности.**

- Браузерный `WebSocket` не умеет ставить заголовки рукопожатия — они передаются подпротоколом, тем же объектом, что у `fetch`, только встроенными функциями: `new WebSocket(url, [encodeURIComponent(JSON.stringify(headers))])`. Обработчик `upgrade` разворачивает подпротокол в обычные заголовки контекста до цепочки точки, дальше гейты (`AuthHeaderToken`, заголовки приложения) читают их как обычные (`packages/api/src/server/protocol-headers.ts` (`protocolHeaders`), `packages/api/src/server/http.ts` (`Server`)). Правила: каждый элемент `Sec-WebSocket-Protocol`, который раскодируется в JSON-объект, даёт свои строковые значения, битые элементы пропускаются; имена — в нижнем регистре (как у настоящих заголовков `node:http`), из одинаковых в разном регистре побеждает последний; настоящий заголовок запроса побеждает развёрнутый; `AomServerSettings.protocolHeaders` перечисляет извлекаемые имена без учёта регистра, не задан — извлекается всё, `[]` — ничего. «Всё» не даёт клиенту больше, чем у него есть: не браузерный клиент ставит любые заголовки сам, а обязательные заголовки браузера (`origin`, `host`) побеждают как настоящие; `cookies` контекста берутся из настоящего `cookie`. Ограничение: `encodeURIComponent` не кодирует `(` и `)`, а в токене подпротокола они запрещены — значение со скобками браузер не отправит (`SyntaxError`); токены и id скобок не содержат. Сервер отвечает первым предложенным элементом (`ws` без `handleProtocols`), браузеру этого достаточно.
- Точки сокетов не попадают в OpenAPI (`KI-ROUTER-06`).
- `disconnect` последнего сокета оставляет под id пустой массив: ключ из `connections` не удаляется, `send`/`broadcast` по нему ничего не шлют.
- Экспорт по умолчанию `websockets.ts` (общий `new AomWebSockets()`) через `export *` не реэкспортируется и из пакета недоступен.

Evidence: `packages/api/src/controllers/events/websockets.ts` (`AomWebSockets`, `WebSocketsController.Define`, `WebSocketsController.Connect`, `WebSocketWrapper.handle`); `packages/api/src/server/protocol-headers.ts` (`protocolHeaders`); тесты `packages/api/test/websockets.test.ts`, `packages/api/test/protocol-headers.test.ts`.

### SSE-ссылки

Server-Sent Events — поток событий сервера по обычному HTTP GET. В отличие от WebSocket-точки, SSE-ссылка — обычный `@Get` в общем дереве маршрутов: проходит гейты, `@Before`, `@This` как любой GET, попадает в OpenAPI и в дамп цепочек. Своего декоратора и middleware-контроллера нет.

**Как объявить ссылку.** Контроллер держит реестр потоков `static events = new AomServerEvents({ unread: UnreadEvent })` — словарь «тип события → класс `@ComponentSchema` его значения» (ключ `type` занят конвертом — ошибка в конструкторе) — и возвращает из обработчика `this.events.connect(id, res)`; `id` — ключ соединения приложения (например, id сотрудника), `res` — из `@Ctx()`:

```ts
// псевдокод
@Controller()
class Events {
  static events = new AomServerEvents({ unread: UnreadEvent }); // { heartbeat?, retry?, validate? }

  @Get("/events")
  @Responses(Events.events.JSONSchema("Счётчик непрочитанного"))
  static Connect(@This(CurrentOrg) { orgUser }: CurrentOrg, @Ctx() { res }: HttpCtx) {
    return this.events.connect(orgUser.id, res);
  }
}
```

**`connect(id, res)`** (`packages/api/src/controllers/events/sse.ts` (`AomServerEvents.connect`)): ставит заголовки `Content-Type: text/event-stream; charset=utf-8`, `Cache-Control: no-cache`, `Connection: keep-alive`, `X-Accel-Buffering: no` (`Server` свой тип не подставляет, раз тип уже задан); создаёт `PassThrough` и кладёт первый кадр — `retry: <мс>`, если задан `retry`, иначе комментарий `: connected` (заголовки уходят сразу, клиент видит открытие); регистрирует поток под `id`, ставит heartbeat — комментарий `: ping` каждые `heartbeat` мс (по умолчанию 25000, `0` — выключен; таймер `unref`, против обрыва простаивающего соединения прокси: у nginx `proxy_read_timeout` 60 с); по `close` потока снимает таймер и поток с реестра. `Server` пайпит поток в ответ (§«Конвейер HTTP-запроса (Server)»); уход клиента разрушает поток, и он снимается сам.

**Конверт.** Событие — конверт `{ type, [type]: значение }`: `{ "type": "unread", "unread": { "total": 2 } }`. Клиент для любого события делает одно и то же — берёт `type` и значение `value[value.type]`. Конверт собирает реестр, не отправитель; тип для сервера и клиента — `EventEnvelope<E>` (`packages/api/src/controllers/events/sse.ts` (`EventEnvelope`)): объединение `{ type: K } & { [K]: InstanceType<E[K]> }` по ключам словаря.

**Кадр** (`formatServerEvent`): `id: <eventId>`, если задан, `data: <JSON конверта>` и пустая строка; строки `event:` нет — тип едет внутри `data`, клиент слушает обычные сообщения (`onmessage`). `JSON.stringify` экранирует переводы строк, поэтому `data` всегда одной строкой; перевод строки в `eventId` — ошибка (сломал бы кадр).

**Отправка.** `send(id, type, value, eventId?)` собирает конверт и пишет кадр всем потокам `id` (неизвестный `id` — ничего), `broadcast(type, value, eventId?)` — всем потокам всех `id`; `disconnect` последнего потока удаляет ключ. Типы `type` и `value` берутся из словаря реестра. Готовый конверт (например, пришедший по шине) — `sendEnvelope(id, envelope, eventId?)`/`broadcastEnvelope(envelope, eventId?)`. Каждая отправка проверяет конверт (`AomServerEvents.frameOf`) и бросает у отправителя, кадр не уходит: `type` нет в словаре, значение под ключом `type` — `undefined`/`null`, в конверте есть ключи, кроме `type` и `envelope.type`. С опцией `validate` (по умолчанию `process.env.NODE_ENV !== "production"`) значение ещё проверяется по своему классу — `Schemer.validate` (`plainToInstance` + class-validator); ошибка проверки — тоже исключение у отправителя. С проверкой в кадр уходит значение, приведённое к классу: поля без правил отсекаются (`whitelist`), поэтому отправителю можно передать полную строку из базы, не собирая значение руками; объект отправителя не меняется. Где это нужно и в production, опция задаётся явно: `new AomServerEvents(schemas, { validate: true })` (`sse.ts` (`AomServerEvents.frameOf`)). Потоки живут в памяти процесса, поэтому из других процессов — как у сокетов: изолятор `@Isolator(transfer)` с методом `@CustomTopic()` без `@IsQueue` (сигнал получает каждый экземпляр) и без `@CustomTopic(true)` (склейка одинаковых сигналов), контроллер ссылки — `@Executor()` этого изолятора (§«WebSocket-точки», «Отправка»).

**Описание в OpenAPI.** `AomServerEvents.JSONSchema(description, status = 200)` возвращает ответ `{ status, description, events: schemas }` для `@Responses` — тот же словарь, что типизирует `send`, поэтому документ и отправка не расходятся. Роутер пишет его как `text/event-stream` с `itemSchema` OpenAPI 3.2 — один вариант, у которого `data` — конверт (`type` — `enum` ключей словаря, по свойству на ключ), — и `schema` — массивом таких событий (`main/packages/router/readme.md`, «Сборка OpenAPI»).

**Особенности.**

- Клиент — fetch-клиент SSE с заголовками (например, `@microsoft/fetch-event-source`): токен и организация приходят заголовками, как у любого GET. Браузерный `EventSource` заголовков не ставит и не поддерживается (`KI-AUTH-10`).
- Права проверяются один раз, при подключении: отозванный доступ живёт до переподключения.
- Буфера повторной доставки по `Last-Event-ID` нет: `eventId` передаётся как есть, пропущенное приложение дочитывает само (заголовок — через `@Headers`).
- Медленный клиент: `PassThrough` копит кадры без предела (`KI-API-22`).
- `requestTimeout` Node долгий GET не рвёт — он касается приёма запроса, а GET без тела принят сразу; `server.close()` ждёт открытые потоки — при остановке и в тестах `closeAllConnections()`.
- Браузер по HTTP/1.1 держит около 6 соединений на домен на все вкладки: одна SSE-ссылка на клиентское приложение, к клиенту — HTTP/2 на прокси. Словарь центральной ссылки — объединение словарей модулей (`{ ...permissionsEvents, ...ticketsEvents }`), типы уникальны — с префиксом модуля (`permissions.unread`).
- Экземпляра по умолчанию нет: без словаря событий теряется типизация.
- Примеры в приложении: общая точка `GET /api/events` модуля notifications (`test/src/modules/notifications/api/routes/events.ts` (`NotificationsEvents`), изолятор `test/src/modules/notifications/isolators/events.ts` (`NotificationsEventsIsolator`); описание — `test/docs/modules/notifications.md#общая-sse-точка`).

Evidence: `packages/api/src/controllers/events/sse.ts` (`AomServerEvents`, `formatServerEvent`, `EventEnvelope`), `packages/api/src/server/http.ts` (`Server`); тесты `packages/api/test/server-events.test.ts`.

## Инварианты и подводные камни

- Глобальные статики конфигурируются **до** сборки роутера и до создания зависимых объектов: `I18nizer.DEFAULT_LOCALE`/`HEADER_KEY`/`QUERY_KEY` — до `new I18nizer()`, `AuthBasic.BASIC_AUTH`, `AuthHeaderToken.TOKEN_NAME`/`HEADERS_KEYS`, `AuthCookieToken.COOKIE_NAME`, `Logger.ENGINE` — до первого запроса.
- Класс-потомок билдера обязан быть помечен `@Controller()`, иначе его middleware не привяжутся к нему как к отдельному узлу и `ThisRef` вернёт схему базового класса — теперь это не молчит: `PlainBuildersBase.JSONSchema` бросит `schema is not defined for <name>` (`test/src/modules/orgs/api/routes/orgs/init/body.ts` (`SubOrgBody`); тест паттерна — `packages/router/test/inherited-static-refs.test.ts` (`BuilderBase`, `Builder`, `ChildQuery`)).
- Абстрактные статики базовых контроллеров объявлены как `static readonly x: T;` без значения; наследник обязан задать их все: для `BaseAccessController` — `markerName`, `allowedAccessTypes`, `AccessMarker`, `AccessCore`; для `BaseRootController` — `ident`, `docs`, `RoutesStructure`, `RouteElement` и переопределённый `markersToRoute` (`packages/api/src/controllers/access/access-controller.ts` (`BaseAccessController`), `packages/api/src/controllers/root.ts` (`BaseRootController`)).
- Валидация всегда проходит через `Schemer.validate`; class-validator-декораторы задаются в компонент-схеме опцией `decorators` — см. `packages/schemer/readme.md`.
- Коды сообщений пакета имеют вид `AOM_API:<NAME>` (`constants/messages/prefix.ts` (`PREFIX`, `PREFIX_VALUE`)); клиенту уходит код, текст подставляет локализатор. Теперь у всех кодов `messages/errors.ts` есть перевод на `ru` и `en` — `checkLocales` сравнивает _значения_ модуля кодов (сами коды `AOM_API:...`) с _ключами_ словаря (которые и есть эти коды), а не имена экспортов с ключами, как раньше.
- Тело запроса разбирается лениво (см. §«Ленивое тело запроса и лимит размера») и только при заголовке `content-type`, где часть до первого `;` (без учёта регистра) равна `application/json` — `application/json; charset=utf-8` и `Application/JSON` распознаются; `multipart/form-data` по-прежнему не разбирается, `files` и `session` в контексте всегда пусты (`server/body.ts` (`parseJsonBody`), `server/http.ts` (`Server`)). Тело копится в `Buffer`-чанках и склеивается один раз через `Buffer.concat`, а не конкатенацией decode-нутых строк по кускам — иначе многобайтовый UTF-8 символ, разрезанный ровно на границе TCP-чанков, портился бы (`server/body.ts` (`parseJsonBody`)). Лимит размера — `@BodyOptions` маршрута → `AomServerSettings.bodyLimit` → `DEFAULT_BODY_LIMIT` (1 МиБ); `0` на любом из трёх уровней снимает ограничение (закрыт `KI-API-16`).
- `cookies` парсятся через `split(";")` и `split("=")` — значение, содержащее `=`, обрезается по первому вхождению (`http.ts` (`Server.parseCookies`)).
- `Server.routesAmount` — статический счётчик, общий для всех экземпляров `Server` в процессе (`http.ts` (`Server.routesAmount`)).
- Подстановка локализованных текстов идёт по сериализованной строке ответа целиком, поэтому код вида `AOM_API:...`, попавший в пользовательские данные, тоже будет заменён (`i18nizer.ts` (`I18nizer.localize`)).
- Разбор адреса запроса фиксирует хост константой и не даёт `//`, `\` или абсолютной форме подменить маршрут; префикс из `settings.url` по-прежнему приклеивается, а фрагмент после `#` отбрасывается до разбора пути/query — все три свойства проверены тестами (`packages/api/test/server.test.ts` («Аудит безопасности: хост из запроса не должен участвовать в сопоставлении маршрута (MEDIUM)», «Аудит безопасности: обратный слэш (\) WHATWG считает тем же "/" - хост всё равно не подменяется», «Фрагмент (#) отбрасывается до разбора пути, как раньше»)).
- `es-toolkit` используется как `es-toolkit/compat` (`_.each`, `_.merge`, `_.keyBy`, `_.intersection`, `difference`) — `access-controller.ts` (`_`), `functions/check-locales.ts` (`difference`). `class-validator`/`class-transformer` импортируются в `decorators/*`, но в `dependencies` пакета не объявлены (`packages/api/package.json` (`dependencies`)) и разрешаются из корня монорепо.

### Известные дефекты

> ✅ `KI-API-01` (закрыт 2026-09-21): второй проверки параметров по отдельным валидаторам больше нет — `RouteMatcher` хранит только скомпилированный шаблон пути и имена параметров, карта `paramValidators` удалена вместе с проверкой. Проверка была одновременно избыточной и написанной с ошибкой: паттерн валидатора вшит в общий regexp пути, поэтому несоответствующее значение отсекается ещё на `path.match(pattern)`, а `return null` внутри `forEach` выходил только из колбэка — если бы шаблон и список валидаторов когда-нибудь разошлись, параметр молча пропал бы из `params` вместо отклонения маршрута.
> Evidence: `packages/api/src/server/http.ts` (`compilePath` из `@aom-js/router` — валидатор внутри общего `pattern`; `RouteMatcher.match` — только раскладка групп по именам); тесты `packages/api/test/server.test.ts` («параметр с валидатором: значение по шаблону попадает в params», «параметр с валидатором: значение не по шаблону -> 404, а не маршрут без параметра»).

> ✅ `KI-API-02` (закрыт): тело запроса теперь разбирается и при `content-type: application/json; charset=utf-8`, и при любом регистре типа (`Application/JSON`); битый JSON даёт `400 ERROR_WRONG_DATA`, а не падение. `multipart/form-data` по-прежнему не поддержан.
> Evidence: `packages/api/src/server/body.ts` (`parseJsonBody` — сравнение части до `;`, приведённой к нижнему регистру; логика переехала сюда при переводе тела на ленивый разбор, `KI-API-16`); тесты `packages/api/test/server.test.ts` («KI-API-02: content-type с параметрами и битый JSON»).

> ✅ `KI-API-03` (закрыт): обычный `Error` теперь уходит клиенту как код готового ответа (`SERVER_ERROR` или код по `err.status`, если он в диапазоне 400-599), а не пустой `{}`; `404` отдаётся с `Content-Type: application/json`; поток пайпится через `Stream.pipeline` с заголовком по умолчанию и корректным обрывом источника при ошибке/разрыве соединения.
> Evidence: `packages/api/src/server/http.ts` (`Server`); тесты `packages/api/test/server.test.ts` («404: ответ приходит с Content-Type application/json», «KI-API-03: единый catch и потоки»).

> ✅ `KI-API-04` (закрыт): `checkLocales` теперь сравнивает значения `source` (сами коды `AOM_API:...`) с ключами `target` (словарём) через `difference` из `es-toolkit/compat`, а не имена экспортов с чужими ключами.
> Evidence: `packages/api/src/functions/check-locales.ts` (`checkLocales`); тесты `packages/api/test/units.test.ts` («checkLocales (KI-API-04)»). При импорте `constants/locales/{ru,en}/errors.ts` консоль больше не печатает список ключей — все коды переведены на обе локали.

> ✅ `KI-API-05` (закрыт): `BodyBuilder.JSONSchema(description)` больше не использует аргумент как флаг — `description ?? this.description ?? ""`.
> Evidence: `packages/api/src/builders/body.ts` (`BodyBuilder.JSONSchema`); тесты `packages/api/test/units.test.ts` («BodyBuilder.JSONSchema (KI-API-05)»).

> ✅ `KI-API-06` (закрыт): опечатка в значении `API_ERROR_423_DATA_LOCKED` (было `AOM_API:API_ERROR_432_DATA_LOCKED`) исправлена; `LockedResponse` и `FailedDependencyResponse` получили собственные описания (`ERROR_DATA_LOCKED`/`ERROR_WRONG_DEPENDENCY`) вместо общего чужого `ERROR_WRONG_DATA`.
> Evidence: `packages/api/src/constants/messages/errors.ts` (`API_ERROR_423_DATA_LOCKED`, `API_ERROR_424_WRONG_DEPENDENCY`); `packages/api/src/responses/error-responses.ts` (`LockedResponse`, `FailedDependencyResponse`); тесты `packages/api/test/units.test.ts` («коды и описания 423/424 (KI-API-06)»).

> ✅ `KI-API-08` (закрыт): `Access-Control-Allow-Headers` теперь отражает `access-control-request-headers` браузерного preflight, если он прислан; без него остаётся прежний дефолт `Content-Type,Authorization`. `Access-Control-Allow-Origin: *` по-прежнему захардкожен.
> Evidence: `packages/api/src/server/http.ts` (`Server`); тесты `packages/api/test/server.test.ts` («KI-API-08: CORS-заголовки»).

> ℹ️ Особенности (открыты, решения автора, `KI-API-10`): набор мелких особенностей эксплуатации, не настраиваемых снаружи: `Server.listen` вызывается прямо в конструкторе, что не даёт отложить старт после создания объекта — `http.ts` (`Server`) (это не мешает поднять сервер на свободном порту: `port: 0` + `server.address()` работает и используется тестами, `packages/api/test/server.test.ts` («Server: HTTP-конвейер (KI-API-02, 03, 08, 12)»)); `Server.routesAmount` общий на процесс — `http.ts` (`Server.routesAmount`); `AuthBasic.Required` при незаданном `BASIC_AUTH` пропускает всех, то есть `/openapi.json` и `/swagger.html` открыты — `auth/basic.ts` (`AuthBasic.Required`); страница `/swagger.html` тянет ассеты с unpkg и офлайн не работает — `controllers/swagger.ts` (`swagger`).
> Как обходить: задавать `BASIC_AUTH` в окружении публикуемого сервиса (в приложении пара берётся из окружения, в профиле разработки не задана — `KI-BOOT-04`). См. `KI-API-10`.

> ✅ `KI-API-18` (закрыт 2026-09-21): уровень закрывающей записи `Logger.Init` теперь следует классу статуса, а не точному коду: `info` для 1xx-3xx (включая `201`, `204`, `303`), `warn` для 4xx — ошибка на стороне клиента, `error` только для 5xx — отказ самого сервиса. Раньше ошибкой считался любой статус, кроме 200, из-за чего доля ошибок в логах ничего не значила.
> Evidence: `packages/api/src/controllers/logger/logger.ts` (`Logger.Init`); тесты `packages/api/test/server.test.ts` («200 - info», «303 - info, а не error: успешный, но не 200 ответ больше не считается ошибкой», «409 - warn: ошибка на стороне клиента, а не сервиса», «500 - error»).

> ✅ `KI-API-19` (закрыт 2026-09-21): всё, что в шаблоне пути не является параметром, теперь экранируется — шаблон остаётся путём, а не превращается в собственное регулярное выражение. Раньше экранировался только `/`, поэтому маршрут `/file.json` совпадал и с `/fileXjson`; то же касалось любого другого спецсимвола (`+`, `*`, `?`, скобок). Шаблон валидатора у параметра — единственное место, где синтаксис regexp задуман буквально, и он разбирается отдельной веткой до экранирования.
> Evidence: `packages/router/src/common/path.ts` (`compilePath`); тесты `packages/api/test/server.test.ts` («точка в пути маршрута - обычный символ: /file.json совпадает», «точка в пути маршрута не подменяет собой любой символ: /fileXjson -> 404 (KI-API-19)»).

> ✅ `KI-COMMON-01` (закрыт): было — приложение не подключало `AccessController.Init`, и все `Required`/`TypesRequired` пропускали любого аутентифицированного (до `Init` проверка выключена — абзац «Включение» выше); теперь `Init` — первый классовый `@Before` `ProtectedController`.
> Evidence: `test/src/common/controllers/protected.ts` (`ProtectedController`); тест `test/src/modules/orgs/api/routes/init/routes.test.ts` («контроль доступа включается первым в каждом маршруте API (KI-COMMON-01)»).

> ⚠️ Дефект (открыт): локализация ответов приложения фактически не работает — `Server` вливает в локализатор только собственные словари пакета, а приложение создаёт `new I18nizer()` без словарей.
> Evidence: `packages/api/src/server/http.ts` (`Server`); `test/src/modules/orgs/api/init.ts` (`i18nizer`).
> Последствия: клиент получает коды сообщений приложения как есть; из кодов ядра теперь переводятся все 35 (было 16 из 33).
> Как обходить: передавать словари приложения через `addLocalesStruct` до старта сервера. См. `KI-COMMON-02`.

> ✅ `KI-API-12` (закрыт): `OPTIONS` теперь сначала ищет маршрут и только при его отсутствии отвечает дефолтным `204`; собственный `@Options()`-эндпоинт исполняется.
> Evidence: `packages/api/src/server/http.ts` (`Server`) (поиск маршрута — до ветки `OPTIONS`); тесты `packages/api/test/server.test.ts` («KI-API-12: OPTIONS сначала ищет маршрут»).

> ✅ `KI-API-13` (закрыт): `CheckLayerPass` больше не деструктурирует результат `filter` без проверки — `find()` с явным `if (!found) return` на каждом шаге.
> Evidence: `packages/api/src/controllers/access/access-controller.ts` (`BaseAccessController.CheckLayerPass`); тесты `packages/api/test/units.test.ts` («BaseAccessController.CheckLayerPass (KI-API-13)»).

> ✅ `KI-API-16` (закрыт): тело запроса теперь читается лениво (не раньше первого `@Body` в цепочке маршрута — до этого поток не трогается вовсе) и с лимитом размера: маркер маршрута `@BodyOptions` → `AomServerSettings.bodyLimit` → `DEFAULT_BODY_LIMIT` (1 МиБ), `0` снимает ограничение. Превышение — `413 PayloadTooLargeResponse`; отказ по заявленному `Content-Length` не требует закрывать соединение, отказ по ходу чтения (chunked) несёт `Connection: close`. Подробности и примеры — §«Ленивое тело запроса и лимит размера».
> Evidence: `packages/api/src/server/http.ts` (`Server`); `packages/api/src/server/body.ts` (`parseJsonBody`); `packages/api/src/decorators/body-options.ts` (`BodyOptions`, `BODY_OPTIONS_MARKER`); тесты `packages/api/test/server.test.ts` («Server: ленивое чтение тела и лимит размера (KI-API-16)»), `packages/api/test/body-options.test.ts`.

> ✅ `KI-API-17` (закрыт): строковый результат обработчика теперь уходит клиенту как `text/plain; charset=utf-8`, а не `text/html` — отражённая XSS через голую строку больше не сработает. Обработчику, которому нужен настоящий HTML, достаточно выставить `Content-Type` самому через `res.setHeader(...)` до `return`: сервер не перетирает уже выставленный тип. Так уже делают `BaseRootController.Swagger` и `BaseVisualizerController.Page`.
> Evidence: `packages/api/src/server/http.ts` (`Server`); `packages/api/src/controllers/root.ts` (`BaseRootController.Swagger`); `packages/api/src/controllers/visualizer.ts` (`BaseVisualizerController.Page`).

## Легаси и мёртвый код

> 🧱 Легаси (решение автора, `KI-API-09`): каталог `controllers/events` реэкспортируется из `packages/api/src/controllers/index.ts`, сокеты приложение использует (§«WebSocket-точки»), SSE реализован (§«SSE-ссылки»). Внутри `websockets.ts` (`WebSocketsController`) закомментированы middleware `Init`, `AuthorizedInit`, `Param`; в `WebSocketWrapper.handle` подписка на `onopen` серверного сокета не срабатывает никогда — серверный сокет создаётся уже открытым.
> См. `KI-API-09`.

> 🧱 Легаси: `packages/api/src/constants` (коды `AOM_API:*` и словари `ru`/`en`) не экспортируется из `packages/api/src/index.ts`. Приложение держит собственные наборы кодов и словарей и импортирует из пакета только `checkLocales`. См. `KI-API-09` и `KI-COMMON-02`.

> 🧱 Легаси: `enum AccessTypes` в `packages/api/src/controllers/access/init.ts` (`AccessTypes`) пуст и не экспортируется; он остаётся лишь как тип-заглушка для `@PropertySchema.Enum` в `access/schemas.ts` (`AomAccessExtraPoint.accessTypes`, `AomAccessMarkerElement.accessTypes`). Заменён на `allowedAccessTypes` + `AccessMarker` наследника (в приложении — `PermissionsTypes`).

> 🧱 Легаси: неиспользуемые импорты — `parse` из `node:url` (`server/http.ts` (`parse`) — сама функция `parse` в файле больше не вызывается, весь разбор идёт через `new URL(...)`), `fs`/`path` (`controllers/root.ts` (`fs`, `path`)), `After` в `access-controller.ts` (`After`) (`Route` из той же группы импортов используется — `access-controller.ts` (`BaseAccessController.CheckLayerPass`, `BaseAccessController.Required`)). На рантайм не влияют.

## Как использует приложение

Сервер модуля создаётся одной строкой: корневой класс с двумя бриджами передаётся в `Router`, тот — в `Server` вместе с настройками из env и локализатором. У orgs роутер вынесен в отдельный файл, чтобы тесты брали его, не запуская сервер (`test/src/modules/orgs/api/router.ts` (`Index`, `router`), `test/src/modules/orgs/api/index.ts`). Настройки (`AomServerSettings`), документ `OpenApi` и корневой контроллер объявляются в `api/init.ts` того же модуля; там же `new I18nizer()` (`test/src/modules/orgs/api/init.ts` (`settings`, `i18nizer`, `ModuleRoot`)).

Базовые контроллеры параметризуются один раз в общем слое: `ModuleRootController extends BaseRootController` задаёт `RoutesStructure`/`RouteElement`, переопределяет `markersToRoute` (переносит маркер доступа в элемент маршрута) (`test/src/common/controllers/module/controller.ts` (`ModuleRootController`, `ModuleRootController.markersToRoute`)); `AccessController.moduleIdent` связывает с `ident` модуля шаг `ProtectedController.Module` до сборки карты (`test/src/common/controllers/protected.ts`) — конструктор для этого не годится: поле `ident` наследника к его вызову ещё не задано; `AccessController extends BaseAccessController` задаёт четыре абстрактных статики, включая `allowedAccessTypes = Object.values(PermissionsTypes)` (`test/src/common/controllers/access/controller.ts` (`AccessController`)). Карта доступа заполняется при разборе текущей организации: `access.generateAccessMap(allowedAccessTypes, roles)` (`test/src/common/controllers/current-data/current-org.ts` (`CurrentOrg.defineOrgUserRoles`)), а требования ставятся на конкретных эндпоинтах: `@AccessController.TypesRequired(PermissionsTypes.ADMIN)` (`test/src/modules/references/api/routes/cities/routes.ts` (`Cities.Add`)).

Билдеры используются как базы объявляемых в `init/` контроллеров: `@Controller() class SubOrgBody extends BodyBuilder(OrgDataDTO) {}` (`test/src/modules/orgs/api/routes/orgs/init/body.ts` (`SubOrgBody`)), `@Controller() class OrgIDValue extends UUIDParam("orgId") {}` (`test/src/modules/orgs/api/routes/orgs/init/params.ts` (`OrgIDValue`)). Глобальные статики выставляются в `test/src/config/aom/*.ts`: локаль и ключи (`test/src/config/aom/i18nizer.ts`), Basic-авторизация и имя токена (`test/src/config/aom/auth.ts` (`AuthBasic.BASIC_AUTH`, `AuthHeaderToken.TOKEN_NAME`)), `Logger.ENGINE = pino(...)` (`test/src/config/aom/logger.ts` (`Logger.ENGINE`)).

Правила приложения (где ставить `Required`, как строятся сообщения и локали, как раскладывается `init/`) — `test/docs/principles.md`; трассировки конкретных запросов — `test/docs/request-lifecycle.md`.

## Сборка и потребление

Сборка — `bun run build:api` в корне ядра (или `bun run build` внутри `packages/api`): три прохода `tsc` (`tsconfig.build.json` → `dist/cjs` в CommonJS, `tsconfig.build.mjs.json` → `dist/mjs`, `tsconfig.build.types.json` → `dist/types`) и затем `node ../../scripts/post-build.js`, который дописывает расширения относительным импортам и кладёт `dist/cjs/package.json` с `{"type":"commonjs"}`; неразрешимый импорт останавливает сборку (`packages/api/package.json` (`scripts`); `main/scripts/post-build.js`). Файл `package.json` пакета генерируется скриптом `scripts/prebuild.js` — править следует `package.src.json`/`scripts/jsons`.

Приложение подключает пакет симлинком `test/node_modules/@aom-js/api → ../../../main/packages/api` и через `exports` читает `dist/types` и `dist/mjs`, а не исходники. Инвариант: **правки `src` не видны приложению без `bun run build`**. Устаревший `dist` ловит страж свежести в preload приложения (`test/test/helpers/setup.ts`). Полная схема сборки и dist-потребления — `main/docs/architecture.md` §«Сборка, тесты…» и §«Как приложение потребляет ядро».

## Тесты

### Что покрыто

Файлы: `packages/api/test/server.test.ts` (интеграционный, поднимает реальный `Server` на `port: 0` и стучится в него через `fetch`/сырые TCP-сокеты, включая блок ленивого тела и лимита размера — `KI-API-16`), `packages/api/test/units.test.ts` (юнит-тесты отдельных функций/классов) `packages/api/test/body-options.test.ts` (юнит-тесты маркера `@BodyOptions`) `packages/api/test/websockets.test.ts` (реестр `AomWebSockets` и рукопожатие через реальный `Server` клиентом `ws`) и `packages/api/test/server-events.test.ts` (кадр и реестр SSE, поток через реальный `Server`). Пакет подключён к vitest монорепо: алиас `"@aom-js/api": resolve(__dirname, "packages/api/src")` есть в `main/vitest.config.ts` (`"@aom-js/api"` в `resolve.alias`). Число файлов и тестов печатает сам прогон `bun run test -- packages/api`.

| Файл                                     | Что проверяет                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/api/test/server.test.ts`       | Полный HTTP-конвейер на реальном сервере: 404 с `Content-Type`; `content-type` с параметрами/регистром и битый JSON (`KI-API-02`); единый `catch` — `ErrorMessage`-потомок, голый `Error`, ошибка с числовым `status`, статус вне HTTP-диапазона, обрыв после `headersSent`, потоки (успешные/с кастомным типом/с ошибкой) (`KI-API-03`); безопасный разбор адреса — `..`-путь, authority-form `//evil.com`, абсолютная форма (в т.ч. с портом и query), варианты `\` как `/`, префикс `settings.url`, многопараметрический query, обрыв бесконечного потока при разрыве соединения клиентом, многобайтовый UTF-8 на границе TCP-чанков, фрагмент `#` (в пути, в query, percent-кодированный); CORS-заголовки (`KI-API-08`); `OPTIONS` сначала ищет маршрут (`KI-API-12`); логирование ошибки не должно ронять соединение (бросающий `util.inspect.custom`); `ErrorMessage` со статусом 1xx подменяется на 500, а 303 (`SeeOtherResponse`) доходит как окончательный ответ; ленивое тело и лимит размера — отказ в доступе отвечает 401, не дожидаясь тела; 413 по заявленному `Content-Length` без `Connection: close`; 413 по ходу чтения (chunked) с `Connection: close`; тело, которое маршрут не запрашивает, не ломает следующий запрос на том же соединении; `@BodyOptions` перекрывает глобальный лимит в обе стороны; не-JSON `content-type` даёт `{}` и не трогает поток; битый JSON — 400; 413 виден `@Run`-перехватчику приложения (`KI-API-16`) |
| `packages/api/test/units.test.ts`        | `checkLocales` — сравнение значений `source` с ключами `target`, отсутствие шума при полном покрытии (`KI-API-04`); `BodyBuilder.JSONSchema` — приоритет явного описания, откат на `static description`, пустая строка вместо `"undefined"` (`KI-API-05`); коды 423/424 без опечатки и с собственными описаниями (`KI-API-06`); `BaseAccessController.CheckLayerPass` — ненайденная точка доступа/слой не бросают (`KI-API-13`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `packages/api/test/body-options.test.ts` | `@BodyOptions` — маркер попадает в `route.markers` собранного маршрута; маршрут без декоратора маркера не получает; лимит эндпоинта перекрывает больший и меньший лимит middleware (`KI-API-16`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `packages/api/test/websockets.test.ts` | `AomWebSockets` — несколько сокетов на id, `send` только своему id, `broadcast` всем, `disconnect` снимает ровно этот сокет (и оставляет пустой массив); через реальный `Server` и клиент `ws` — порядок гейт → id → тело точки, id из заголовка и из параметра пути, доставка `send` своему id, `onMessage(id, socket, data)`, снятие с регистрации после закрытия, разрыв без id и при исключении гейта (сервер жив), исключение в теле точки рвёт уже открытое соединение, `CONTROLLERS_WEBSOCKETS_WRONG_TARGET` без `sockets: AomWebSockets`, ошибка `onMessage` логируется и не рвёт соединение |
| `packages/api/test/protocol-headers.test.ts` | `protocolHeaders` — развёртка `encodeURIComponent(JSON)`, нижний регистр имён, только строки, битые элементы пропускаются, список извлекаемых (не задан — всё, `[]` — ничего); через реальный `Server` и клиент `ws` — заголовки подпротокола видны шагам точки, настоящий заголовок побеждает, настройка ограничивает; `AuthHeaderToken` не принимает `Bearer_` |
| `packages/api/test/stop.test.ts` | `Server.stop()` ждёт начатый запрос, новых соединений не принимает, keep-alive (простаивающий и занятый) не держит остановку; закрывает поток SSE и WebSocket; повторный вызов — тот же `Promise`; `Server.stopAll()` останавливает все серверы |
| `packages/api/test/manifest.test.ts` | `@aom-js/api/testing`: каждое правило вида (`handler`, в том числе эндпоинт наследника `BaseAccessController`; `checkpoint`; `input` у шагов `QueryStringBuilder`, `ParamsBuilder`, `UUIDParam`, `BodyBuilder`, `HeadersBuilder`, `CookieBuilder`; `meta`; свой метод наследника билдера — `step`; `@CursorKind` побеждает), `options.kindOf` и его место в порядке, `undefined` — решают правила пакета; `describeRoute` пропускает новое поле проекции и кладёт `parent`/`kind` после места шага; порядок `describeRouter`; формат `manifestOf` |
| `packages/api/test/server-events.test.ts` | `formatServerEvent` — без `event:`, `id`/`data`, перевод строки в данных экранирован, в `id` — ошибка; `AomServerEvents` — заголовки и первый кадр (`: connected` или `retry:`), конверт `send` своему id, `broadcast` всем, `sendEnvelope`/`broadcastEnvelope`, неверный конверт (тип не из словаря, пустое значение, лишний ключ), приведение значения при проверке (лишние поля отсекаются, конверт цел, и в production при `validate: true`) и ключ `type` в словаре — ошибка, проверка по классу вне production и её выключение (`validate: false`, `NODE_ENV=production`), неизвестный id не бросает, `disconnect` и закрытие снимают поток (последний — с ключом), heartbeat и его остановка; через реальный `Server` и `http.get` — заголовки и первый кадр, доставка `send`/`broadcast`, heartbeat, уход клиента без `console.error`, `requestTimeout` не рвёт долгий GET (контроль — 408 на недосланные заголовки), `JSONSchema` и `itemSchema` в документе, гейт 401 — JSON и пустой реестр |

### Expected-fail

Собственных `it.fails` у пакета нет.

### Пробелы

`RouteMatcher` (порядок маршрутов при пересекающихся шаблонах); `I18nizer` как отдельный юнит (`defineLocale`, приоритет query над заголовком, `localize`) — покрыт только косвенно через `Server`; билдеры — `Headers`/`NotEmpty`/`ParamsBuilder` отдельно от `BodyBuilder.JSONSchema`; `BaseAccessController` — `setAccessMark` и сужение типов, `checkAccessPoint` (`generateAccessMap` покрыт только охраной `moduleIdent`, `ExtraAccess` — одним маршрутом со слоем); auth-middleware; ответы (`status`/`toJSON`/`JSONSchema` как юниты); декораторы `QueryBoolean`, `TransformToArray`, `TransformToDate`, `IsNullable`.

### Как запускать

```bash
bun run test -- packages/api   # из корня ядра
```

`Server` из-за `listen` в конструкторе поднимается с `port: 0` и читает реальный порт из `server.address()` — по этому же образцу можно писать новые интеграционные тесты; `RouteMatcher` не экспортирован и проверяется только через `Server`.

## Расхождения с историческими заметками

| Заметка                                                        | Утверждение                                                                                                                                | Фактически                                                                                                                                                                                                                                                      | Evidence                                                                                                                                                                                                                            |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `main/docs/access-controller.md`                               | Конкретная реализация использует специфический `AccessTypes` проекта; заполнение карты полномочий должно вызываться внутри `Auth.Init`     | Реализовано иначе: `AccessTypes` в пакете — пустой enum и не экспортируется, тип задаёт наследник через `AccessMarker`/`AccessCore`/`allowedAccessTypes`; карту заполняет `generateAccessMap`, которую приложение вызывает из `CurrentOrg`, а не из авторизации | `packages/api/src/controllers/access/init.ts` (`AccessTypes`); `test/src/common/controllers/access/controller.ts` (`AccessController`); `test/src/common/controllers/current-data/current-org.ts` (`CurrentOrg.defineOrgUserRoles`) |
| `main/docs/i18nizer.md`                                        | Файл состоит из одного заголовка «Локализатор»                                                                                             | Механика реализована и работает (`I18nizer` + встроенные словари `ru`/`en` + подстановка в `Server`), но нигде не описана; теперь словари покрывают все коды `messages/errors.ts` (было 16 из 33)                                                           | `packages/api/src/server/i18nizer.ts` (`I18nizer`); `packages/api/src/constants/locales/ru/errors.ts`                                                                                                                               |
| `main/readme.md` (§«Как это можно заставить работать?», пример `responseJsonSchema`) | `responseJsonSchema` возвращает `status: status` — как передан | В коде `status: status \|\| 200`, то есть отсутствующий статус подменяется на 200 | `packages/api/src/functions/json-schema.ts` (`responseJsonSchema`) |
| `main/docs/e2e-test.md`                                        | Пожелания к e2e-тестированию через разложение роутера на маршруты и переключение контекста                                                 | Появились интеграционные тесты пакета (`server.test.ts`), но именно того сценария (разложение роутера, переключение контекста) в них нет                                                                                                                        | `packages/api/test/server.test.ts`                                                                                                                                                                                                  |
| `packages/api/readme.md` (прежняя версия этого документа)      | Пакет без тестов; `KI-API-02, 03, 04, 05, 06, 08, 12` открыты; `CheckLayerPass` — дефект без ID; 423/424 делят описание `ERROR_WRONG_DATA` | Пакет получил `test/` и алиас в `vitest.config.ts`; перечисленные дефекты закрыты кодом этой ревизии (`CheckLayerPass` получил ID `KI-API-13` и тоже закрыт), позже к ним добавились закрытые `KI-API-16`/`KI-API-17`               | См. §«Известные дефекты» выше                                                                                                                                                                                                       |

## Открытые вопросы

> ❓ Открытый вопрос: планируется ли экспортировать `constants` (коды и словари) из пакета, чтобы приложение не дублировало набор кодов и не оставалось без переводов ядра?

> ❓ Открытый вопрос: комментарий «эта middleware в том числе для изучения гипотезы о баге каскадного наследования» в `packages/api/src/builders/response.ts` (`ResponseBuilderConstructor.Response`) — гипотеза подтверждена или закрыта?

> ❓ Открытый вопрос: должен ли `Server` разбирать `multipart/form-data` (сейчас `files` всегда пуст), или загрузка файлов остаётся зоной ответственности приложения?

---

**О ссылках в этом документе:** ссылки даются по именам символов и названиям тестов, а не по номерам строк — номера сдвигаются при любой правке и врут почти сразу. Сверять их нужно поиском имени в указанном файле.
