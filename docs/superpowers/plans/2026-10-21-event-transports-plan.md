# События и транспорты — план

Цель — не демо-стенд, а образец: одна точка событий, к которой безопасно подключаются разные транспорты (WebSocket, SSE, socket.io и другие), без жёсткой зависимости роутера или ядра от любого из них. Решения владельца 2026-10-21:
- вариант «адаптер в ядре» (Б); `@aom-js/router` не получает зависимостей и не меняется;
- **совместимость со старыми механизмами не держим** (анахронизм): обход `Bearer_` в `AuthHeaderToken`, `AomWebSockets` + `WebSocketsController` и имя `AomServerEvents` заменяются новым, написанные точки приложения переводятся;
- заголовки подпротоколом — **быстрая развёртка аргумента в обычные `headers`**, которые дальше проходят стандартные шаги (`AuthHeaderToken`, `CurrentOrg`), без своей обёртки.

Две задачи:
1. заголовки через подпротокол `sec-websocket-protocol` — браузерный WebSocket не задаёт заголовки рукопожатия (`KI-AUTH-10`);
2. «образцовое» хранилище событий и болванка транспорта, к которой подключается адаптер — первым внешним будет socket.io.

## Что есть сейчас

- `AomWebSockets` (`packages/api/src/controllers/events/websockets.ts`): реестр сырых ws по ключу, `send(id, data)` шлёт строку как есть; рукопожатие — `WebSocketsController.Define`/`Connect` в цепочке точки `@WebSocketPoint`. В приложении — 4 точки: `MyPermissionsSocket`, `TicketSocket`, `MyDocumentsSocket`, `MyAgreementsSocket`.
- `AomServerEvents` (`packages/api/src/controllers/events/sse.ts`): словарь «событие → класс», `send(id, event, data)`, `JSONSchema()` для `@Responses`; транспорт — только SSE; в приложении — `MyPermissionsEvents`.
- `Server` (`packages/api/src/server/http.ts`): обработчик `upgrade` сам собирает контекст и **рвёт** соединение, если путь не нашёлся среди точек сокетов — чужой обработчик `upgrade` (socket.io на `/socket.io/`) не доживёт до рукопожатия. Проверено 2026-10-21 под Bun 1.4.3 и Node 24: оба обработчика `upgrade` одного `node:http` срабатывают.
- `AuthHeaderToken.Required` заменяет `Bearer_` на `Bearer ` в любом заголовке из `HEADERS_KEYS` — частный обход того же ограничения.

## 1. Заголовки через подпротокол

**Запись:** каждый элемент `Sec-WebSocket-Protocol` — один заголовок, `<имя>|<значение>`; значение — `encodeURIComponent` (пробел и прочее, что запрещено в токене подпротокола RFC 7230, становится `%XX`; `|` и `%` в токене разрешены).

```ts
// псевдокод: браузер
const protocol = (name: string, value: string) =>
  `${name}|${encodeURIComponent(value).replace(/[()]/g, (c) => `%${c.charCodeAt(0).toString(16)}`)}`;
new WebSocket(url, [protocol("authorization", `Bearer ${token}`), protocol("data-org-id", orgId)]);
// Sec-WebSocket-Protocol: authorization|Bearer%20abc, data-org-id|1f0e…
```

**Сервер** (`Server`, обработчик `upgrade`) — одна функция `protocolHeaders(value, allowed)` перед сборкой контекста:
- разбить по `,`, у каждого элемента — имя до первого `|` (в нижнем регистре), значение — `decodeURIComponent` остатка; элементы без `|` и с битой кодировкой пропускаются;
- результат **разворачивается в обычные `headers` контекста**; дальше — стандартные шаги, ничего подпротокольного они не знают;
- настоящий заголовок запроса побеждает развёрнутый;
- развёртывается только список `AomServerSettings.protocolHeaders?: string[]` (приложение: `["authorization", "data-org-id"]`); пусто — развёртки нет. Без списка подпротокол мог бы подставить любой отсутствующий заголовок (`x-forwarded-for` и т.п.);
- ответ сервера — первый предложенный элемент (как `ws` делает сейчас); браузеру этого достаточно.

Убирается: замена `Bearer_` в `AuthHeaderToken.Required` и абзац о ней в документации. Работает для всех точек `@WebSocketPoint`.

**Безопасность:** подпротокол — заголовок, а не адрес: не попадает в историю и адресную строку; логирование прокси — как у `authorization`.

## 2. Хранилище событий и транспорты

### Хранилище `AomEvents`

Вместо `AomServerEvents` и `AomWebSockets`: тот же словарь `{ событие: класс }`, но хранит **соединения** любого транспорта:

```ts
// псевдокод: packages/api/src/controllers/events/hub.ts
interface AomEventsConnection {
  send(event: string, data: unknown, eventId?: string): void; // транспорт сам кодирует кадр
  close(): void;
}
class AomEvents<E extends Record<string, ClassConstructor>> {
  constructor(readonly schemas: E, readonly options?: { heartbeat?: number; retry?: number });
  attach(id: string, connection: AomEventsConnection): () => void; // вернёт «снять»; транспорт зовёт её на закрытии
  send<K extends keyof E & string>(id: string, event: K, data: InstanceType<E[K]>, eventId?: string): void;
  broadcast<K extends keyof E & string>(event: K, data: InstanceType<E[K]>, eventId?: string): void;
  JSONSchema(description: string, status?: number): OpenApiEventsResponse;
  sse(id: string, res: HttpResponse): PassThrough; // транспорт SSE — нынешний AomServerEvents.connect
}
```

- Ключ соединения, проверка имени события (перевод строки — ошибка) и типизация данных — одни на все транспорты.
- Хранилище не знает транспортов, кроме интерфейса соединения: подключить новый — написать `AomEventsConnection` и вызвать `attach`.
- `AomServerEvents`, `AomWebSockets`, `WebSocketsController`, `Ws`, `OnMessageFunction` удаляются; приём сообщений от клиента — вне плана (сейчас обработчики приложения только пишут в лог).

### Транспорты в ядре

| Транспорт | Как подключается | Кадр |
|---|---|---|
| SSE | `@Get` возвращает `events.sse(id, res)` | `event:`/`id:`/`data:` (`formatServerEvent`) |
| WebSocket | точка `@WebSocketPoint` + шаг ключа + `@After(EventsController.Connect)` | текст JSON `{ "event", "data", "id"? }` |
| socket.io | адаптер (раздел 3) на той же точке `@WebSocketPoint` | `socket.emit(event, data)` |

### Шаг подключения без привязки к транспорту

`EventsController` (вместо `WebSocketsController`): `@Middleware() Connect` читает ключ `self.id` (его ставит шаг приложения, как сейчас) и `static events: AomEvents` контроллера точки и зовёт **транспорт из контекста**: `ctx.accept(id, events)`. Кто положил `accept`, тот и транспорт:
- `Server.upgrade` — `accept` делает `wss.handleUpgrade` и `events.attach(id, wsConnection)`;
- адаптер socket.io — `events.attach(id, socketConnection)`.

Нет `accept`, ключа или `events` у контроллера — соединение закрывается, ошибка цепочки — тоже. Одна точка обслуживает и голый WebSocket, и socket.io — гейты, `CurrentOrg`, шаг ключа общие.

### Швы `Server` для внешних адаптеров

- `AomServerSettings.upgradeBypass?: string[]` — префиксы путей, `upgrade` которых `Server` не трогает (`["/socket.io/"]`).
- `Server.socketRoute(path)` — найти точку сокета по пути (сейчас приватный `routeMatcher.match("sockets", …)`).
- `Server.socketContext(req, extra)` — собрать контекст точки (заголовки с развёрткой раздела 1, query, cookies, params); обработчик `upgrade` сам переходит на него.

## 3. Адаптер socket.io

Точка входа `@aom-js/api/socket-io` (как `@aom-js/router/testing`): `attachSocketIO(io, server)`.

- **Без зависимости:** адаптер не импортирует `socket.io` ни в рантайме, ни в типах — принимает структурные типы (`SocketIOServerLike`: `of(fn)`, `use`; `SocketLike`: `handshake { headers, query, auth }`, `nsp.name`, `emit`, `disconnect`, `on("disconnect")`). Приложение создаёт свой `new IOServer(server.server, { destroyUpgrade: false })` и передаёт его. В `dependencies` пакетов ничего не добавляется; `socket.io` и `socket.io-client` — `devDependencies` корня `main` только для теста адаптера.
- **Заголовки:** клиент socket.io передаёт их объектом `auth` (`io(url, { auth: { authorization: "Bearer …", "data-org-id": orgId } })`), адаптер разворачивает его в `headers` контекста по тому же списку `protocolHeaders` и с тем же правилом «настоящий заголовок побеждает».
- **Пространства имён:** динамическое `io.of((name, auth, next) => next(null, !!server.socketRoute(name)))` — канал socket.io = путь точки `@WebSocketPoint`, параметры пути — из совпадения.
- **Цепочка:** `nsp.use(async (socket, next) => …)` строит контекст `server.socketContext(...)`, кладёт `ctx.accept` → `events.attach(id, socketConnection)` и зовёт `route.apply(context)`. Исключение цепочки → `next(err)` — клиент получает `connect_error` с кодом ответа (401 и т.п.).
- **Обязательные настройки приложения:** `destroyUpgrade: false` у `IOServer` (иначе socket.io через 1 с закрывает чужие `upgrade`, а цепочка доступа с базой может быть дольше) и `upgradeBypass: ["/socket.io/"]` у `Server`; адаптер проверяет оба и бросает понятную ошибку.
- **Доставка между экземплярами** — как сейчас: изолятор `@CustomTopic()` без очереди, исполнитель каждого экземпляра зовёт `events.send` — соединения всех транспортов в этом процессе получают событие. Адаптеры socket.io (redis, postgres) не нужны.

## Ограничения и особенности

- Соединения в памяти процесса — у всех транспортов.
- Права проверяются при подключении; отозванный доступ живёт до переподключения.
- Точки сокетов в OpenAPI не попадают (`KI-ROUTER-06`); словарь событий описан в OpenAPI только у SSE-ссылки. AsyncAPI — вне плана.
- socket.io под Bun: совместимость `node:http` подтверждена для `ws`; сам socket.io проверяется тестом стадии 4 под обоими рантаймами.

## Тесты

- Стадия 1: `protocolHeaders` — развёртка, `encodeURIComponent`, список разрешённых, приоритет настоящего заголовка, битые элементы; клиент `ws` с подпротоколами проходит гейт по токену и организации (ядро — vitest; приложение — живой тест на точке `/permissions/my`); `Bearer_` больше не принимается.
- Стадия 2: `upgradeBypass` — чужой обработчик получает соединение; `socketRoute`/`socketContext` — как прежний разбор.
- Стадия 3: `AomEvents` — `attach`/снятие, `send`/`broadcast` во все транспорты ключа; SSE — тесты `server-events.test.ts` на новом хранилище; WebSocket через `EventsController.Connect` — кадр JSON, закрытие снимает соединение, без ключа — разрыв; тесты `websockets.test.ts` переписываются на новое.
- Стадия 4: socket.io (реальные `socket.io` и `socket.io-client` из devDependencies) — подключение под гейтом с `auth`, 401 → `connect_error`, событие доходит, отключение снимает соединение, голый WebSocket на той же точке работает параллельно; Node и Bun.
- Приложение: точки сокетов — `test/sockets.test.ts`, живые тесты шины (`bus-access`, `structures-unread`, `permissions-events`) на новом хранилище.

## Стадии

1. Подпротокол: `protocolHeaders`, настройка `protocolHeaders`, развёртка в обработчике `upgrade`, удаление `Bearer_`; приложение — `protocolHeaders: ["authorization", "data-org-id"]`, живой тест; `KI-AUTH-10` — закрыт для WebSocket.
2. Швы `Server`: `upgradeBypass`, `socketRoute`, `socketContext`.
3. `AomEvents`, `AomEventsConnection`, `EventsController.Connect`, транспорты SSE и WebSocket; удаление `AomServerEvents`, `AomWebSockets`, `WebSocketsController`; перевод 4 точек сокетов и SSE-ссылки приложения: у каждой — словарь событий (сигнал «обнови» — класс события с данными, которые сейчас уходят строкой).
4. Адаптер `@aom-js/api/socket-io`: структурные типы, `attachSocketIO`, devDependencies, тест под Node и Bun.
5. Документация (`packages/api/readme.md` — раздел «События: хранилище и транспорты» вместо «WebSocket-точки» и «SSE-ссылки», рецепт своего транспорта), пример в приложении: `MyPermissionsEvents` — SSE-ссылка, WebSocket и socket.io на одном хранилище; `test/docs/modules/*.md`, реестр KI, дампы.

## Вне плана

AsyncAPI; адаптеры socket.io для нескольких экземпляров (redis, postgres); сообщения от клиента (вызов маршрутов из событий клиента); переподключение с дочиткой пропущенного.

## Вопросы владельцу

1. Кадр WebSocket-транспорта — JSON `{ "event", "data", "id"? }` — подходит?
2. Стадия 4 скачивает `socket.io` и `socket.io-client` (devDependencies корня `main`, версия 4.8.x) — согласны?
