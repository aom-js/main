# События и транспорты — план

Цель — не демо-стенд, а образец: одна точка событий, к которой безопасно подключаются разные транспорты (WebSocket, SSE, socket.io и другие), без жёсткой зависимости роутера или ядра от любого из них. Решения владельца 2026-10-21: вариант «адаптер в ядре» (Б), совместимость с базовыми протоколами сохраняется; `@aom-js/router` не получает зависимостей и не меняется.

Две задачи:
1. заголовки через подпротокол `sec-websocket-protocol` — браузерный WebSocket не задаёт заголовки рукопожатия (`KI-AUTH-10`);
2. «образцовое» хранилище событий и болванка транспорта, к которой подключается адаптер — первым внешним будет socket.io.

## Что есть сейчас

- `AomWebSockets` (`packages/api/src/controllers/events/websockets.ts`): реестр сырых ws по ключу, `send(id, data)` шлёт строку как есть; рукопожатие — `WebSocketsController.Define`/`Connect` в цепочке точки `@WebSocketPoint`.
- `AomServerEvents` (`packages/api/src/controllers/events/sse.ts`): типизированный словарь «событие → класс», `send(id, event, data)`, `JSONSchema()` для `@Responses`; транспорт — только SSE.
- `Server` (`packages/api/src/server/http.ts`): обработчик `upgrade` сам собирает контекст (заголовки, query, cookies, params) и **рвёт** соединение, если путь не нашёлся среди точек сокетов — чужой обработчик `upgrade` (socket.io на `/socket.io/`) не доживёт до рукопожатия. Проверено 2026-10-21 под Bun 1.4.3 и Node 24: оба обработчика `upgrade` одного `node:http` срабатывают.
- `AuthHeaderToken.Required` понимает `Bearer_<token>` в любом заголовке из `HEADERS_KEYS` — частный обход того же ограничения, только для токена.

## 1. Заголовки через подпротокол

**Формат** (клиент → сервер), всё в одном заголовке `Sec-WebSocket-Protocol`:

```text
// псевдокод
Sec-WebSocket-Protocol: aom, aom.headers.<base64url(JSON {"authorization": "Bearer …", "data-org-id": "…"})>
```

- `aom` — маркер; сервер **обязан** вернуть выбранный подпротокол из предложенных, иначе браузер закрывает соединение. Сервер выбирает `aom` (`handleProtocols` у `WebSocketServer`), а не первый попавшийся, как сейчас.
- Значения — в `base64url`: подпротокол — токен RFC 7230, пробелы, `/`, `=` и `,` в нём запрещены, а в заголовках они бывают (`Bearer …`).
- Один токен с JSON, а не по токену на заголовок: один разбор, одна проверка размера.

**Сервер** (`Server`, обработчик `upgrade`):
- новая настройка `AomServerSettings.protocolHeaders?: string[]` — список заголовков, которые разрешено передать подпротоколом (приложение: `["authorization", "data-org-id"]`); пусто — разбор выключен (поведение как сейчас);
- разбор: найти `aom.headers.*`, декодировать, взять только разрешённые имена (в нижнем регистре), строковые значения; **настоящий заголовок запроса побеждает** подпротокольный; битый base64/JSON — запрос не рвётся, заголовки просто не добавляются (гейт сам ответит 401);
- сам токен `aom.headers.*` из `sec-websocket-protocol`, попадающего в контекст, вырезается — чтобы `AuthHeaderToken` с `HEADERS_KEYS` не увидел его как токен.
- функция разбора экспортируется (`protocolHeaders`) — её же переиспользует адаптер socket.io (раздел 3) для `handshake.auth`.

**Совместимость:** `Bearer_` в `AuthHeaderToken` остаётся (старые клиенты); в документации — как устаревший путь. Гейты, `CurrentOrg`, `data-org-id` не меняются: они читают обычные заголовки контекста. Работает для всех точек `@WebSocketPoint`, включая уже написанные в приложении.

**Клиент** (в документации, исполняемым примером в тесте):

```ts
// псевдокод: браузер
const b64url = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
new WebSocket(url, ["aom", `aom.headers.${b64url(JSON.stringify({ authorization: `Bearer ${token}`, "data-org-id": orgId }))}`]);
```

**Безопасность:** подпротокол — заголовок, а не адрес: не попадает в историю и в адресную строку; прокси, как и `authorization`, могут его логировать — то же, что у обычного заголовка. Разрешённый список не даёт подменить произвольный заголовок (например, `host`, `cookie`).

## 2. Хранилище событий и транспорты

### Хранилище `AomEvents`

Обобщение `AomServerEvents`: тот же словарь `{ событие: класс }`, те же `send`/`broadcast`/`JSONSchema`, но хранит не потоки SSE, а **соединения** любого транспорта:

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
- Хранилище ничего не знает о транспортах, кроме интерфейса соединения: подключить новый — значит написать `AomEventsConnection` и вызвать `attach`.
- `AomServerEvents` остаётся именем-синонимом `AomEvents` (вышел вчера, в приложении одно использование) — или переименовывается в одном месте; см. вопрос 2.
- `AomWebSockets` (сырые строки) не меняется — совместимость с написанными точками.

### Транспорты в ядре

| Транспорт | Как подключается | Кадр |
|---|---|---|
| SSE | `@Get` возвращает `events.sse(id, res)` (как сейчас) | `event:`/`id:`/`data:` (`formatServerEvent`) |
| WebSocket | точка `@WebSocketPoint` + шаг ключа + `@After(EventsController.Connect)` | текст JSON `{ "event", "data", "id"? }` |
| socket.io | адаптер (раздел 3) на той же точке `@WebSocketPoint` | `socket.emit(event, data)` |

### Шаг подключения без привязки к транспорту

`EventsController` (новый, рядом с `WebSocketsController`) — `Connect` читает ключ `self.id` и `static events: AomEvents` контроллера точки и зовёт **транспорт из контекста**: `ctx.accept(id, events)`. Кто положил `accept` в контекст, тот и транспорт:
- `Server.upgrade` — `accept` делает `wss.handleUpgrade` и `events.attach(id, wsConnection)`;
- адаптер socket.io — `accept` делает `events.attach(id, socketConnection)`.

Нет `accept` или ключа — соединение закрывается (как `WebSocketsController.Connect` сейчас). Одна и та же точка обслуживает и голый WebSocket, и socket.io — гейты, `CurrentOrg`, шаг ключа общие.

### Швы `Server` для внешних адаптеров

- `AomServerSettings.upgradeBypass?: string[]` — префиксы путей, `upgrade` которых `Server` не трогает (`["/socket.io/"]`): чужой обработчик сам разберётся.
- `Server.socketRoute(path)` — найти точку сокета по пути (сейчас приватный `routeMatcher.match("sockets", …)`).
- `Server.socketContext(req, extra)` — собрать контекст точки (заголовки с подпротоколом раздела 1, query, cookies, params) — сам обработчик `upgrade` переходит на него без смены поведения.

## 3. Адаптер socket.io

Точка входа `@aom-js/api/socket-io` (как `@aom-js/router/testing`): `attachSocketIO(io, server)`.

- **Без зависимости:** адаптер не импортирует `socket.io` ни в рантайме, ни в типах — принимает структурные типы (`SocketIOServerLike`: `of(fn)`, `use`; `SocketLike`: `handshake { headers, query, auth }`, `nsp.name`, `emit`, `disconnect`, `on("disconnect")`). Приложение создаёт свой `new IOServer(server.server, { destroyUpgrade: false })` и передаёт его. В `dependencies` пакетов ничего не добавляется; `socket.io` и `socket.io-client` — `devDependencies` корня `main` только для теста адаптера.
- **Пространства имён:** динамическое `io.of((name, auth, next) => next(null, !!server.socketRoute(name)))` — канал socket.io = путь точки `@WebSocketPoint`, параметры пути — из совпадения.
- **Цепочка:** `nsp.use(async (socket, next) => …)` строит контекст `server.socketContext(...)`; заголовки — из `handshake.headers` плюс `handshake.auth.headers` через тот же `protocolHeaders` (разрешённый список раздела 1); `ctx.accept` — `events.attach(id, socketConnection)`; затем `route.apply(context)`. Исключение цепочки → `next(err)` — клиент получает `connect_error` с кодом ответа (401 и т.п.).
- **Обязательные настройки приложения:** `destroyUpgrade: false` у `IOServer` (иначе socket.io через 1 с закрывает чужие `upgrade`, а цепочка доступа с базой может быть дольше) и `upgradeBypass: ["/socket.io/"]` у `Server`; адаптер проверяет оба и бросает понятную ошибку при подключении.
- **Доставка между экземплярами** — как сейчас: изолятор `@CustomTopic()` без очереди, исполнитель каждого экземпляра зовёт `events.send` — соединения всех транспортов в этом процессе получают событие. Адаптеры socket.io (redis, postgres) не нужны.

## Ограничения и особенности

- Соединения в памяти процесса — у всех транспортов.
- Права проверяются при подключении; отозванный доступ живёт до переподключения.
- Точки сокетов в OpenAPI не попадают (`KI-ROUTER-06`); словарь событий описан в OpenAPI только у SSE-ссылки. AsyncAPI — вне плана.
- socket.io под Bun: совместимость `node:http` подтверждена для `ws`; сам socket.io проверяется тестом стадии 4 под обоими рантаймами.

## Тесты

- Стадия 1: разбор подпротокола (base64url, разрешённый список, приоритет настоящего заголовка, битые данные, вырезание токена); сервер выбирает `aom`; браузерный сценарий — клиент `ws` с подпротоколами проходит гейт по токену и организации (ядро — vitest, приложение — живой тест на точке `/permissions/my`).
- Стадия 2: `upgradeBypass` — чужой обработчик получает соединение, своё поведение прежнее; все тесты `websockets.test.ts` и `server.test.ts` зелёные без правки ожиданий.
- Стадия 3: `AomEvents` — `attach`/снятие, `send`/`broadcast` во все транспорты ключа; SSE — прежние тесты `server-events.test.ts`; WebSocket через `EventsController.Connect` — кадр JSON, закрытие снимает соединение.
- Стадия 4: socket.io (реальные `socket.io` и `socket.io-client` из devDependencies) — подключение под гейтом, 401 → `connect_error`, событие доходит, отключение снимает соединение, голый WebSocket на той же точке работает параллельно; Node и Bun.

## Стадии

1. Подпротокол: `protocolHeaders`, `handleProtocols`, настройка `protocolHeaders`, тесты, документация; приложение — `protocolHeaders: ["authorization", "data-org-id"]`, живой тест, `KI-AUTH-10` — закрыть для WebSocket.
2. Швы `Server`: `upgradeBypass`, `socketRoute`, `socketContext`; обработчик `upgrade` на них без смены поведения.
3. Хранилище `AomEvents`, `AomEventsConnection`, `EventsController.Connect`, транспорты SSE и WebSocket; `AomServerEvents` — по ответу на вопрос 2.
4. Адаптер `@aom-js/api/socket-io`: структурные типы, `attachSocketIO`, devDependencies, тест под Node и Bun.
5. Документация (`packages/api/readme.md` — раздел «События: хранилище и транспорты», рецепт подключения своего транспорта), пример в приложении: одна точка `MyPermissionsEvents` — SSE-ссылка, WebSocket и socket.io на одном хранилище; `test/docs/modules/orgs.md`, реестр KI.

## Вне плана

AsyncAPI; адаптеры socket.io для нескольких экземпляров (redis, postgres); сообщения от клиента через `AomEvents` (вызов маршрутов из событий клиента, вариант «В» анализа); перевод написанных точек `AomWebSockets` на хранилище.

## Вопросы владельцу

1. Формат подпротокола: маркер `aom` + один токен `aom.headers.<base64url(JSON)>` — подходит? (Альтернатива — по токену на заголовок `aom.h.<имя>.<base64url(значение)>`.)
2. `AomServerEvents` → `AomEvents`: переименовать и обновить единственное использование в приложении, или оставить синоним?
3. Кадр WebSocket-транспорта хранилища — JSON `{ "event", "data", "id"? }` — подходит?
4. Стадия 4 скачивает `socket.io` и `socket.io-client` (devDependencies корня `main`, версия 4.8.x) — согласны?
