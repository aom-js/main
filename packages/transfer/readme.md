# `@aom-js/transfer`

Пакет описывает изоляторы: класс-контракт со статическими методами-заглушками, вызов которых публикует сообщение в шину, и класс-исполнитель, который на эти сообщения подписан. Здесь же — RPC поверх абстрактного транспорта, таймаут ответа и обработчик ошибок транспорта, reply-топики, дедупликация синглтонов, сериализуемые дескрипторы сервисов и протокол их дистрибуции. Документ — единственный источник истины по механике изоляторов.
Читать до: `packages/core/readme.md` (фазы декораторов, узел, наследование), `packages/schemer/readme.md` (`SchemasCollector`). Читать после: `test/docs/principles.md` §«Изоляторы и исполнители» (паттерн в приложении), `packages/codegen/readme.md` (потребитель дескриптора). Термины — `test/docs/README.md#словарь`.

## Назначение и место в стеке

Пакет даёт два декоратора-роли. `@Isolator(transfer)` привязывает класс к транспорту (`Transfer`) и «закрывает» его: методы, помеченные `@ResponseTopic()`/`@CustomTopic()`, получают топик вида `` `${Class}.${method}` `` и подменённое тело — вместо исходного кода вызывается публикация сообщения в шину (`packages/transfer/src/defines/decorators.ts` (`AutoTopic`), топик — `decorators.ts` (`DefineTopics`)). `@Executor(instanceId?)` на наследнике изолятора подписывает собственные реализации статических методов на те же топики (`decorators.ts` (`Executor`)). Транспорт при этом абстрактен: `Transfer` знает только пару колбэков `publisher`/`subscriber` и идентичность узла `instanceName`/`instanceKey` (`packages/transfer/src/defines/main.ts` (`Transfer`)).

Зависимости: `@aom-js/core` — мета-класс `AomIsolator extends AomCore` и фазы исполнения декораторов; `@aom-js/schemer` — `SchemasCollector`, `Schemer`, `SCALAR_TYPE_SCHEMAS`, `AomSchemas` для схем аргументов; `rxjs` — ожидание ответа и очистка подписок; `reflect-metadata`; `node:crypto` (`randomUUID`, `createHash`) — пакет node-only. Полный граф пакетов ядра — в `main/docs/architecture.md` §«Состав…».

Потребители два. Приложение использует только `Transfer`, `Isolator`, `Executor`, `ResponseTopic`, `CustomTopic` — шина поверх NATS, изоляторы в модулях `files`, `notifications`, `tickets` (см. §«Как использует приложение»). Пакет `@aom-js/codegen` потребляет вторую половину API — `TransferServiceDescriptor` и `collectDistributions` (`packages/codegen/src/defines/collect.ts` (`collect`), `packages/codegen/src/defines/types.ts`); дистрибуция дескрипторов в приложении не задействована.

## Публичный API

Экспортируется всё из `src/defines/index.ts` (`decorators`, `types`, `main`); `rx-transfer.ts` в барель не включён. Нерабочий черновик встроенного реестра (был отдельным файлом в `defines/`, см. `KI-TRANSFER-04` ниже) удалён из пакета вместе со своим экспортом из барели.

### Классы и транспорт

| Экспорт                                   | Сигнатура                                                                                                                                                                                                                                                                                                               | Назначение                                                                                                                                                                                                                                             | Используется приложением               |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------- |
| `Transfer`                                | `new Transfer(config: TransferConfig)`; поля `instanceName`, `instanceKey`, `publisher`, `subscriber`, `callbackMap`, `registryMap`, `registryRequestTopic`, `registryResponseTopic`, `responseTimeout`, `defaultErrorHandler`                                                                                          | Конфигурация шины, таймаут ответа, обработчик ошибок и узел протокола реестра                                                                                                                                                                          | да (`test/src/config/aom/transfer.ts`) |
| `Transfer.prototype.publish`              | `publish(args: TransferPublishHandlerArgs): Promise<unknown>`                                                                                                                                                                                                                                                           | Обёртка над `publisher` как `Promise`: синхронный `throw` и отклонённый `Promise` асинхронного `publisher` приходят одним отклонением                                                                                                                  | нет                                    |
| `Transfer.prototype.reportError`          | `reportError(error: Error): void`                                                                                                                                                                                                                                                                                       | Передаёт ошибку в `defaultErrorHandler`; сбой самого обработчика (синхронный или асинхронный) ловится и уходит в `console.error`, а не в необработанное отклонение                                                                                     | нет                                    |
| `TransferTimeoutError`                    | `class TransferTimeoutError extends Error` — `readonly topic`, `readonly timeout`                                                                                                                                                                                                                                       | Ответ исполнителя не пришёл за `responseTimeout`: у `@ResponseTopic` — отклонение `Promise`, у `@CustomTopic` — уходит в `defaultErrorHandler`                                                                                                         | нет                                    |
| `Transfer.toInstance`                     | `static toInstance<T>(constructor: T, instanceId: string): T`                                                                                                                                                                                                                                                           | Одноразово адресует следующий вызов изолятора конкретному исполнителю                                                                                                                                                                                  | нет                                    |
| `Transfer.instanceTopic`                  | `static instanceTopic(topic: string, instanceId?: string): string`                                                                                                                                                                                                                                                      | `topic_instanceId` либо `topic`                                                                                                                                                                                                                        | нет                                    |
| `Transfer.refPointerPrefix`               | `static readonly refPointerPrefix = "#/components/schemas/"`                                                                                                                                                                                                                                                            | Префикс `$ref` для схем в дескрипторе                                                                                                                                                                                                                  | нет                                    |
| `Transfer.prototype.restore`              | `restore<T>(descriptor: TransferServiceDescriptor, instanceId?: string): T`                                                                                                                                                                                                                                             | Вызывающий прокси из дескриптора без исходного класса; кэш по `name:hash:instanceId`                                                                                                                                                                   | нет                                    |
| `Transfer.prototype.collectDistributions` | `collectDistributions(cb: StructureCollectorFunction): void`                                                                                                                                                                                                                                                            | Опрос шины на дескрипторы; включает кэширование чужих дескрипторов                                                                                                                                                                                     | нет                                    |
| `AomIsolator`                             | `class AomIsolator extends AomCore` — `transfer`, `rx`, `singletone`, `waitForResponse`, `responseTimeout?`, `argsSchemas?`, `returnsSchema?`, `queue`, `registry`, `replySubscribers`, `topicProcessMap`, `isolatedMethods`, `topicsMap`, `instancesMap`, `instanceId?`, `topic`, `replyTopic`, `instanceTopic(topic)` | Мета-класс изолятора: узел метаданных класса и метода. `responseTimeout?` — переопределение метода из `@TopicTimeout`, `undefined` = взять `Transfer.responseTimeout`. Поле `originDescriptorValue` убрано — тело изолятора больше нигде не вызывается | нет                                    |
| `RxTransfer`                              | `new RxTransfer(transfer)`; `request(value, $)`, `initReplySubscription($)`, `replyHandler(topic)`, `execHandler(handler)`                                                                                                                                                                                              | RPC-ядро. **Не экспортируется**: `rx-transfer.ts` не входит в `defines/index.ts`, снаружи доступен только как значение `AomIsolator.rx`                                                                                                                | нет                                    |

### Декораторы

| Экспорт         | Сигнатура                                                                                      | Назначение                                                                                                                                                                                                                                                                   | Используется приложением                                                                                                             |
| --------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `Isolator`      | `Isolator(transfer: Transfer, options?: IsolatorOptions): ClassDecorator`                      | Привязывает класс к шине и разбирает отложенные (LAST) очереди класса; `options.distributed: true` дополнительно собирает `TransferServiceDescriptor` и кладёт его в `transfer.registryMap` (раньше — отдельный классовый декоратор дистрибуции, см. `IsolatorOptions` ниже) | да (`test/src/modules/files/isolators/files.ts` (`FilesIsolator`))                                                                   |
| `ResponseTopic` | `ResponseTopic(singletone?: boolean): MethodDecorator`                                         | Топик с ожиданием ответа; вызов возвращает `Promise` результата                                                                                                                                                                                                              | да (`test/src/modules/notifications/isolators/pusher.ts` (`PusherIsolator.EmailProcessing`, `PusherIsolator.RegisterMessage`))       |
| `CustomTopic`   | `CustomTopic(singletone?: boolean): MethodDecorator`                                           | Топик без ожидания ответа; вызов возвращает `Promise`, немедленно резолвящийся rxjs `Subscription` (обёртка `descriptor.value` объявлена `async`, `decorators.ts` (`AutoTopic`))                                                                                             | да (`test/src/modules/tickets/isolators/tickets.ts` (`TicketsIsolator.CommentProcessing`, `TicketsIsolator.NotificationProcessing`)) |
| `Executor`      | `Executor(instanceId?: string): ClassDecorator`                                                | Наследник-исполнитель: подписки на топики родителя                                                                                                                                                                                                                           | да (`test/src/modules/files/executors/index.ts` (`FilesExecutor`))                                                                   |
| `IsQueue`       | `IsQueue(): MethodDecorator`                                                                   | `queue: true` в аргументах `subscriber` (один исполнитель, не все)                                                                                                                                                                                                           | нет                                                                                                                                  |
| `TopicTimeout`  | `TopicTimeout(responseTimeout: number): MethodDecorator`                                       | Переопределяет для метода `responseTimeout` транспорта; `0` — без ограничения для этого метода; та же проверка диапазона, что у `Transfer({ responseTimeout })`; значение наследуется вместе с методом                                                                       | нет                                                                                                                                  |
| `TopicSchema`   | `TopicSchema(schema: { args?: TopicSchemaArg[]; returns?: TopicSchemaType }): MethodDecorator` | Схемы аргументов/ответа для дескриптора; валидация в момент декорирования                                                                                                                                                                                                    | нет                                                                                                                                  |

### Типы

| Экспорт                                                     | Сигнатура                                                                                                                                                                      | Назначение                                                                                                                                                                                                                                                                                | Используется приложением |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| `TransferConfig`                                            | `{ instanceName; instanceKey; publisher: TransferPublishHandler; subscriber: TransferSubscribeHandler; responseTimeout?: number; defaultErrorHandler?: TransferErrorHandler }` | Аргумент конструктора `Transfer`                                                                                                                                                                                                                                                          | нет (структурно)         |
| `TransferPublishHandler` / `TransferPublishHandlerArgs`     | `(args: { topic: string; message: TransferMessageSchema }) => void`                                                                                                            | Колбэк публикации; может быть асинхронным — сбой (синхронный или `Promise`-отклонение) получит вызов изолятора                                                                                                                                                                            | нет (структурно)         |
| `TransferSubscribeHandler` / `TransferSubscribeHandlerArgs` | `(args: { topic: string; next: TransferNextFunction; queue?: boolean }) => void`                                                                                               | Колбэк подписки                                                                                                                                                                                                                                                                           | нет (структурно)         |
| `TransferErrorHandler`                                      | `(error: Error) => void`                                                                                                                                                       | Обработчик ошибок, которые некому вернуть вызывающей стороне (см. §«Таймаут ответа и обработка ошибок»)                                                                                                                                                                                   | нет                      |
| `IsolatorOptions`                                           | `{ distributed?: boolean }`                                                                                                                                                    | Опции `@Isolator`; заменяет прежний отдельный классовый декоратор дистрибуции                                                                                                                                                                                                             | нет                      |
| `TransferMessageSchema` / `TransferMessageHeaders`          | `{ headers: { uniqKey?; replyTopic?; error? }; value: any }`                                                                                                                   | Формат сообщения на проводе                                                                                                                                                                                                                                                               | нет (структурно)         |
| `TransferNextFunction`                                      | `(message: TransferMessageSchema) => void`                                                                                                                                     | Обработчик входящего сообщения                                                                                                                                                                                                                                                            | нет                      |
| `TransferCallbackHandler` / `TransferCallbackResponse`      | `(response: { topic; value?; error?; isCompleted? }) => void`                                                                                                                  | Внутренние колбэки RPC                                                                                                                                                                                                                                                                    | нет                      |
| `TransferTopics`                                            | `{ topic: string; replyTopic: string }`                                                                                                                                        | Пара топиков изолированного метода                                                                                                                                                                                                                                                        | нет                      |
| `InstancesData`                                             | `{ instanceName: string; instanceKey: string }`                                                                                                                                | Идентичность узла                                                                                                                                                                                                                                                                         | нет                      |
| `TransferRegisty`                                           | `{ receiver: InstancesData; sender: InstancesData; schemas: any }`                                                                                                             | Сообщение реестра. Имя типа содержит опечатку и она публична                                                                                                                                                                                                                              | нет                      |
| `StructureReceiveSchema` / `StructureCollectorFunction`     | `{ instance: InstancesData; value: any }`; `(data: StructureReceiveSchema) => void`                                                                                            | Данные и колбэк `collectDistributions`                                                                                                                                                                                                                                                    | нет                      |
| `TransferServiceDescriptor`                                 | `{ name; origin: InstancesData; hash; methods: TransferMethodDescriptor[]; components; schemas?: FoldedSchemas }`                                                              | Сериализуемый контракт сервиса; `hash` — от `methods+components+schemas`; `schemas` — свёртка (`@aom-js/schemer` `foldSchemas`), из которой codegen восстанавливает классы (см. `KI-CODEGEN-01`); необязательно в типе — старые (докодгеновские) дескрипторы из кэша реестра его не несут | нет                      |
| `TransferMethodDescriptor`                                  | `{ name; topic; waitForResponse; singleton; queue; args?: Record<string, any>[]; returns? }`                                                                                   | Описание метода в дескрипторе                                                                                                                                                                                                                                                             | нет                      |
| `TopicSchemaType` / `TopicSchemaArg`                        | `ClassConstructor \| string \| [TopicSchemaType]`; `Record<string, TopicSchemaType>`                                                                                           | Типы аргументов `@TopicSchema`                                                                                                                                                                                                                                                            | нет                      |

Определения типов — `packages/transfer/src/defines/types.ts`.

## Внутренние модули

| Файл                                           | Ответственность                                                                                                                                                      | Ключевые символы                                                                                                                                                                                                                                                              |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/transfer/src/index.ts`               | Точка входа: `import "reflect-metadata"` (сайд-эффект) и реэкспорт `./defines`                                                                                       | —                                                                                                                                                                                                                                                                             |
| `packages/transfer/src/defines/index.ts`       | Барель: `export *` из `decorators`, `types`, `main`. Нерабочий черновик реестра удалён и из барели, и из пакета целиком (был `KI-TRANSFER-04`)                       | —                                                                                                                                                                                                                                                                             |
| `packages/transfer/src/defines/main.ts`        | Мета-класс изолятора и транспорт: конфигурация, таймаут ответа, обработчик ошибок, системные топики, реестр дескрипторов, восстановление клиента, адресация инстанса | `AomIsolator`; `TransferTimeoutError`; `Transfer`; `publish`; `reportError`; `toInstance`; `instanceTopic`; `restore`; `collectDistributions`; `requestRegistry`; `acceptRegistry`                                                                                            |
| `packages/transfer/src/defines/decorators.ts`  | Все декораторы пакета и привязка исполнителя                                                                                                                         | `Isolator`; `IsQueue`; `TopicTimeout`; `TopicSchema`; `assertTopicSchemaType`; `distribute` (внутренняя функция для `Isolator(transfer, {distributed: true})`, не экспортируется); `CustomTopic`; `ResponseTopic`; `AutoTopic`; `DefineTopics`; `Executor`; `attachIsolation` |
| `packages/transfer/src/defines/rx-transfer.ts` | RPC поверх `publisher`/`subscriber`: публикация, таймаут ответа, ожидание ответа, маршрутизация по `uniqKey`, конверт ошибок                                         | `RxTransfer`; `request`; `initReplySubscription`; `replyHandler`; `execHandler`; `callbackObserver`                                                                                                                                                                           |
| `packages/transfer/src/defines/types.ts`       | Только типы: конфигурация, формат сообщения, дескрипторы, типы `@TopicSchema`                                                                                        | `TransferConfig`; `TransferErrorHandler`; `IsolatorOptions`; `TransferMessageSchema`; `TransferServiceDescriptor`; `TopicSchemaArg`                                                                                                                                           |
| `packages/transfer/test/memory-bus.ts`         | Не тест, а образцовая тестовая шина: асинхронная доставка, JSON-прогон, лог публикаций, именованные порты и `mute`                                                   | `MemoryBus`; `port`; `mute`; `tick`                                                                                                                                                                                                                                           |
| `packages/transfer/test/*.test.ts`             | Тесты: RPC, дескриптор, дистрибуция, восстановление, кэш реестра, таймаут/ошибки транспорта, `@TopicTimeout`, `@IsQueue`                                             | см. §«Тесты»                                                                                                                                                                                                                                                                  |
| `packages/transfer/dist/`                      | Артефакт сборки: `cjs/`, `mjs/`, `types/`; приложение исполняет именно его                                                                                           | —                                                                                                                                                                                                                                                                             |

## Ключевые механизмы

### Конфигурация Transfer и системные подписки

Конструктор `Transfer` сохраняет колбэки и идентичность узла, проверяет и сохраняет `responseTimeout`/`defaultErrorHandler`, создаёт `callbackMap` и немедленно оформляет две подписки на системные топики `!Transfer_Registry_Request!` и `!Transfer_Registry_Notification!`. Никакой другой инициализации нет: шина должна быть готова принимать подписки к моменту создания объекта.

`packages/transfer/src/defines/main.ts` (`Transfer`)

```ts
  constructor(config: TransferConfig) {
    //
    this.publisher = config.publisher;
    this.subscriber = config.subscriber;

    this.instanceKey = config.instanceKey;
    this.instanceName = config.instanceName;

    this.responseTimeout = config.responseTimeout ?? 30_000;
    if (
      !Number.isInteger(this.responseTimeout) ||
      this.responseTimeout < 0 ||
      this.responseTimeout > 2_147_483_647
    ) {
      throw new RangeError(/* ... */);
    }
    this.defaultErrorHandler =
      config.defaultErrorHandler ?? ((error) => console.error("transfer error", error));

    this.callbackMap = new Map();

    // подписаться на топик, в ответ на который будет отправлен состав имеющихся схем
    this.subscriber({
      topic: this.registryRequestTopic,
      next: (message) => this.requestRegistry(message.value),
    });
    ...
  }
```

`responseTimeout` — целое `0…2 147 483 647` мс, по умолчанию `30 000`; `0` отключает таймаут (ждать без ограничения). Вне диапазона (включая `NaN`/`Infinity`/дробные) конструктор бросает `RangeError` — иначе `setTimeout` с некорректным значением сработал бы почти сразу (комментарий в коде: «через 1 мс — каждый вызов сразу упал бы по таймауту»), и это было бы куда труднее диагностировать. `defaultErrorHandler` по умолчанию — `(error) => console.error("transfer error", error)`; подробности, что именно в него попадает, — в §«Таймаут ответа и обработка ошибок».

Пара `instanceName`/`instanceKey` — не только адрес в протоколе реестра, но и суффикс reply-топика: `` `reply_${topic}_${transfer.instanceKey}_${transfer.instanceName}` `` (`decorators.ts` (`DefineTopics`)). Два узла с одинаковой парой будут слушать один и тот же канал ответов.

Несколько шин в одном проекте — несколько экземпляров `Transfer`: транспорт задаётся на уровне класса — `@Isolator(transfer)` пишет `$.transfer` и `$.rx` в мета-инстанс класса (`decorators.ts` (`Isolator`)), а исполнитель подписывается через транспорт своего родителя-изолятора (`decorators.ts` (`attachIsolation`)).

Evidence: `packages/transfer/src/defines/main.ts` (`Transfer`); `packages/transfer/src/defines/decorators.ts` (`DefineTopics`); `packages/transfer/src/defines/types.ts` (`TransferConfig`); `packages/transfer/test/errors.test.ts` («по умолчанию таймаут 30 000 мс, responseTimeout: 0 его выключает», «responseTimeout вне целых 0…2 147 483 647 мс — RangeError»).

### Таймаут ответа и обработка ошибок

До этой правки таймаута у RPC не было вовсе (`KI-TRANSFER-01`), а ошибка, которую некому вернуть (например, исполнитель у `@CustomTopic`), терялась. Теперь у обоих сценариев есть адресат.

**Таймаут.** `RxTransfer.request` заводит `setTimeout(responseTimeout)` рядом с публикацией запроса; если ответ (или ошибка) не пришёл вовремя, поток завершается `TransferTimeoutError(topic, timeout)`. У `@ResponseTopic` это отклонение возвращаемого `Promise`; у `@CustomTopic` (там `waitForResponse` не выставлен, ответ никто не ждёт явно) — ошибка уходит в `Transfer.reportError`, то есть в `defaultErrorHandler`. Таймер снимается при любом исходе — ответе, ошибке или отписке (`rx-transfer.ts` (`RxTransfer.request`)). Значение берётся так: `$.responseTimeout ?? this.transfer.responseTimeout` — сначала переопределение метода (`@TopicTimeout`, см. ниже), и только если его нет — таймаут транспорта (`rx-transfer.ts` (`RxTransfer.request`)). Таймер `unref()`-нут там, где рантайм это поддерживает (Node): он не держит процесс живым, так что короткоживущий скрипт с зависшим запросом завершится сам, не дожидаясь срабатывания таймаута (`rx-transfer.ts` (`RxTransfer.request`), тест `errors.test.ts` («таймер ответа unref()-нут: не держит процесс живым ни до ответа, ни после отписки»)). При действующем `responseTimeout: 0` (на методе или транспорте) таймер вообще не создаётся — `setTimeout` не вызывается (`rx-transfer.ts` (`RxTransfer.request`), тест `topic-timeout.test.ts` («@TopicTimeout(0) — ответ дольше общего таймаута доходит, таймер ответа не создаётся, утечки нет»)).

**`Transfer.publish`/`Transfer.reportError`.** `publish` — тонкая обёртка над `publisher`, приводящая синхронный `throw` и отклонение асинхронного `publisher` к одному и тому же отклонённому `Promise` (`main.ts` (`Transfer.publish`)). Все внутренние вызовы `publisher` в пакете (RPC-запрос, ответ исполнителя, протокол реестра) идут через неё. `reportError` вызывает `defaultErrorHandler` и подавляет его собственный сбой логированием в `console.error`, чтобы неисправный обработчик ошибок не уронил процесс (`main.ts` (`Transfer.reportError`)).

**Куда уходят ошибки, которые некому вернуть:**

- `@CustomTopic`: ошибка исполнителя, таймаут ответа, сбой публикации запроса — всё в `defaultErrorHandler` через `rx$.subscribe({ error: ... })` (`rx-transfer.ts` (`RxTransfer.request`)).
- Ответ исполнителя (`execHandler`): если сама отправка ответа (успешного или ошибки) не удалась, `defaultErrorHandler` получает ошибку сбоя отправки; если при этом исполнитель ещё и упал, исходная ошибка исполнителя кладётся в `cause` (`rx-transfer.ts` (`RxTransfer.execHandler`), тест `errors.test.ts` («исполнитель упал и ответ-ошибка не ушёл — ошибка исполнителя в cause сбоя отправки»)).
- Протокол реестра: сбой публикации запроса (`collectDistributions`) или ответа (`requestRegistry`) — в `defaultErrorHandler` вызвавшего узла (`main.ts` (`Transfer.collectDistributions`, `Transfer.requestRegistry`)).
- Сбой `publisher` при `@ResponseTopic`/`waitForResponse` не нужен `defaultErrorHandler` отдельно — он приходит как отклонение того же `Promise`, который ждёт вызывающий код (`rx-transfer.ts` (`RxTransfer.request`)).

Синхронный `throw` неасинхронного исполнителя тоже становится ответом-ошибкой (раньше он ронял бы `execHandler` необработанным исключением): вызов реализации теперь обёрнут в `Promise.resolve().then(() => Reflect.apply(handler, ...))` (`rx-transfer.ts` (`RxTransfer.execHandler`), тест `errors.test.ts` («синхронный throw неасинхронного исполнителя доходит до вызывающего как reject»)).

**Почему `responseTimeout: 0` обычно безопасен.** Отправитель всегда кладёт `replyTopic` в заголовки запроса, а исполнитель всегда отвечает — если реализация ничего не вернула, `execHandler` шлёт вместо пустоты `{}` (`undefined` заменяется, прочие falsy-значения — нет, `rx-transfer.ts` (`RxTransfer.execHandler`), §«execHandler…» ниже). Ответ (или ошибка) завершает `Observable`, а в его teardown снимаются таймер, запись в `transfer.callbackMap` и — при `waitForResponse` — запись в `$.topicProcessMap`, то есть блокировка повторного `singletone`-вызова (`rx-transfer.ts` (`RxTransfer.request`)). Поэтому `@CustomTopic` с активным исполнителем не залипает даже при `responseTimeout: 0`, а у синглтона следующий вызов после ответа проходит штатно (тест `errors.test.ts` («singleton-CustomTopic без исполнителя не склеивает следующие вызовы навсегда»), `topic-timeout.test.ts` («@TopicTimeout(0) — ответ дольше общего таймаута доходит, таймер ответа не создаётся, утечки нет», «@TopicTimeout(0) на singleton-CustomTopic без исполнителя — таймер не создаётся, отписка снимает коллбэк»)). Запись остаётся навсегда только там, где ответа не будет вообще — исполнителя никто не подписал, узел умер, ответ потерялся на шине, — и при этом действует `responseTimeout: 0`: без таймера снять `callbackMap`/`topicProcessMap` нечем, кроме явной отписки вызывающей стороны (тест `errors.test.ts` («по умолчанию таймаут 30 000 мс, responseTimeout: 0 его выключает»): `callbackMap.size` остаётся `1`). Это прямая цена выбора «ждать без ограничения», а не дефект — см. также остаточный риск `KI-TRANSFER-01` ниже.

Evidence: `packages/transfer/src/defines/main.ts` (`TransferTimeoutError`, `Transfer`); `packages/transfer/src/defines/rx-transfer.ts` (`RxTransfer.request`, `RxTransfer.execHandler`); `packages/transfer/test/errors.test.ts` (весь файл); `packages/transfer/test/topic-timeout.test.ts` (весь файл).

### `@TopicTimeout`: переопределение таймаута для метода

Методный декоратор фазы FIRST (как и `@TopicSchema`), объявлен рядом с `IsQueue` в `decorators.ts` (`TopicTimeout`). Переопределяет для конкретного метода `responseTimeout`, заданный в `new Transfer({ responseTimeout })` (по умолчанию `30 000` мс): значение метода имеет приоритет, если оно задано, транспортное берётся, только если `@TopicTimeout` на методе нет (`rx-transfer.ts` (`RxTransfer.request`)). Проверка та же, что у `Transfer({ responseTimeout })`: целое `0…2 147 483 647` мс, иначе декоратор сразу бросает `RangeError` (`decorators.ts` (`TopicTimeout`), тест `topic-timeout.test.ts` («дробное, отрицательное и слишком большое значение — RangeError»)). `0` — без ограничения для этого метода, даже если у транспорта задан конечный таймаут (и наоборот: конечное значение на методе действует, даже если у транспорта `0`). Значение хранится в мета-инстансе метода (`AomIsolator.responseTimeout`) и наследуется вместе с методом, как остальные поля `AomIsolator` (тест `topic-timeout.test.ts` («FIRST phase: значение @TopicTimeout переносится на наследника при inherit»): `$._.inherit` переносит `responseTimeout` на наследника).

```ts
class Orphan {
  // без @TopicTimeout — берёт responseTimeout транспорта
  @ResponseTopic()
  static async base(): Promise<void> { ... }

  // короче общего — свой таймаут метода срабатывает раньше
  @TopicTimeout(15)
  @ResponseTopic()
  static async short(): Promise<number> { ... }
}
```

Evidence: `packages/transfer/src/defines/decorators.ts` (`TopicTimeout`); `packages/transfer/src/defines/rx-transfer.ts` (`RxTransfer.request`); `packages/transfer/test/topic-timeout.test.ts` (`Orphan`, все тесты блока «transfer: @TopicTimeout — приоритет над responseTimeout транспорта»).

### Декораторы и фазы

`Isolator` теперь классовый декоратор фазы **INSTANT** (было — FIRST): вызов `AomIsolator.classDecorator(handler, ExecutionPhase.INSTANT)` выполняется сразу и, в отличие от FIRST, не кладётся в `fired` — значит не участвует в переносе при наследовании (`packages/core/src/defines/callstack.ts` (`AomCallstackQueue.add`), тест `packages/transfer/test/distribution.test.ts` («@Isolator — INSTANT: перенос мета-инстанса на наследника его не повторяет»): `@Isolator` на родителе не «протекает» на наследника через `$._.inherit`). Он пишет `$.transfer`, создаёт `$.rx = new RxTransfer(transfer)`, вызывает `$._.apply()` (прогоняет отложенные LAST-очереди класса, его статик и свойств — `packages/core/src/defines/node.ts` (`AomNode.apply`), `packages/core/src/defines/callstack.ts` (`AomCallstack.apply`)) и, если передан `options.distributed`, вызывает внутреннюю `distribute($)` — строго **после** `apply()`, поскольку список изолированных методов (`$.isolatedMethods`) заполняют именно отложенные `DefineTopics` (`decorators.ts` (`DefineTopics`)).

`ResponseTopic`/`CustomTopic` — обёртки над приватным `AutoTopic(waitForResponse, singletone)`, методным декоратором фазы FIRST (без изменений). Он ставит флаги, довешивает через `Reflect.decorate` отложенный `DefineTopics()` и подменяет `descriptor.value`; поле `$.originDescriptorValue`, в котором раньше сохранялось исходное тело метода, убрано — тело изолятора теперь нигде повторно не вызывается (см. §«RxTransfer.request — RPC»).

`packages/transfer/src/defines/decorators.ts` (`AutoTopic`)

```ts
function AutoTopic(waitForResponse: boolean, singletone = false): MethodDecorator {
  return AomIsolator.methodDecorator(($, descriptor) => {
    ...
    $.singletone = singletone;
    $.waitForResponse = waitForResponse;
    // сразу добавим декоратор, который выполнится чуть позже
    Reflect.decorate([DefineTopics()], constructor, propertyKey);
    // Переопределяем оригинальный метод: тело изолятора — интерфейс и не вызывается
    descriptor.value = async (...args: any[]) => {
      const { rx } = $._.root;
      return rx.request(args, $);
    };
  }, ExecutionPhase.FIRST);
}
```

`DefineTopics` — фаза LAST: пушит мета-инстанс метода в `$._.root.isolatedMethods`, вычисляет топик вида `` `${Class}.${method}` `` и `replyTopic`, кладёт их в `topicsMap`/`instancesMap` по ключу-функции (уже подменённой `descriptor.value`) и записывает в `$.topic`/`$.replyTopic` (`decorators.ts` (`DefineTopics`)). Ключ карт — значение функции, поэтому изолируются только статические методы: у нестатических на конструкторе такого свойства нет.

Дистрибуция (`options.distributed`) больше не отдельный декоратор — раньше это был отдельный классовый декоратор фазы LAST, из-за чего порядок его записи относительно `@Isolator` был критичен (`KI-TRANSFER-07`: неверный порядок молча давал пустой дескриптор). Теперь это опция того же `@Isolator`, разбирается синхронно внутри его INSTANT-обработчика — порядка декораторов, который можно перепутать, больше нет.

Evidence: `packages/transfer/src/defines/decorators.ts` (`Isolator`, `AutoTopic`); `packages/core/src/defines/callstack.ts` (`AomCallstackQueue.add`, `AomCallstack.apply`), `packages/core/src/defines/node.ts` (`AomNode.apply`); `packages/transfer/test/distribution.test.ts` («@Isolator — INSTANT: перенос мета-инстанса на наследника его не повторяет»).

### Executor и привязка исполнителя

`@Executor(instanceId?)` — тоже классовый декоратор фазы **INSTANT** (было — без явной фазы, то есть по умолчанию FIRST): подписки создаются один раз в момент декорирования и не переносятся при наследовании, как и `@Isolator`. Он берёт мета-инстанс родителя через `Object.getPrototypeOf(constructor)` и проходит по его `isolatedMethods`. Для каждого изолированного имени проверяется, что у потомка есть **собственный** дескриптор свойства; если нет — предупреждение в консоль, метод остаётся без подписчика.

`packages/transfer/src/defines/decorators.ts` (`Executor`)

```ts
export function Executor(instanceId?: string): ClassDecorator {
  return AomIsolator.classDecorator(($) => {
    const constructor = $._.target;
    const parent$ = AomIsolator.instance(Object.getPrototypeOf(constructor));

    parent$.isolatedMethods.forEach((_$) => {
      const { property } = _$._;
      if (property) {
        if (Reflect.getOwnPropertyDescriptor(constructor, property)) {
          attachIsolation(constructor, property, instanceId);
        } else {
          console.warn(`isolated property "${<string>property}" has no executor`);
        }
      }
    });
  }, ExecutionPhase.INSTANT);
}
```

`attachIsolation` достаёт из карт родителя топик и мета-инстанс метода, формирует адресный топик `Transfer.instanceTopic(topic, instanceId)` и подписывается: `next: rx.execHandler(...)`, `queue: parentProperty$.queue`. Обработчик вызывает реализацию потомка с `this = constructor` (`decorators.ts` (`attachIsolation`)). Если топик в карте не найден — бросается `attached handler is not isolated topic ...` (`decorators.ts` (`attachIsolation`)).

У одного изолятора может быть несколько исполнителей, каждый со своим набором методов: в приложении `PusherExecutor` и `SendMessageExecutor` оба наследуют `PusherIsolator` (`test/src/modules/notifications/executors/pusher/index.ts` (`PusherExecutor`), `test/src/modules/notifications/executors/pusher/send-message.ts` (`SendMessageExecutor`)). Прямой вызов `MathExecutor.sum()` выполняется локально — подменено только тело метода изолятора, не потомка.

Evidence: `packages/transfer/src/defines/decorators.ts` (`Executor`, `attachIsolation`).

### RxTransfer.request — RPC

Сначала строится адресный топик `$._.root.instanceTopic(topic)` (с суффиксом инстанса, если он был задан через `toInstance`) — **строго до** проверки на повторный процесс: `instanceId` одноразовый и должен достаться именно этому вызову, даже если он окажется дублем синглтона. Затем генерируется `uniqKey = randomUUID()`, считается `hash = sha256(JSON.stringify(args))` и собирается ключ процесса уже из адресного топика.

`packages/transfer/src/defines/rx-transfer.ts` (`RxTransfer.request`)

```ts
    const instanceTopic = $._.root.instanceTopic(topic);

    const uniqKey = crypto.randomUUID();

    // получим hash от аргументов
    const hash = crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");

    // создадим ключ процесса в зависимости от того, это синглтон или нет
    // основанием являются адрес и аргументы, для которых вызывается функция
    const topicProcessKey = `${instanceTopic}_${hash}_${$.singletone ? "singletone" : uniqKey}`;
    ...
    // проверим, есть ли существующий процесс для текущего топика (актуально для синглотонов)
    const existsProcess = $.topicProcessMap.get(topicProcessKey);
    // если есть, то вернем его, не запуская процедуру повторно
    if (existsProcess) {
      return existsProcess;
    }
```

Ключ дедупликации теперь включает адрес (`instanceTopic`), а не только топик метода и хэш аргументов — раньше вызовы к разным исполнителям через `toInstance` с одинаковыми аргументами схлопывались в один процесс (`KI-TRANSFER-03`). Заодно закрылась и вторая часть того же дефекта: поскольку адрес читается (и тем самым одноразовый `instanceId` обнуляется) на **каждом** вызове, включая дедуплицированный, он больше не «утекает» на следующий вызов класса (тест `distribution.test.ts` («синглтон к разным исполнителям не склеивается, адрес не переходит на чужой вызов») — параллельные вызовы к разным адресам с одинаковыми аргументами не склеиваются; («синглтон к одному адресу склеивается: одна публикация на оба вызова») — к одному адресу склеиваются, как и раньше).

Поток строится лениво: `defer(initReplySubscription)` → `mergeMap` в `Observable`, который кладёт колбэк в `transfer.callbackMap` по `uniqKey`, публикует сообщение через `transfer.publish(...)` (сбой — синхронный или отклонённый `Promise` — уходит в `observer.error`) и заводит таймер `responseTimeout` (`observer.error(new TransferTimeoutError(...))`, если не выключен); в teardown таймер снимается и колбэк удаляется (`rx-transfer.ts` (`RxTransfer.request`)). Reply-подписка на `replyTopic` создаётся один раз на мета-инстанс метода и помечается в `$.replySubscribers` (`rx-transfer.ts` (`RxTransfer.initReplySubscription`)).

Дальше две ветки. При `waitForResponse` результат — `firstValueFrom(rx$)` с очисткой `topicProcessMap` в `then`/`catch` (`rx-transfer.ts` (`RxTransfer.request`)) — отклонение (ошибка исполнителя, сбой публикации, `TransferTimeoutError`) долетает до вызывающего `await`. Иначе — `rx$.subscribe({ error: (error) => this.transfer.reportError(error) })`, то есть rxjs `Subscription` (наружу она уходит завёрнутой в `Promise` async-обёртки, `decorators.ts` (`AutoTopic`)); повторный вызов исходного тела метода после ответа убран вместе с полем `$.originDescriptorValue` — раньше это было частью `KI-TRANSFER-02` (тест `rpc.test.ts` («тело изолятора CustomTopic не вызывается после ответа исполнителя»): `isolatorCalls` остаётся пустым).

`replyHandler` ищет колбэк по `headers.uniqKey` и передаёт ему `{error, topic}` либо `{topic, value, isCompleted: true}` (`rx-transfer.ts` (`RxTransfer.replyHandler`)); колбэк `callbackObserver` превращает это в `observer.error` либо `next` + `complete` (`rx-transfer.ts` (`callbackObserver`)).

Evidence: `packages/transfer/src/defines/rx-transfer.ts` (`RxTransfer.initReplySubscription`, `RxTransfer.request`, `RxTransfer.replyHandler`); `packages/transfer/test/rpc.test.ts` (все тесты блока «transfer: RPC поверх шины»); `packages/transfer/test/distribution.test.ts` («синглтон к разным исполнителям не склеивается, адрес не переходит на чужой вызов», «синглтон к одному адресу склеивается: одна публикация на оба вызова»); `packages/transfer/test/errors.test.ts` (`Orphan`, `Lagging`, `LaggingExecutor`, «поздний ответ после таймаута игнорируется», «отписка от CustomTopic до ответа снимает коллбэк и таймер»).

### execHandler: конверт ошибок и falsy-результаты

Исполнитель выполняет реализацию через `Promise.resolve().then(() => Reflect.apply(handler, undefined, value))` — так синхронный `throw` неасинхронного исполнителя тоже попадает в `.catch(...)`, а не роняет обработчик необработанным исключением — и публикует результат в `replyTopic`. `undefined` подменяется на `{}` — прочие falsy-значения (`0`, `false`, `""`, `null`) уходят как есть.

`packages/transfer/src/defines/rx-transfer.ts` (`RxTransfer.execHandler`)

```ts
Promise.resolve()
  .then(() => Reflect.apply(handler, undefined, value))
  .then((result) => {
    // если указан топик для ответа, отправляем результат
    // falsy-результаты (0, false, "") легальны — подменяется только undefined
    return (
      replyTopic &&
      this.transfer.publish({
        topic: replyTopic,
        message: {
          value: result === undefined ? {} : result,
          headers: { uniqKey, replyTopic },
        },
      })
    );
  });
```

Исключение не переживает JSON, поэтому в ветке `catch` публикуется конверт `{name, message, status, data}` (для не-объектов — `{message: String(error)}`) с `headers.error = true` (`rx-transfer.ts` (`RxTransfer.execHandler`)). На вызывающей стороне `serializeError` восстанавливает `new Error(message)`, переносит `name` и присваивает `status`/`data` (`rx-transfer.ts` (`callbackObserver`)) — благодаря этому статус ответа-ошибки доезжает до вызывающего кода (тест `rpc.test.ts` («конверт ошибки переносит status и data через сериализующую шину»)).

Ответ публикуется только при наличии `replyTopic` в заголовках, но заголовок ставится всегда, включая `CustomTopic`: ответ нужен, чтобы поток вызывающего завершился и подписка убралась. Если публикация самого ответа (успешного или ошибки) не удаётся, сбой уходит в `transfer.reportError`, а не теряется молча; если при этом исполнитель ещё и упал, исходная ошибка исполнителя приезжает в `cause` ошибки сбоя отправки (`rx-transfer.ts` (`RxTransfer.execHandler`), тест `errors.test.ts` («исполнитель упал и ответ-ошибка не ушёл — ошибка исполнителя в cause сбоя отправки»)).

Evidence: `packages/transfer/src/defines/rx-transfer.ts` (`RxTransfer.execHandler`); `packages/transfer/test/rpc.test.ts` («falsy-результат исполнителя (0) доставляется как есть, а не как {}», «ошибка исполнителя доставляется вызывающему как reject», «конверт ошибки переносит status и data через сериализующую шину»); `packages/transfer/test/errors.test.ts` («ошибка исполнителя CustomTopic уходит в defaultErrorHandler», «синхронный throw неасинхронного исполнителя доходит до вызывающего как reject», «сбой публикации ответа у исполнителя уходит в defaultErrorHandler», «исполнитель упал и ответ-ошибка не ушёл — ошибка исполнителя в cause сбоя отправки»).

### @TopicSchema

Методный декоратор фазы FIRST, описывающий сигнатуру для дескриптора. `args` — массив пар `{ имя: тип }`, ровно одна пара на элемент, имена уникальны; тип — имя скаляра из `SCALAR_TYPE_SCHEMAS` (`string`, `number`, `integer`, `boolean`, `date`, см. `packages/schemer/src/defines/collector.ts` (`SCALAR_TYPE_SCHEMAS`)), класс-компонент-схема (проверяется `AomSchemas.checkExists(type)?.isComponentSchema`) или `[T]` из одного элемента. Все проверки выполняются в момент декорирования и бросают `Error` с префиксом `@TopicSchema Class.method:` (`decorators.ts` (`TopicSchema`, `assertTopicSchemaType`)). Скаляр `"date"` в дескрипторе теперь рендерится как `{"oneOf":[{"format":"date","type":"string"},{"format":"date-time","type":"string"}]}` — та же форма, что даёт `PropertySchema.Date` (было `{"type":"string","format":"date-time"}`, не совпадавшее с реальным рендером свойства; см. `packages/schemer/readme.md` §«Известные дефекты», `KI-SCHEMER-08`).

Три различимых состояния метода: описан (`$.argsSchemas` — массив), явно «аргументов нет» (`@TopicSchema({})` → `[]`) и «не описан» (декоратора нет → `undefined`). Это различие переносится в дескриптор: у неописанного метода поля `args` не будет вовсе (`descriptor.test.ts` («"аргументов нет" и "не описан" различимы: args [] против отсутствия поля»)).

Декоратор методный, а не пер-параметрный, сознательно — ради совместимости со stage-3 декораторами (`decorators.ts` (`TopicSchema`)).

Evidence: `packages/transfer/src/defines/decorators.ts` (`TopicSchema`, `assertTopicSchemaType`); `packages/transfer/test/descriptor.test.ts` («валидация @TopicSchema: дубли имён, чужие классы, неизвестные скаляры, кратные пары», «"аргументов нет" и "не описан" различимы: args [] против отсутствия поля»).

### `@Isolator(transfer, { distributed: true })`: дескриптор сервиса

Раньше сборкой дескриптора занимался отдельный классовый декоратор фазы LAST. Теперь это внутренняя функция `distribute($)`, которую `@Isolator` вызывает сама — синхронно, сразу после `$._.apply()` — если передана опция `distributed: true` (`decorators.ts` (`Isolator`)). По `$.isolatedMethods` строится список `TransferMethodDescriptor` (`name`, `topic`, `waitForResponse`, `singleton`, `queue`), схемы рендерит `SchemasCollector(new Schemer(Transfer.refPointerPrefix))`: компонент-схемы становятся `$ref`, каскад связей складывается в `components`. Это тот же `SchemasCollector`, которым роутер собирает схемы OpenAPI (`packages/router/src/classes/openapi.ts`), — одни и те же `@ComponentSchema`-классы описывают и HTTP-API, и контракт на шине. Метод без `@TopicSchema` даёт `console.warn` и остаётся без поля `args`.

Новое поле дескриптора — `schemas`: собственный формат свёртки схем для codegen (`foldSchemas` из `@aom-js/schemer`, см. `packages/schemer/readme.md` §«foldSchemas»), построенный из тех же классов, что дали `components` (`collector.classes`). Ошибка `foldSchemas` (например, конфликт имени enum) оборачивается с указанием имени сервиса: `distributed service "X": foldSchemas: ...` (тест `descriptor.test.ts` («ошибка foldSchemas при сборке дескриптора называет сервис»)). Без компонент `schemas` — пустой формат 1 (`{format: 1, components: {}, enums: {}}`, тест «без компонентов schemas — пустой формат 1»), то есть поле есть всегда, даже у пустого сервиса. `hash` теперь считается от `{methods, components, schemas}`, а не только от `methods+components` — два дескриптора с одинаковым JSON Schema, но разным `enumName` (не попадающим в JSON Schema), получают разные `hash` (тест `descriptor.test.ts` («hash учитывает schemas: меняется от одного enumName, которого нет в JSON Schema»)).

`packages/transfer/src/defines/decorators.ts` (`distribute`)

```ts
let schemas: FoldedSchemas;
try {
  schemas = foldSchemas(collector.classes.values());
} catch (error) {
  throw new Error(`distributed service "${$._.target.name}": ${(error as Error).message}`, {
    cause: error,
  });
}

const { instanceName, instanceKey } = transfer;
const descriptor: TransferServiceDescriptor = {
  name: $._.target.name,
  origin: { instanceName, instanceKey },
  hash: crypto
    .createHash("sha256")
    .update(JSON.stringify({ methods, components, schemas }))
    .digest("hex"),
  methods,
  components,
  schemas,
};

transfer.registryMap.set(descriptor.name, descriptor);
```

Поля `args`/`returns` записываются только при наличии — дескриптор обязан переживать JSON без потерь (`descriptor.test.ts` («дескриптор переживает JSON-сериализацию без потерь»)). Дескрипторы, собранные до появления `schemas` (кэш реестра со старого узла, старый снапшот `aom-codegen collect`), поля не несут — codegen такие дескрипторы не поддерживает и бросает `codegen: дескриптор до формата 1 — пересоберите collect` при наличии `components` без `schemas` (`packages/codegen/src/defines/emit-schemas.ts` (`emitSchemas`)).

Evidence: `packages/transfer/src/defines/decorators.ts` (`Isolator`, `distribute`); `packages/schemer/src/defines/collector.ts` (`SCALAR_TYPE_SCHEMAS`, `SchemasCollector`); `packages/transfer/test/descriptor.test.ts` («распределённый изолятор кладёт в реестр дескриптор с методами, топиками и происхождением», «именованные аргументы: [{ имя: схема }], скаляры строками, [T] — массив», «дескриптор переживает JSON-сериализацию без потерь», «реестр уезжает по шине запрос-ответом в сериализуемом виде», «schemas — свёртка foldSchemas тех же классов, что дали components», «без компонентов schemas — пустой формат 1», «hash учитывает schemas: меняется от одного enumName, которого нет в JSON Schema», «ошибка foldSchemas при сборке дескриптора называет сервис»).

### Протокол реестра и кэш LWW

`collectDistributions(cb)` фиксирует колбэк-сборщик и публикует свою идентичность в `!Transfer_Registry_Request!` через `transfer.publish(...)` — сбой публикации уходит в `defaultErrorHandler` этого же узла, а не теряется (`main.ts` (`Transfer.collectDistributions`)). На каждом чужом узле `requestRegistry` сравнивает отправителя с собой и, если это не он, публикует в `!Transfer_Registry_Notification!` значение `{receiver, sender, schemas: [...registryMap.values()]}` — массив, а не итератор; сбой этой публикации так же уходит в `defaultErrorHandler` отвечающего узла (`main.ts` (`Transfer.requestRegistry`), тест `errors.test.ts` («сбой publisher у протокола реестра уходит в defaultErrorHandler узла»)).

`acceptRegistry` срабатывает, только если у узла установлен `structureCollector` и `receiver` совпадает с ним. Принятые дескрипторы кэшируются: собственные записи не затираются, чужие заменяются при расхождении `hash`.

`packages/transfer/src/defines/main.ts` (`Transfer.acceptRegistry`)

```ts
if (Array.isArray(schemas)) {
  schemas.forEach((descriptor: TransferServiceDescriptor) => {
    const existing = this.registryMap.get(descriptor.name);
    // собственные дескрипторы не затираются пришедшими копиями
    const isOwn =
      existing?.origin.instanceName === instanceName &&
      existing?.origin.instanceKey === instanceKey;
    // ponytail: last-write-wins по hash; честное версионирование — при необходимости
    if (!isOwn && existing?.hash !== descriptor.hash) {
      this.registryMap.set(descriptor.name, descriptor);
    }
  });
}
```

Так узел, однажды опросивший реестр, становится переизлучателем: контракт остаётся доступен, пока жив хотя бы один видевший его узел (тест `cache.test.ts` гасит источник через `bus.mute("A")`). Узел, который сам никогда не звал `collectDistributions`, ничего не кэширует. Ключевание `registryMap` по имени класса и last-write-wins по `hash` без версий не изменились — это по-прежнему открытая особенность (`KI-TRANSFER-06`).

Evidence: `packages/transfer/src/defines/main.ts` (`Transfer.collectDistributions`, `Transfer.requestRegistry`, `Transfer.acceptRegistry`); `packages/transfer/test/cache.test.ts`; `packages/transfer/test/distribution.test.ts` («{ distributed: true } регистрирует дескриптор в registryMap своего транспорта», «@Isolator — INSTANT: перенос мета-инстанса на наследника его не повторяет»).

### Transfer.restore

`restore(descriptor, instanceId?)` строит вызывающий прокси без исходного класса. Кэш — `restoredMap` по ключу `name:hash:instanceId`, поэтому повторный вызов не плодит reply-подписки (`main.ts` (`Transfer.restoredMap`), тест `restore.test.ts` («повторный restore того же дескриптора возвращает тот же клиент»)). Для каждого метода дескриптора создаётся минимальный двойник мета-инстанса: `topic` из дескриптора, `replyTopic` — от идентичности **потребителя**, пустые `replySubscribers`/`topicProcessMap` и `_.root.instanceTopic` с фиксированным `instanceId`; `client[method.name] = (...args) => rx.request(args, $)` (`main.ts` (`Transfer.restore`)). Флаги `singleton`/`waitForResponse` берутся из дескриптора, поэтому дедупликация синглтона работает как у рукописного изолятора; таймаут ответа — всегда `responseTimeout` транспорта потребителя: `@TopicTimeout` в дескриптор не попадает (`types.ts` (`TransferMethodDescriptor`)). Типизация рантаймовая: без параметра `T` возвращается `Record<string, (...args) => any>`.

Evidence: `packages/transfer/src/defines/main.ts` (`Transfer.restoredMap`, `Transfer.restore`); `packages/transfer/test/restore.test.ts` (все тесты блока «transfer: восстановление клиента из дескриптора»).

### Адресация инстанса

`Transfer.instanceTopic(topic, id)` — это `[topic, id].filter(Boolean).join("_")` (`main.ts` (`Transfer.instanceTopic`)). `@Executor("w1")` подписывается на `Worker.whoami_w1` (`decorators.ts` (`attachIsolation`); тест `distribution.test.ts` («toInstance направляет вызов в топик с суффиксом инстанса»)). На вызывающей стороне `Transfer.toInstance(Worker, "w1")` записывает `instanceId` в классовый мета-инстанс и возвращает конструктор; при следующем `request` метод `AomIsolator.instanceTopic` подставляет и тут же обнуляет его.

`packages/transfer/src/defines/main.ts` (`AomIsolator.instanceTopic`)

```ts
  instanceTopic(topic: string) {
    const result = Transfer.instanceTopic(topic, this.instanceId);
    this.instanceId = undefined;
    return result;
  }
```

Адресация одноразовая и живёт на классе, а не на вызове — отсюда `KI-TRANSFER-03`.

Evidence: `packages/transfer/src/defines/main.ts` (`AomIsolator.instanceTopic`, `Transfer.instanceTopic`, `Transfer.toInstance`); `packages/transfer/src/defines/decorators.ts` (`attachIsolation`); `packages/transfer/test/distribution.test.ts` («toInstance направляет вызов в топик с суффиксом инстанса»).

### MemoryBus как образец тестовой шины

`packages/transfer/test/memory-bus.ts` — не часть публичного API, а образец, на который опираются все тесты пакета и который стоит копировать в тесты приложения. Ключевые свойства: доставка отложена в макротаск (`setTimeout`), сообщение прогоняется через `JSON.parse(JSON.stringify(message))` — несериализуемые значения теряются намеренно, как у реального брокера; лог `published` и счётчик `topicCount(topic)` позволяют проверять число публикаций; именованные порты `port(id)` и `mute(id)` моделируют падение узла; `tick(ms)` — пауза для доставки.

`packages/transfer/test/memory-bus.ts` (`MemoryBus.publisher`)

```ts
publisher = ({ topic, message }: BusMessage) => {
  this.published.push({ topic, message });
  // доставляем через JSON, как реальный брокер: несериализуемые значения теряются намеренно
  const wire = JSON.parse(JSON.stringify(message));
  setTimeout(() => {
    this.subs
      .filter((s) => s.topic === topic && !(s.port && this.muted.has(s.port)))
      .forEach((s) => s.next(wire));
  });
};
```

Методология тестирования приложения — `test/docs/testing.md` §«MemoryBus».

Evidence: `packages/transfer/test/memory-bus.ts`.

### Использование в приложении

Приложение создаёт единственный `Transfer` поверх NATS: `publisher` публикует `JSON.stringify(message)` через `nats.publish`, `subscriber` оформляет `nats.subscribe` с колбэком, читающим `message.json()`. Аргумент `queue`, который передаёт `attachIsolation`, адаптер принимает и превращает в queue-группу NATS (`queue: queue ? topic : undefined`), а колбэк подписки проверяет `err` и оборачивает разбор сообщения в try/catch (`KI-BOOT-02` закрыт 2026-09-21); `instanceName`/`instanceKey` берутся из `INSTANCE_NAME`/`INSTANCE_KEY` окружения, обе заданы в отслеживаемом `test/.env` (`KI-BOOT-01` закрыт). Какие изоляторы объявлены в модулях — §«Как использует приложение» и `test/docs/principles.md` §«Изоляторы и исполнители».

> ⚠️ Риск адаптера (не в пакете `transfer`, а в конфигурации приложения): `subscriber`-колбэк NATS (`@nats-io/nats-core@3.4.0`, транзитивная зависимость `@nats-io/transport-node`) вызывается без `try/catch` вокруг пользовательского `callback(err, message)` — `node_modules/@nats-io/nats-core/lib/protocol.js: processMsg` делает `sub.callback(null, msg)` напрямую из цепочки разбора входящего байтового потока (`ProtocolHandler.dial`: `for await (const b of this.transport) { this.parser.parse(b) }`). Синхронный `throw` внутри `next(...)` (а значит — и внутри `RxTransfer.replyHandler`/`execHandler`, которые `next` вызывает) вылетает из этого `for await` и ловится только внешним `console.log("reader closed", err)` — чтение соединения останавливается для **всех** топиков этого NATS-соединения, не только для упавшего. Действующий адаптер приложения (`test/src/config/aom/transfer.ts`) с 2026-09-21 закрывает это сам: проверяет `err` из колбэка и оборачивает `next(...)` в `try/catch` (`KI-BOOT-02`). Риск остаётся для любого другого адаптера, написанного без этих двух строк. Практический триггер — сообщение без `headers` (см. ниже): `replyHandler`/`execHandler` бросят на деструктуризации `headers` прямо внутри чужого `next`.
> Как обходить: в `subscriber` приложения оборачивать вызов `next(...)` в `try/catch` и логировать/игнорировать ошибку, не давая ей уйти в колбэк библиотеки; проверять `err` из колбэка `nats.subscribe` до вызова `next`.

Evidence: `test/src/config/aom/transfer.ts`; `test/src/config/connections/nats/index.ts`; `test/node_modules/@nats-io/nats-core/lib/protocol.js` (`ProtocolHandler.processMsg`, `ProtocolHandler.dial`).

## Инварианты и подводные камни

- Изолируются только **статические** методы: карты топиков ключуются значением функции на конструкторе (`decorators.ts` (`DefineTopics`)).
- Тело метода изолятора — заглушка (`return undefined as never` / `<any>void 0`); реализация живёт в наследнике с `@Executor`. Тело больше нигде не вызывается — раньше `@CustomTopic` вызывал его повторно после ответа, поле `$.originDescriptorValue` для этого убрано.
- Топик выводится из имени класса (`` `${Class}.${method}` ``): переименование класса меняет канал и рвёт связь с уже развёрнутыми исполнителями.
- `@Isolator` и `@Executor` — декораторы фазы INSTANT: выполняются один раз в момент декорирования и не переносятся при наследовании (`packages/core/src/defines/callstack.ts` (`AomCallstackQueue.add`)). Требование к порядку записи декораторов, критичное для дистрибуции раньше (`KI-TRANSFER-07`), больше не актуально — дистрибуция теперь опция того же `@Isolator`, а не отдельный декоратор.
- Всё, что уходит в `publisher`, обязано быть JSON-сериализуемым: сообщение проходит через сериализацию и на проводе, и в тестовой шине.
- Пара `instanceName`+`instanceKey` должна быть уникальна на шине — иначе reply-топики двух узлов совпадут.
- `subscriber` вызывается синхронно в конструкторе `Transfer` и при декорировании `@Executor`: шина должна быть готова к подписке к моменту импорта модулей с изоляторами.
- `Executor` при отсутствии реализации метода печатает `console.warn` и продолжает — метод просто остаётся без подписчика (`decorators.ts` (`Executor`)).
- Схемы `@TopicSchema` на стороне исполнителя не проверяются: `argsSchemas`/`returnsSchema` читает только сборка дескриптора (`decorators.ts` (`distribute`)), а `execHandler` передаёт в реализацию то, что пришло по шине (`rx-transfer.ts` (`RxTransfer.execHandler`)).
- Ключ `registryMap` — имя класса: два одноимённых распределённых класса на одном транспорте перетирают друг друга (`KI-TRANSFER-06`, не исправлено).
- `responseTimeout` (по умолчанию 30 000 мс) действует на каждый вызов `@ResponseTopic`/`@CustomTopic` независимо от `singletone`; `0` отключает его полностью — использовать с осторожностью, вечно висящий `Promise` из `KI-TRANSFER-01` без таймаута снова возможен.
- Сообщение без `headers` роняет обработку и на стороне вызывающего (`replyHandler`), и на стороне исполнителя (`execHandler`) — деструктуризация `const { uniqKey, error } = headers` / `const { replyTopic, uniqKey } = headers` бросает `TypeError`, если `headers` не задан (`rx-transfer.ts` (`RxTransfer.replyHandler`, `RxTransfer.execHandler`)). Это не исправлено (`KI-TRANSFER-11`); для адаптеров шины (например, NATS, см. §«Использование в приложении») это означает, что синхронный `throw` из `next(...)` может уйти дальше в саму библиотеку транспорта.
- Правки `src` пакета не видны приложению без `bun run build` — приложение исполняет `dist` (см. §«Сборка и потребление»).

### Известные дефекты

Полный реестр с последствиями для приложения — `test/docs/known-issues.md`. Ниже — записи пакета; закрытые оставлены с пометкой «закрыт» для истории, номера не переиспользуются.

> ✅ `KI-TRANSFER-01` (было — дефект, закрыт): `@ResponseTopic` без поднятого исполнителя больше не висит вечно — есть `responseTimeout` (по умолчанию 30 000 мс, `0` выключает) и `TransferTimeoutError`. Метод может задать свой таймаут через `@TopicTimeout(ms)`, с приоритетом над таймаутом транспорта (см. §«Таймаут ответа и обработка ошибок»).
> Evidence: `packages/transfer/src/defines/main.ts` (`TransferTimeoutError`, `Transfer`); `packages/transfer/src/defines/decorators.ts` (`TopicTimeout`); `packages/transfer/src/defines/rx-transfer.ts` (`RxTransfer.request`); `packages/transfer/test/errors.test.ts` («ResponseTopic без исполнителя отклоняется TransferTimeoutError, коллбэк удаляется», «по умолчанию таймаут 30 000 мс, responseTimeout: 0 его выключает», «responseTimeout вне целых 0…2 147 483 647 мс — RangeError»); `packages/transfer/test/topic-timeout.test.ts`.
> Остаточный риск: `responseTimeout: 0` (на транспорте или через `@TopicTimeout(0)` на методе) возвращает прежнее поведение — сознательный выбор конфигурации, не дефект. Цена этого выбора реальна только тогда, когда ответа не будет вообще (исполнителя никто не подписал, узел умер, ответ потерялся): во всех остальных случаях `execHandler` всё равно отвечает (пустым результатом `{}`, если метод ничего не вернул) и снимает и таймер, и блокировку — см. §«Почему `responseTimeout: 0` обычно безопасен».

> `KI-TRANSFER-02` (особенность, частично закрыта): `@CustomTopic` по-прежнему возвращает `Promise<Subscription>` — `await` отдаёт `Subscription` сразу, исполнителя не ждёт. Опасная часть исправлена: раньше после прихода ответа исходное тело метода изолятора вызывалось повторно **без аргументов** (поле `$.originDescriptorValue`) — теперь тело изолятора нигде не вызывается.
> Evidence: `packages/transfer/src/defines/decorators.ts` (`AutoTopic`) (тело подменяется на `async`-стрелку), `packages/transfer/src/defines/rx-transfer.ts` (`RxTransfer.request`) (`rx$.subscribe({ error: ... })`, без повторного вызова тела); тест `packages/transfer/test/rpc.test.ts` («тело изолятора CustomTopic не вызывается после ответа исполнителя»).
> Как обходить: тела методов `@CustomTopic` по-прежнему держать пустыми; если нужен факт завершения — `@ResponseTopic`.

> ✅ `KI-TRANSFER-03` (было — дефект, закрыт): ключ дедупликации синглтона теперь включает адрес (`instanceTopic`, с учётом `toInstance`), а не только топик метода и хэш аргументов; адрес читается (и одноразовый `instanceId` обнуляется) на каждом вызове, включая дедуплицированный, — значения больше не «утекают» в следующий вызов класса.
> Evidence: `packages/transfer/src/defines/rx-transfer.ts` (`RxTransfer.request`); тест `packages/transfer/test/distribution.test.ts` («синглтон к разным исполнителям не склеивается, адрес не переходит на чужой вызов», «синглтон к одному адресу склеивается: одна публикация на оба вызова»).

> ✅ `KI-TRANSFER-04` (было — легаси, закрыт): нерабочий черновик встроенного реестра (нерабочие `Transfer*Isolator`/`*Executor`) удалён из пакета вместе с исходным файлом и своим экспортом из барели, а не просто выведен из употребления.
> Evidence: файла черновика в `packages/transfer/src/defines/` нет, `defines/index.ts` его не реэкспортирует; тест `packages/transfer/test/rpc.test.ts` («TransferTimeoutError экспортируется, черновик реестра и RxTransfer — нет») явно проверяет отсутствие `TransferRegistry`/`TransferRegistryIsolator`/`TransferRegistryExecutor` в публичном API.
> В той же категории (не закрыто): поле `AomIsolator.registry: boolean` (`main.ts` (`AomIsolator.registry`)) по-прежнему не пишется и не читается нигде в пакете; `RxTransfer` (`rx-transfer.ts` (`RxTransfer`)) по-прежнему не экспортируется из барели, снаружи доступен только как значение `AomIsolator.rx`.

> ✅ `KI-TRANSFER-05` (было — дефект, закрыт): глобальная подмена `rxjs.config.onUnhandledError` на верхнем уровне модуля `rx-transfer.ts` убрана; ошибки, которые раньше туда попадали, теперь идут в `defaultErrorHandler` (см. §«Таймаут ответа и обработка ошибок»).
> Evidence: тест `packages/transfer/test/errors.test.ts` («без defaultErrorHandler ошибки логируются console.error; rxjs.config не трогается») — `expect(rxjs.config.onUnhandledError).toBeNull()`.

> ⚠️ Дефект (`KI-TRANSFER-06`, открыт): реестр дескрипторов по-прежнему ключуется именем класса, кэш чужих записей — last-write-wins по `hash` без версий, а узел без `collectDistributions` не переизлучает реестр.
> Evidence: `packages/transfer/src/defines/main.ts` (`Transfer.acceptRegistry`) (сравнение только по `hash`), `main.ts` (`Transfer.acceptRegistry`) (условие `this.structureCollector && receiver === self`).
> Последствия: одноимённые сервисы разных команд перетирают друг друга; при расходящихся версиях побеждает последний ответивший узел; пассивные узлы не помогают доступности контрактов.
> Как обходить: держать имена распределённых классов уникальными в пределах шины; на приложение сейчас не влияет — дистрибуция не используется.

> ✅ `KI-TRANSFER-07` (было — инвариант/риск, закрыт вместе с изменением API): порядок классового декоратора дистрибуции и `@Isolator` был критичен, потому что это были два разных декоратора в разных фазах. Теперь дистрибуция — опция `{ distributed: true }` того же `@Isolator`, разбирается синхронно внутри одного INSTANT-обработчика: перепутать порядок больше нельзя, потому что декоратор один.
> Evidence: `packages/transfer/src/defines/decorators.ts` (`Isolator`).

> ⚠️ Дефект (`KI-TRANSFER-11`, в пакете не исправлен; обход — в адаптере приложения): сообщение без `headers` роняет обработку и у вызывающего (`replyHandler`), и у исполнителя (`execHandler`) — `const { uniqKey, error } = headers` / `const { replyTopic, uniqKey } = headers` бросают `TypeError`, если `headers` не задан (`undefined`).
> Evidence: `packages/transfer/src/defines/rx-transfer.ts` (`RxTransfer.replyHandler`, `RxTransfer.execHandler`); тестов на сообщение без `headers` в `packages/transfer/test/` нет.
> Последствия: для реальных шин (не `MemoryBus`, который сам генерирует заголовки) сообщение без `headers` — не гипотетический случай (сторонний паблишер в тот же топик, ошибка сериализации со стороны адаптера); синхронный `throw` внутри `next(...)` в свою очередь может уйти в саму библиотеку транспорта — см. предупреждение в §«Использование в приложении» про `@nats-io/nats-core`.
> Как обходить: адаптеру `subscriber` гарантировать, что `next` получает только сообщения с `headers` (хотя бы `{}`), либо оборачивать вызов `next` в `try/catch` на стороне адаптера — адаптер приложения так и делает (`test/src/config/aom/transfer.ts`).

Два дефекта приложения относились к настройке транспорта, оба закрыты (реестр приложения): `KI-BOOT-01` (`INSTANCE_NAME` не было в окружении, reply-топики получали вид `reply_<topic>_<key>_undefined`; теперь переменная задана в `test/.env`) и `KI-BOOT-02` (адаптер передаёт `queue` и создаёт queue-группу; `test/src/config/aom/transfer.ts`).

### Легаси и мёртвый код

Нерабочий черновик встроенного реестра (был здесь как `KI-TRANSFER-04`) удалён полностью — см. запись выше. Из легаси в пакете остались только два мелких пункта, перечисленных там же (`AomIsolator.registry`, неэкспортируемый `RxTransfer`).

## Как использует приложение

Приложение использует пять экспортов: `Transfer`, `Isolator`, `Executor`, `ResponseTopic`, `CustomTopic`. Паттерн (раскладка `isolators/` + `executors/`, подключение через `import "./executors"` в `modules/<module>/index.ts`, таблица всех изоляторов) описан в `test/docs/principles.md` §«Изоляторы и исполнители»; ниже — три характерных места.

**Тяжёлая обработка файлов.** `FilesIsolator` объявляет шесть методов-заглушек с `@ResponseTopic(true)` — синглтон по аргументам: параллельные запросы одного и того же превью не породят двух конвертаций (`test/src/modules/files/isolators/files.ts` (`FilesIsolator`)). Реализация — `FilesExecutor extends FilesIsolator` с `sharp` и хранилищем (`test/src/modules/files/executors/index.ts` (`FilesExecutor`)). Вызов идёт из доменного класса: `await FilesIsolator.MakePreview(file.id)` (`test/src/modules/files/classes/Files/Relations.ts` (`FilesRelationsProcessing.Preview`)).

**Постобработка из хука сущности.** `TicketsIsolator.CommentProcessing` помечен `@CustomTopic(true)` (`test/src/modules/tickets/isolators/tickets.ts` (`TicketsIsolator.CommentProcessing`)) и вызывается из хука MikroORM `@AfterCreate` комментария — обработка счётчиков и уведомлений выносится из транзакции запроса (`test/src/modules/tickets/entities/postgres/Tickets/Comments.ts` (`TicketsComments.NewCommentAdded`)).

**Синхронный по смыслу вызов через шину.** `PusherIsolator.RegisterMessage` объявлен `@ResponseTopic()` и в маршруте авторизации результат ожидается: `const result = await PusherIsolator.RegisterMessage(login!.id, message)` (`test/src/modules/notifications/isolators/pusher.ts` (`PusherIsolator.RegisterMessage`); `test/src/modules/auth/api/routes/index.ts` (`AuthRoute.RequestCode`)). Без запущенного модуля `notifications` вызов отклоняется `TransferTimeoutError` по `responseTimeout` транспорта (адаптер приложения его не задаёт — действует 30 000 мс), `KI-AUTH-03`; до закрытия `KI-TRANSFER-01` такой запрос висел вечно.

Вторая половина API — `@TopicSchema`, `Isolator(transfer, { distributed: true })`, `@IsQueue`, `collectDistributions`, `restore`, `toInstance` — в приложении не встречается; дистрибуция задействована только тестами пакета и `@aom-js/codegen`.

## Сборка и потребление

Сборка стандартная для пакетов ядра: `bun run build:transfer` в корне ядра (эквивалент `bun --filter @aom-js/transfer build`) прогоняет `tsc` трижды — `tsconfig.build.json` → `dist/cjs`, `tsconfig.build.mjs.json` → `dist/mjs`, `tsconfig.build.types.json` → `dist/types` — и затем `node ../../scripts/post-build.js`, который дописывает расширения относительным импортам и кладёт `dist/cjs/package.json` с `{type: "commonjs"}` (`packages/transfer/package.json`). Манифест генерируется скриптами (`package.src.json`, `package.version.json` — версия `0.0.7`), править его напрямую не следует. Приложение подключает пакет симлинком `test/node_modules/@aom-js/transfer` и через `exports` попадает в `dist/mjs`; **правки `src` не видны приложению без `bun run build`**. Тесты монорепо, напротив, резолвят алиас `@aom-js/transfer` на `packages/transfer/src`. Полная схема сборки и dist-потребления — `main/docs/architecture.md` §«Сборка, тесты…» и §«Как приложение потребляет ядро».

## Тесты

### Что покрыто

| Файл                                               | Что проверяет                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/transfer/test/rpc.test.ts`               | Роундтрип `@ResponseTopic` и reply-топик `reply_MathService.sum_k1_test-node`; falsy-результат `0` доставляется как есть; ошибка исполнителя приходит как `reject`; конверт ошибки переносит `status`/`data` через сериализующую шину; синглтон дедуплицирует параллельные вызовы с одинаковыми аргументами (одна публикация) и не дедуплицирует с разными; `@CustomTopic` доходит до исполнителя и не вызывает тело изолятора после ответа; публичный API не содержит черновика встроенного реестра/`RxTransfer`, но содержит `TransferTimeoutError`                                                                                                                                                                                                                                                                                                                           |
| `packages/transfer/test/descriptor.test.ts`        | Состав дескриптора `{ distributed: true }`; именованные `args`, скаляры и `[T]`; пять ошибок валидации `@TopicSchema`; различимость `args: []` и отсутствия поля; `console.warn` для метода без `@TopicSchema`; каскад `components` (`GoodDto` → `PriceDto`); JSON-идемпотентность дескриптора (включая `schemas`); запрос-ответ реестра по шине; `schemas` — `foldSchemas` тех же классов; пустой формат 1 без компонент; `hash` меняется от `enumName`; ошибка `foldSchemas` называет сервис                                                                                                                                                                                                                                                                                                                                                                                  |
| `packages/transfer/test/distribution.test.ts`      | `toInstance` направляет вызов в топик `Worker.whoami_w1`, безадресный топик не используется; синглтон к разным адресам не склеивается, к одному — склеивается; `{ distributed: true }` регистрирует дескриптор в `registryMap`; `@Isolator` (INSTANT) не переносится на наследника через `inherit`; `collectDistributions` получает схемы чужого узла; узел не отвечает сам себе                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `packages/transfer/test/restore.test.ts`           | Восстановленный прокси вызывает удалённый метод и получает результат; ошибка со `status` доходит через прокси; повторный `restore` возвращает тот же клиент                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `packages/transfer/test/cache.test.ts`             | Узел B кэширует дескриптор A и раздаёт его C после `bus.mute("A")`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `packages/transfer/test/errors.test.ts`            | `responseTimeout` по умолчанию 30 000 мс и `0` его отключает; вне диапазона — `RangeError`; таймаут `@ResponseTopic` без исполнителя даёт `TransferTimeoutError`, коллбэк и таймер снимаются; таймер ответа `unref()`-нут и не держит процесс живым ни до ответа, ни после отписки; таймаут/ошибка `@CustomTopic` без исполнителя уходят в `defaultErrorHandler` (по умолчанию — `console.error`); синглтон-`CustomTopic` без исполнителя не склеивает вызовы навсегда; синхронный `throw` неасинхронного исполнителя доходит как `reject`; сбой `publisher` (синхронный и асинхронный) отклоняет вызов и снимает коллбэк; сбой отправки ответа исполнителя уходит в `defaultErrorHandler`, ошибка исполнителя — в `cause`; сбой `publisher` у протокола реестра — в `defaultErrorHandler` узла; сбой самого `defaultErrorHandler` (синхронный и асинхронный) не роняет процесс |
| `packages/transfer/test/topic-timeout.test.ts`     | `@TopicTimeout` перекрывает `responseTimeout` транспорта в обе стороны (короче/длиннее общего); без декоратора берётся таймаут транспорта; `@TopicTimeout(0)` не создаёт таймер даже при ненулевом таймауте транспорта — ни у `@ResponseTopic`, ни у синглтон-`@CustomTopic` без исполнителя; дробное/отрицательное/слишком большое значение — `RangeError`; значение наследуется на потомка через `$._.inherit`                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `packages/transfer/test/is-queue.test.ts`          | `@IsQueue` доводит признак очереди до аргументов `subscriber` (`queue: true`), у метода без декоратора признак отсутствует                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

Все тесты работают на `MemoryBus`, каждая группа создаёт свои `Transfer` с уникальными `instanceName`/`instanceKey` на общей шине.

### Expected-fail

Их нет: в пакете ни одного `it.fails` (`grep -rn "it\.fails" packages/transfer/test` — пусто). Ранее известный дефект falsy-результатов (`result || {}`) исправлен и закрыт обычным проходящим тестом `rpc.test.ts` («falsy-результат исполнителя (0) доставляется как есть, а не как {}»). Политика характеризационных тестов — `test/docs/testing.md`.

### Пробелы

- `@IsQueue` вместе с адресным `Executor(instanceId)` не проверен (признак `queue` у безадресного исполнителя проверяет `is-queue.test.ts`).
- Нет теста на `console.warn` у `Executor` при методе без реализации.
- Нет теста на LWW-замену при расхождении `hash` и на «собственный дескриптор не затирается» (`KI-TRANSFER-06`, по-прежнему открыт).
- Нет теста на конкурентный `toInstance` (два интерливающихся вызова между `toInstance()` и следующим вызовом метода).
- Нет теста `restore` с `instanceId` и с изменившимся `hash`.
- Нет теста на сообщение без `headers` (`KI-TRANSFER-11`, см. §«Известные дефекты»).
- Не покрыт конверт для ошибки-не-объекта (`throw "str"`) в `execHandler`.

### Как запускать

```bash
bunx vitest run packages/transfer
```

## Расхождения с историческими заметками

| Заметка                                                            | Утверждение                                                                                                      | Фактически                                                                                                                                                                                                                 | Evidence                                                                                                                                                                               |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `main/docs/isolators.md` (исторический), пример NATS               | Адаптер строится на `StringCodec` и `JSON.parse(sc.decode(message.data))`                                        | Конфигурация приложения на `@nats-io/transport-node` публикует строку напрямую и читает `message.json()`; `StringCodec` не используется                                                                                    | `test/src/config/aom/transfer.ts`                                                                                                                                                      |
| `main/docs/isolators.md` (исторический), дистрибуция               | Дескрипторы применяются через CLI `aom-codegen`, дистрибуция подразумевается используемой                        | В приложении нет ни одного вызова опции дистрибуции `@Isolator`/`@TopicSchema`/`restore`/`collectDistributions`; дистрибуция задействована только тестами пакета и `@aom-js/codegen`                                       | `packages/codegen/src/defines/collect.ts` (`collect`); отсутствие вхождений в `test/src`                                                                                               |
| `main/docs/isolators.md` (исторический), дизайн-лог                | Черновой `requestRegistry` публикует `this.registryMap.entries()`                                                | В реализации уходит массив `[...registryMap.values()]` — сериализуемый; дизайн-лог помечен автором как история решений                                                                                                     | `packages/transfer/src/defines/main.ts` (`Transfer.requestRegistry`)                                                                                                                   |
| `main/packages/transfer/readme.md` (прежняя версия)                | «Abstract data transfer module.»                                                                                 | Единственная строка описания; фактическая документация жила в JSDoc и в `main/docs/isolators.md` (теперь исторический). Файл перезаписан настоящим документом                                                                                      | прежнее содержимое файла, 3 строки                                                                                                                                                     |
| `main/docs/codegen.md`                                             | Раздел о кодогенерации                                                                                           | Файл — 5 строк вступления без содержания; контракт кодогенерации описан в `packages/codegen/readme.md`                                                                                                                     | `main/docs/codegen.md:1-5`                                                                                                                                                             |

## Открытые вопросы

> ❓ Открытый вопрос: должен ли `RxTransfer` экспортироваться публично — вопрос про нерабочий черновик встроенного реестра снялся сам собой его удалением, но `RxTransfer` (центральный, рабочий класс) по-прежнему доступен только как значение `AomIsolator.rx`.

> ❓ Открытый вопрос: сообщение без `headers` роняет `replyHandler`/`execHandler` (см. §«Известные дефекты») — стоит ли пакету защищаться от этого самому (например, `headers ?? {}`), или это обязанность каждого адаптера шины?

> ❓ Открытый вопрос: останутся ли изоляторы статическими — исторический черновик `main/docs/isolators.md` (раздел «Изолятор в инстансах») обсуждает перевод на инстансы, что затронуло бы всё API пакета?
