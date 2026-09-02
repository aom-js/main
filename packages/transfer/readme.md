# `@aom-js/transfer`

Пакет описывает изоляторы: класс-контракт со статическими методами-заглушками, вызов которых публикует сообщение в шину, и класс-исполнитель, который на эти сообщения подписан. Здесь же — RPC поверх абстрактного транспорта, reply-топики, дедупликация синглтонов, сериализуемые дескрипторы сервисов и протокол их дистрибуции. Документ — единственный источник истины по механике изоляторов; состояние на 2026-09-02.
Читать до: `packages/core/readme.md` (фазы декораторов, узел, наследование), `packages/schemer/readme.md` (`SchemasCollector`). Читать после: `test/docs/principles.md` §«Изоляторы и исполнители» (паттерн в приложении), `packages/codegen/readme.md` (потребитель дескриптора). Термины — `test/docs/README.md#словарь`.

## Назначение и место в стеке

Пакет даёт два декоратора-роли. `@Isolator(transfer)` привязывает класс к транспорту (`Transfer`) и «закрывает» его: методы, помеченные `@ResponseTopic()`/`@CustomTopic()`, получают топик вида `` `${Class}.${method}` `` и подменённое тело — вместо исходного кода вызывается публикация сообщения в шину (`packages/transfer/src/defines/decorators.ts:219-238`, топик — `decorators.ts:187-198`). `@Executor(instanceId?)` на наследнике изолятора подписывает собственные реализации статических методов на те же топики (`decorators.ts:245-263`). Транспорт при этом абстрактен: `Transfer` знает только пару колбэков `publisher`/`subscriber` и идентичность узла `instanceName`/`instanceKey` (`packages/transfer/src/defines/main.ts:67-119`).

Зависимости: `@aom-js/core` — мета-класс `AomIsolator extends AomCore` и фазы исполнения декораторов; `@aom-js/schemer` — `SchemasCollector`, `Schemer`, `SCALAR_TYPE_SCHEMAS`, `AomSchemas` для схем аргументов; `rxjs` — ожидание ответа и очистка подписок; `reflect-metadata`; `node:crypto` (`randomUUID`, `createHash`) — пакет node-only. Полный граф пакетов ядра — в `main/docs/architecture.md` §«Состав…».

Потребители два. Приложение использует только `Transfer`, `Isolator`, `Executor`, `ResponseTopic`, `CustomTopic` — шина поверх NATS, изоляторы в модулях `files`, `notifications`, `tickets` (см. §«Как использует приложение»). Пакет `@aom-js/codegen` потребляет вторую половину API — `TransferServiceDescriptor` и `collectDistributions` (`packages/codegen/src/defines/collect.ts:1-29`, `packages/codegen/src/defines/types.ts:1`); дистрибуция дескрипторов в приложении не задействована.

## Публичный API

Экспортируется всё из `src/defines/index.ts` (`decorators`, `types`, `main`, `registry`); `rx-transfer.ts` в барель не включён.

### Классы и транспорт

| Экспорт | Сигнатура | Назначение | Используется приложением |
|---|---|---|---|
| `Transfer` | `new Transfer(config: TransferConfig)`; поля `instanceName`, `instanceKey`, `publisher`, `subscriber`, `callbackMap`, `registryMap`, `registryRequestTopic`, `registryResponseTopic` | Конфигурация шины и узел протокола реестра | да (`test/src/config/aom/transfer.ts:8-25`) |
| `Transfer.toInstance` | `static toInstance<T>(constructor: T, instanceId: string): T` | Одноразово адресует следующий вызов изолятора конкретному исполнителю | нет |
| `Transfer.instanceTopic` | `static instanceTopic(topic: string, instanceId?: string): string` | `topic_instanceId` либо `topic` | нет |
| `Transfer.refPointerPrefix` | `static readonly refPointerPrefix = "#/components/schemas/"` | Префикс `$ref` для схем в дескрипторе | нет |
| `Transfer.prototype.restore` | `restore<T>(descriptor: TransferServiceDescriptor, instanceId?: string): T` | Вызывающий прокси из дескриптора без исходного класса; кэш по `name:hash:instanceId` | нет |
| `Transfer.prototype.collectDistributions` | `collectDistributions(cb: StructureCollectorFunction): void` | Опрос шины на дескрипторы; включает кэширование чужих дескрипторов | нет |
| `AomIsolator` | `class AomIsolator extends AomCore` — `transfer`, `rx`, `singletone`, `waitForResponse`, `argsSchemas?`, `returnsSchema?`, `originDescriptorValue`, `queue`, `registry`, `replySubscribers`, `topicProcessMap`, `isolatedMethods`, `topicsMap`, `instancesMap`, `instanceId?`, `topic`, `replyTopic`, `instanceTopic(topic)` | Мета-класс изолятора: узел метаданных класса и метода | нет |
| `RxTransfer` | `new RxTransfer(transfer)`; `request(value, $)`, `initReplySubscription($)`, `replyHandler(topic)`, `execHandler(handler)` | RPC-ядро. **Не экспортируется**: `rx-transfer.ts` не входит в `defines/index.ts`, снаружи доступен только как значение `AomIsolator.rx` | нет |
| `TransferRegistry`, `TransferRegistryIsolator`, `TransferRegistryExecutor` | `static Init(transfer) {}`; `@ResponseTopic() static Request(value: string) {}` | Черновик реестра, нерабочий (нет `@Isolator`/`@Executor`), но экспортируется — см. `KI-TRANSFER-04` | нет |

### Декораторы

| Экспорт | Сигнатура | Назначение | Используется приложением |
|---|---|---|---|
| `Isolator` | `Isolator(transfer: Transfer): ClassDecorator` | Привязывает класс к шине и разбирает отложенные (LAST) очереди класса | да (`test/src/modules/files/isolators/files.ts:9`) |
| `ResponseTopic` | `ResponseTopic(singletone?: boolean): MethodDecorator` | Топик с ожиданием ответа; вызов возвращает `Promise` результата | да (`test/src/modules/notifications/isolators/pusher.ts:12,17`) |
| `CustomTopic` | `CustomTopic(singletone?: boolean): MethodDecorator` | Топик без ожидания ответа; вызов возвращает `Promise`, немедленно резолвящийся rxjs `Subscription` (обёртка `descriptor.value` объявлена `async`, `decorators.ts:232`) | да (`test/src/modules/tickets/isolators/tickets.ts:7,13`) |
| `Executor` | `Executor(instanceId?: string): ClassDecorator` | Наследник-исполнитель: подписки на топики родителя | да (`test/src/modules/files/executors/index.ts:12`) |
| `IsQueue` | `IsQueue(): MethodDecorator` | `queue: true` в аргументах `subscriber` (один исполнитель, не все) | нет |
| `TopicSchema` | `TopicSchema(schema: { args?: TopicSchemaArg[]; returns?: TopicSchemaType }): MethodDecorator` | Схемы аргументов/ответа для дескриптора; валидация в момент декорирования | нет |
| `IsDistributed` | `IsDistributed(): ClassDecorator` | Собирает `TransferServiceDescriptor` и кладёт в `transfer.registryMap` | нет |

### Типы

| Экспорт | Сигнатура | Назначение | Используется приложением |
|---|---|---|---|
| `TransferConfig` | `{ instanceName; instanceKey; publisher: TransferPublishHandler; subscriber: TransferSubscribeHandler }` | Аргумент конструктора `Transfer` | нет (структурно) |
| `TransferPublishHandler` / `TransferPublishHandlerArgs` | `(args: { topic: string; message: TransferMessageSchema }) => void` | Колбэк публикации | нет (структурно) |
| `TransferSubscribeHandler` / `TransferSubscribeHandlerArgs` | `(args: { topic: string; next: TransferNextFunction; queue?: boolean }) => void` | Колбэк подписки | нет (структурно) |
| `TransferMessageSchema` / `TransferMessageHeaders` | `{ headers: { uniqKey?; replyTopic?; error? }; value: any }` | Формат сообщения на проводе | нет (структурно) |
| `TransferNextFunction` | `(message: TransferMessageSchema) => void` | Обработчик входящего сообщения | нет |
| `TransferCallbackHandler` / `TransferCallbackResponse` | `(response: { topic; value?; error?; isCompleted? }) => void` | Внутренние колбэки RPC | нет |
| `TransferTopics` | `{ topic: string; replyTopic: string }` | Пара топиков изолированного метода | нет |
| `InstancesData` | `{ instanceName: string; instanceKey: string }` | Идентичность узла | нет |
| `TransferRegisty` | `{ receiver: InstancesData; sender: InstancesData; schemas: any }` | Сообщение реестра. Имя типа содержит опечатку и она публична | нет |
| `StructureReceiveSchema` / `StructureCollectorFunction` | `{ instance: InstancesData; value: any }`; `(data: StructureReceiveSchema) => void` | Данные и колбэк `collectDistributions` | нет |
| `TransferServiceDescriptor` | `{ name; origin: InstancesData; hash; methods: TransferMethodDescriptor[]; components }` | Сериализуемый контракт сервиса | нет |
| `TransferMethodDescriptor` | `{ name; topic; waitForResponse; singleton; queue; args?: Record<string, any>[]; returns? }` | Описание метода в дескрипторе | нет |
| `TopicSchemaType` / `TopicSchemaArg` | `ClassConstructor \| string \| [TopicSchemaType]`; `Record<string, TopicSchemaType>` | Типы аргументов `@TopicSchema` | нет |

Определения типов — `packages/transfer/src/defines/types.ts:7-164`.

## Внутренние модули

| Файл | Ответственность | Ключевые символы |
|---|---|---|
| `packages/transfer/src/index.ts` | Точка входа: `import "reflect-metadata"` (сайд-эффект) и реэкспорт `./defines` | — |
| `packages/transfer/src/defines/index.ts` | Барель: `export *` из `decorators`, `types`, `main`, `registry` | — |
| `packages/transfer/src/defines/main.ts` | Мета-класс изолятора и транспорт: конфигурация, системные топики, реестр дескрипторов, восстановление клиента, адресация инстанса | `AomIsolator`; `Transfer`; `toInstance`; `instanceTopic`; `restore`; `collectDistributions`; `requestRegistry`; `acceptRegistry` |
| `packages/transfer/src/defines/decorators.ts` | Все декораторы пакета и привязка исполнителя | `Isolator`; `IsQueue`; `TopicSchema`; `assertTopicSchemaType`; `IsDistributed`; `CustomTopic`; `ResponseTopic`; `AutoTopic`; `DefineTopics`; `Executor`; `attachIsolation` |
| `packages/transfer/src/defines/rx-transfer.ts` | RPC поверх `publisher`/`subscriber`: публикация, ожидание ответа, маршрутизация по `uniqKey`, конверт ошибок | `RxTransfer`; `request`; `initReplySubscription`; `replyHandler`; `execHandler`; `callbackObserver` |
| `packages/transfer/src/defines/types.ts` | Только типы: конфигурация, формат сообщения, дескрипторы, типы `@TopicSchema` | `TransferConfig`; `TransferMessageSchema`; `TransferServiceDescriptor`; `TopicSchemaArg` |
| `packages/transfer/src/defines/registry.ts` | Черновик реестра; нерабочий, но экспортируемый (см. `KI-TRANSFER-04`) | `TransferRegistry`; `TransferRegistryIsolator`; `TransferRegistryExecutor` |
| `packages/transfer/test/memory-bus.ts` | Не тест, а образцовая тестовая шина: асинхронная доставка, JSON-прогон, лог публикаций, именованные порты и `mute` | `MemoryBus`; `port`; `mute`; `tick` |
| `packages/transfer/test/*.test.ts` | Пять файлов тестов: RPC, дескриптор, дистрибуция, восстановление, кэш реестра | см. §«Тесты» |
| `packages/transfer/dist/` | Артефакт сборки: `cjs/`, `mjs/`, `types/`; приложение исполняет именно его | — |

## Ключевые механизмы

### Конфигурация Transfer и системные подписки

Конструктор `Transfer` сохраняет колбэки и идентичность узла, создаёт `callbackMap` и немедленно оформляет две подписки на системные топики `!Transfer_Registry_Request!` и `!Transfer_Registry_Notification!`. Никакой другой инициализации нет: шина должна быть готова принимать подписки к моменту создания объекта.

`packages/transfer/src/defines/main.ts:98-119`

```ts
  constructor(config: TransferConfig) {
    //
    this.publisher = config.publisher;
    this.subscriber = config.subscriber;

    this.instanceKey = config.instanceKey;
    this.instanceName = config.instanceName;

    this.callbackMap = new Map();

    // подписаться на топик, в ответ на который будет отправлен состав имеющихся схем
    this.subscriber({
      topic: this.registryRequestTopic,
      next: (message) => this.requestRegistry(message.value),
    });
    ...
  }
```

Пара `instanceName`/`instanceKey` — не только адрес в протоколе реестра, но и суффикс reply-топика: `` `reply_${topic}_${transfer.instanceKey}_${transfer.instanceName}` `` (`decorators.ts:194`). Два узла с одинаковой парой будут слушать один и тот же канал ответов.

Evidence: `packages/transfer/src/defines/main.ts:88-92,98-119`; `packages/transfer/src/defines/decorators.ts:194`; `packages/transfer/src/defines/types.ts:108-126`.

### Декораторы и фазы

`Isolator` — классовый декоратор фазы FIRST (второй аргумент `classDecorator` не передан, а его значение по умолчанию — `ExecutionPhase.FIRST`, `packages/core/src/defines/core.ts:521-534`). Он пишет `$.transfer`, создаёт `$.rx = new RxTransfer(transfer)` и вызывает `$._.apply()`, который прогоняет отложенные LAST-очереди класса, его статик и свойств (`packages/core/src/defines/core.ts:282-301`, `208-213`).

`ResponseTopic`/`CustomTopic` — обёртки над приватным `AutoTopic(waitForResponse, singletone)`, методным декоратором фазы FIRST. Он ставит флаги, сохраняет исходное тело в `$.originDescriptorValue`, довешивает через `Reflect.decorate` отложенный `DefineTopics()` и подменяет `descriptor.value`.

`packages/transfer/src/defines/decorators.ts:219-238`

```ts
function AutoTopic(waitForResponse: boolean, singletone = false): MethodDecorator {
  return AomIsolator.methodDecorator(($, descriptor) => {
    ...
    $.singletone = singletone;
    $.waitForResponse = waitForResponse;
    $.originDescriptorValue = descriptor.value;
    // сразу добавим декоратор, который выполнится чуть позже
    Reflect.decorate([DefineTopics()], constructor, propertyKey);
    // Переопределяем оригинальный метод
    descriptor.value = async (...args: any[]) => {
      const { rx } = $._.root;
      return rx.request(args, $);
    };
  }, ExecutionPhase.FIRST);
}
```

`DefineTopics` — фаза LAST: пушит мета-инстанс метода в `$._.root.isolatedMethods`, вычисляет топик вида `` `${Class}.${method}` `` и `replyTopic`, кладёт их в `topicsMap`/`instancesMap` по ключу-функции (уже подменённой `descriptor.value`) и записывает в `$.topic`/`$.replyTopic` (`decorators.ts:176-211`). Ключ карт — значение функции, поэтому изолируются только статические методы: у нестатических на конструкторе такого свойства нет.

`IsDistributed` — классовый декоратор LAST (`decorators.ts:154`), из-за чего порядок классовых декораторов жёсткий — см. §«Инварианты и подводные камни» (`KI-TRANSFER-07`).

Evidence: `packages/transfer/src/defines/decorators.ts:20-29,105-155,162-173,176-238`; `packages/core/src/defines/core.ts:80,99-113,208-213,282-301,521-534,557-573`.

### Executor и привязка исполнителя

`@Executor(instanceId?)` берёт мета-инстанс родителя через `Object.getPrototypeOf(constructor)` и проходит по его `isolatedMethods`. Для каждого изолированного имени проверяется, что у потомка есть **собственный** дескриптор свойства; если нет — предупреждение в консоль, метод остаётся без подписчика.

`packages/transfer/src/defines/decorators.ts:245-263`

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
  });
}
```

`attachIsolation` достаёт из карт родителя топик и мета-инстанс метода, формирует адресный топик `Transfer.instanceTopic(topic, instanceId)` и подписывается: `next: rx.execHandler(...)`, `queue: parentProperty$.queue`. Обработчик вызывает реализацию потомка с `this = constructor` (`decorators.ts:271-300`). Если топик в карте не найден — бросается `attached handler is not isolated topic ...` (`decorators.ts:282-284`).

У одного изолятора может быть несколько исполнителей, каждый со своим набором методов: в приложении `PusherExecutor` и `SendMessageExecutor` оба наследуют `PusherIsolator` (`test/src/modules/notifications/executors/pusher/index.ts:12-13`, `test/src/modules/notifications/executors/pusher/send-message.ts:13-14`). Прямой вызов `MathExecutor.sum()` выполняется локально — подменено только тело метода изолятора, не потомка.

Evidence: `packages/transfer/src/defines/decorators.ts:245-300`.

### RxTransfer.request — RPC

На каждый вызов генерируется `uniqKey = randomUUID()`, считается `hash = sha256(JSON.stringify(args))` и собирается ключ процесса.

`packages/transfer/src/defines/rx-transfer.ts:42-61`

```ts
    const uniqKey = crypto.randomUUID();

    // получим hash от аргументов
    const hash = crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");

    // создадим ключ процесса в зависимости от того, это синглтон или нет
    // основанием являются аргументы, для которых вызывается функция
    const topicProcessKey = `${topic}_${hash}_${$.singletone ? "singletone" : uniqKey}`;

    // установим заголовок, сохраним оригинальный топик
    const headers: TransferMessageHeaders = {
      replyTopic,
      uniqKey,
    };
    // проверим, есть ли существующий процесс для текущего топика (актуально для синглотонов)
    const existsProcess = $.topicProcessMap.get(topicProcessKey);
    // если есть, то вернем его, не запуская процедуру повторно
    if (existsProcess) {
      return existsProcess;
    }
```

Для синглтона ключ не содержит `uniqKey`, поэтому параллельные вызовы с теми же аргументами до завершения первого возвращают уже существующий процесс — публикация происходит один раз (тест `rpc.test.ts:102-114`). Адрес публикации берётся как `$._.root.instanceTopic(topic)` — с суффиксом инстанса, если он был задан через `toInstance`.

Поток строится лениво: `defer(initReplySubscription)` → `mergeMap` в `Observable`, который кладёт колбэк в `transfer.callbackMap` по `uniqKey`, публикует сообщение и на отписке колбэк удаляет (`rx-transfer.ts:64-85`). Reply-подписка на `replyTopic` создаётся один раз на мета-инстанс метода и помечается в `$.replySubscribers` (`rx-transfer.ts:28-35`).

Дальше две ветки. При `waitForResponse` результат — `firstValueFrom(rx$)` с очисткой `topicProcessMap` в `then`/`catch` (`rx-transfer.ts:88-99`). Иначе — `rx$.subscribe()`, то есть rxjs `Subscription` (наружу она уходит завёрнутой в `Promise` async-обёртки, `decorators.ts:232`), и в её teardown, помимо очистки, вызывается исходное тело метода — без аргументов (`rx-transfer.ts:100-108`, `KI-TRANSFER-02`).

`replyHandler` ищет колбэк по `headers.uniqKey` и передаёт ему `{error, topic}` либо `{topic, value, isCompleted: true}` (`rx-transfer.ts:120-142`); колбэк `callbackObserver` превращает это в `observer.error` либо `next` + `complete` (`rx-transfer.ts:228-241`). Таймаута нет ни в одной ветке.

Evidence: `packages/transfer/src/defines/rx-transfer.ts:28-113,120-142`; `packages/transfer/test/rpc.test.ts:77-114`.

### execHandler: конверт ошибок и falsy-результаты

Исполнитель выполняет реализацию, разворачивая `value` сообщения как список аргументов, и публикует результат в `replyTopic`. `undefined` подменяется на `{}` — прочие falsy-значения (`0`, `false`, `""`, `null`) уходят как есть.

`packages/transfer/src/defines/rx-transfer.ts:158-169`

```ts
      Promise.all([Reflect.apply(handler, undefined, value)])
        .then(([result]) => {
          // если указан топик для ответа, отправляем результат
          // falsy-результаты (0, false, "") легальны — подменяется только undefined
          replyTopic &&
            this.transfer.publisher({
              topic: replyTopic,
              message: {
                value: result === undefined ? {} : result,
                headers: { uniqKey, replyTopic },
              },
            });
        })
```

Исключение не переживает JSON, поэтому в ветке `catch` публикуется конверт `{name, message, status, data}` (для не-объектов — `{message: String(error)}`) с `headers.error = true` (`rx-transfer.ts:171-188`). На вызывающей стороне `serializeError` восстанавливает `new Error(message)`, переносит `name` и присваивает `status`/`data` (`rx-transfer.ts:205-214`) — благодаря этому статус ответа-ошибки доезжает до вызывающего кода (тест `rpc.test.ts:94-100`).

Ответ публикуется только при наличии `replyTopic` в заголовках, но заголовок ставится всегда, включая `CustomTopic`: ответ нужен, чтобы поток вызывающего завершился и подписка убралась.

Evidence: `packages/transfer/src/defines/rx-transfer.ts:151-190,198-241`; `packages/transfer/test/rpc.test.ts:86-100`.

### @TopicSchema

Методный декоратор фазы FIRST, описывающий сигнатуру для дескриптора. `args` — массив пар `{ имя: тип }`, ровно одна пара на элемент, имена уникальны; тип — имя скаляра из `SCALAR_TYPE_SCHEMAS` (`string`, `number`, `integer`, `boolean`, `date`, см. `packages/schemer/src/defines/collector.ts:12-18`), класс-компонент-схема (проверяется `AomSchemas.checkExists(type)?.isComponentSchema`) или `[T]` из одного элемента. Все проверки выполняются в момент декорирования и бросают `Error` с префиксом `@TopicSchema Class.method:` (`decorators.ts:39-99`).

Три различимых состояния метода: описан (`$.argsSchemas` — массив), явно «аргументов нет» (`@TopicSchema({})` → `[]`) и «не описан» (декоратора нет → `undefined`). Это различие переносится в дескриптор: у неописанного метода поля `args` не будет вовсе (`descriptor.test.ts:149-156`).

Декоратор методный, а не пер-параметрный, сознательно — ради совместимости со stage-3 декораторами (`decorators.ts:71`).

Evidence: `packages/transfer/src/defines/decorators.ts:39-99`; `packages/transfer/test/descriptor.test.ts:96-156`.

### @IsDistributed: дескриптор сервиса

В фазе LAST по `$.isolatedMethods` строится список `TransferMethodDescriptor` (`name`, `topic`, `waitForResponse`, `singleton`, `queue`), схемы рендерит `SchemasCollector(new Schemer(Transfer.refPointerPrefix))`: компонент-схемы становятся `$ref`, каскад связей складывается в `components`. Метод без `@TopicSchema` даёт `console.warn` и остаётся без поля `args`. Итоговый дескриптор с `hash = sha256(JSON.stringify({methods, components}))` и `origin` транспорта кладётся в `transfer.registryMap` по имени класса.

`packages/transfer/src/defines/decorators.ts:141-153`

```ts
    const { instanceName, instanceKey } = transfer;
    const descriptor: TransferServiceDescriptor = {
      name: $._.target.name,
      origin: { instanceName, instanceKey },
      hash: crypto
        .createHash("sha256")
        .update(JSON.stringify({ methods, components }))
        .digest("hex"),
      methods,
      components,
    };

    transfer.registryMap.set(descriptor.name, descriptor);
```

Поля `args`/`returns` записываются только при наличии — дескриптор обязан переживать JSON без потерь (`descriptor.test.ts:184-187`).

Evidence: `packages/transfer/src/defines/decorators.ts:105-155`; `packages/schemer/src/defines/collector.ts:12-18`; `packages/transfer/test/descriptor.test.ts:63-94,177-187`.

### Протокол реестра и кэш LWW

`collectDistributions(cb)` фиксирует колбэк-сборщик и публикует свою идентичность в `!Transfer_Registry_Request!` (`main.ts:189-200`). На каждом чужом узле `requestRegistry` сравнивает отправителя с собой и, если это не он, публикует в `!Transfer_Registry_Notification!` значение `{receiver, sender, schemas: [...registryMap.values()]}` — массив, а не итератор (`main.ts:205-213`).

`acceptRegistry` срабатывает, только если у узла установлен `structureCollector` и `receiver` совпадает с ним. Принятые дескрипторы кэшируются: собственные записи не затираются, чужие заменяются при расхождении `hash`.

`packages/transfer/src/defines/main.ts:232-244`

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

Так узел, однажды опросивший реестр, становится переизлучателем: контракт остаётся доступен, пока жив хотя бы один видевший его узел (тест `cache.test.ts:34-57` гасит источник через `bus.mute("A")`). Узел, который сам никогда не звал `collectDistributions`, ничего не кэширует.

Evidence: `packages/transfer/src/defines/main.ts:189-251`; `packages/transfer/test/cache.test.ts:33-57`; `packages/transfer/test/distribution.test.ts:64-81`.

### Transfer.restore

`restore(descriptor, instanceId?)` строит вызывающий прокси без исходного класса. Кэш — `restoredMap` по ключу `name:hash:instanceId`, поэтому повторный вызов не плодит reply-подписки (`main.ts:156-158`, тест `restore.test.ts:80-83`). Для каждого метода дескриптора создаётся минимальный двойник мета-инстанса: `topic` из дескриптора, `replyTopic` — от идентичности **потребителя**, пустые `replySubscribers`/`topicProcessMap` и `_.root.instanceTopic` с фиксированным `instanceId`; `client[method.name] = (...args) => rx.request(args, $)` (`main.ts:164-181`). Типизация рантаймовая: без параметра `T` возвращается `Record<string, (...args) => any>`.

Evidence: `packages/transfer/src/defines/main.ts:142-185`; `packages/transfer/test/restore.test.ts:59-83`.

### Адресация инстанса

`Transfer.instanceTopic(topic, id)` — это `[topic, id].filter(Boolean).join("_")` (`main.ts:138-140`). `@Executor("w1")` подписывается на `Worker.whoami_w1` (`decorators.ts:287`; тест `distribution.test.ts:37-42`). На вызывающей стороне `Transfer.toInstance(Worker, "w1")` записывает `instanceId` в классовый мета-инстанс и возвращает конструктор; при следующем `request` метод `AomIsolator.instanceTopic` подставляет и тут же обнуляет его.

`packages/transfer/src/defines/main.ts:56-60`

```ts
  instanceTopic(topic: string) {
    const result = Transfer.instanceTopic(topic, this.instanceId);
    this.instanceId = undefined;
    return result;
  }
```

Адресация одноразовая и живёт на классе, а не на вызове — отсюда `KI-TRANSFER-03`.

Evidence: `packages/transfer/src/defines/main.ts:56-60,127-140`; `packages/transfer/src/defines/decorators.ts:287`; `packages/transfer/test/distribution.test.ts:21-43`.

### MemoryBus как образец тестовой шины

`packages/transfer/test/memory-bus.ts` — не часть публичного API, а образец, на который опираются все тесты пакета и который стоит копировать в тесты приложения. Ключевые свойства: доставка отложена в макротаск (`setTimeout`), сообщение прогоняется через `JSON.parse(JSON.stringify(message))` — несериализуемые значения теряются намеренно, как у реального брокера; лог `published` и счётчик `topicCount(topic)` позволяют проверять число публикаций; именованные порты `port(id)` и `mute(id)` моделируют падение узла; `tick(ms)` — пауза для доставки.

`packages/transfer/test/memory-bus.ts:31-40`

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

Evidence: `packages/transfer/test/memory-bus.ts:1-47`.

### Использование в приложении

Приложение создаёт единственный `Transfer` поверх NATS: `publisher` публикует `JSON.stringify(message)` через `nats.publish`, `subscriber` оформляет `nats.subscribe` с колбэком, читающим `message.json()`. Аргумент `queue`, который передаёт `attachIsolation`, адаптером не принимается — queue-группы NATS не задаются (`KI-BOOT-02`), а `instanceName` берётся из переменной, отсутствующей в окружении (`KI-BOOT-01`). Какие изоляторы объявлены в модулях — §«Как использует приложение» и `test/docs/principles.md` §«Изоляторы и исполнители».

Evidence: `test/src/config/aom/transfer.ts:1-25`; `test/src/config/connections/nats/index.ts:1-11`.

## Инварианты и подводные камни

- Изолируются только **статические** методы: карты топиков ключуются значением функции на конструкторе (`decorators.ts:185,189-198`).
- Тело метода изолятора — заглушка (`return undefined as never` / `<any>void 0`); реализация живёт в наследнике с `@Executor`.
- Топик выводится из имени класса (`` `${Class}.${method}` ``): переименование класса меняет канал и рвёт связь с уже развёрнутыми исполнителями.
- `@Isolator` — самый верхний классовый декоратор; `@IsDistributed` ставится под ним, иначе он попадает в уже разобранную LAST-очередь и молча не выполняется — ни ошибки, ни предупреждения (`decorators.ts:22-28,154`; `packages/core/src/defines/core.ts:80,99-113`; `KI-TRANSFER-07`, образец порядка — `packages/transfer/test/cache.test.ts:23-24`).
- Всё, что уходит в `publisher`, обязано быть JSON-сериализуемым: сообщение проходит через сериализацию и на проводе, и в тестовой шине.
- Пара `instanceName`+`instanceKey` должна быть уникальна на шине — иначе reply-топики двух узлов совпадут.
- `subscriber` вызывается синхронно в конструкторе `Transfer` и при декорировании `@Executor`: шина должна быть готова к подписке к моменту импорта модулей с изоляторами.
- `Executor` при отсутствии реализации метода печатает `console.warn` и продолжает — метод просто остаётся без подписчика (`decorators.ts:258`).
- Ключ `registryMap` — имя класса: два одноимённых распределённых класса на одном транспорте перетирают друг друга.
- Правки `src` пакета не видны приложению без `bun run build` — приложение исполняет `dist` (см. §«Сборка и потребление»).

### Известные дефекты

Полный реестр с последствиями для приложения — `test/docs/known-issues.md`.

> ⚠️ Дефект (`KI-TRANSFER-01`): `@ResponseTopic` без поднятого исполнителя даёт вечно висящий `Promise` — таймаута в `RxTransfer.request` нет.
> Evidence: `packages/transfer/src/defines/rx-transfer.ts:88-99` (ветка `waitForResponse` — только `firstValueFrom`, без `timeout`), `rx-transfer.ts:120-142` (ответ приходит исключительно из `replyHandler`).
> Последствия: обработчик HTTP-запроса приложения зависает; в `test/docs/known-issues.md` это `KI-AUTH-03` для `PusherIsolator.RegisterMessage` при незапущенном модуле `notifications`.
> Как обходить: оборачивать вызов собственным таймаутом на стороне приложения либо использовать `@CustomTopic` там, где ответ не нужен.

> ⚠️ Дефект (`KI-TRANSFER-02`): `@CustomTopic` возвращает `Promise<Subscription>`: `await` отдаёт `Subscription` сразу и исполнителя не ждёт; после прихода ответа исходное тело метода изолятора вызывается **без аргументов**.
> Evidence: `packages/transfer/src/defines/decorators.ts:232` (тело подменяется на `async`-стрелку), `packages/transfer/src/defines/rx-transfer.ts:100-108` (`result = rx$.subscribe()`, затем `Reflect.apply($.originDescriptorValue, constructor, [])`).
> Последствия: `await TicketsIsolator.CommentProcessing(id)` в приложении возвращает управление сразу; тело-заглушка исполняется с `undefined` вместо аргументов — при непустом теле это скрытый вызов с потерянными параметрами.
> Как обходить: тела методов `@CustomTopic` держать пустыми; если нужен факт завершения — `@ResponseTopic`.

> ⚠️ Дефект (`KI-TRANSFER-03`): ключ дедупликации синглтона не включает `instanceId`, а сам `instanceId` хранится на классовом мета-инстансе и одноразов.
> Evidence: `packages/transfer/src/defines/rx-transfer.ts:45-61` (`topicProcessKey` = топик + hash аргументов + `"singletone"`), `packages/transfer/src/defines/main.ts:56-60,127-130`.
> Последствия: параллельные вызовы одного метода с одинаковыми аргументами, адресованные разным исполнителям через `toInstance`, сливаются в один; при раннем возврате существующего процесса (`rx-transfer.ts:59-61`) `instanceTopic` не вызывается и записанный `instanceId` «утекает» в следующий вызов любого метода этого класса.
> Как обходить: не использовать `toInstance` вместе с `singletone`; в приложении `toInstance` не применяется.

> ⚠️ Дефект (`KI-TRANSFER-05`): импорт `rx-transfer.ts` глобально переопределяет обработчик необработанных ошибок rxjs на весь процесс.
> Evidence: `packages/transfer/src/defines/rx-transfer.ts:14` — `rxjs.config.onUnhandledError = ...` на верхнем уровне модуля.
> Последствия: любой другой код процесса, полагающийся на собственный `rxjs.config.onUnhandledError`, теряет его при импорте пакета.
> Как обходить: устанавливать свой обработчик после импорта `@aom-js/transfer`.

> ⚠️ Дефект (`KI-TRANSFER-06`): реестр дескрипторов ключуется именем класса, кэш чужих записей — last-write-wins по `hash` без версий, а узел без `collectDistributions` не переизлучает реестр.
> Evidence: `packages/transfer/src/defines/main.ts:234-242` (сравнение только по `hash`), `main.ts:223-227` (условие `this.structureCollector && receiver === self`), `packages/transfer/src/defines/decorators.ts:153`.
> Последствия: одноимённые сервисы разных команд перетирают друг друга; при расходящихся версиях побеждает последний ответивший узел; пассивные узлы не помогают доступности контрактов.
> Как обходить: держать имена распределённых классов уникальными в пределах шины; на приложение сейчас не влияет — дистрибуция не используется.

Два дефекта приложения относятся к настройке транспорта и описаны в реестре приложения: `KI-BOOT-01` (переменная `INSTANCE_NAME` отсутствует в окружении, `INSTANCE_NAME!` скрывает `undefined`, reply-топики получают вид `reply_<topic>_<key>_undefined`; `test/src/config/aom/transfer.ts:5,12`) и `KI-BOOT-02` (NATS-адаптер не передаёт `queue`, поэтому `@IsQueue` не даёт queue-группы; `test/src/config/aom/transfer.ts:18-24`).

### Легаси и мёртвый код

> 🧱 Легаси (`KI-TRANSFER-04`): `packages/transfer/src/defines/registry.ts:1-18` — черновик встроенного реестра, который экспортируется наружу через барель `defines/index.ts:4`, но нерабочий.
> Где и почему: `TransferRegistryIsolator` помечен `@ResponseTopic()` без `@Isolator`, поэтому отложенный `DefineTopics` (LAST) никогда не разбирается — `topic`/`replyTopic` не заполняются, а подменённое тело обращается к `$._.root.rx`, которого нет; `TransferRegistryExecutor` не помечен `@Executor`, подписок не создаёт; `TransferRegistry.Init` — пустой метод. Импорт `Isolator` в файле не используется.
> Чем заменён: протоколом реестра в самом `Transfer` — `collectDistributions`/`requestRegistry`/`acceptRegistry` (`packages/transfer/src/defines/main.ts:189-251`).
> В ту же категорию: поле `AomIsolator.registry: boolean` (`main.ts:38`) не пишется и не читается нигде в пакете; `RxTransfer` (`packages/transfer/src/defines/rx-transfer.ts:16`) наоборот — рабочий и центральный, но из бареля не экспортируется, снаружи доступен только как значение `AomIsolator.rx`.

## Как использует приложение

Приложение использует пять экспортов: `Transfer`, `Isolator`, `Executor`, `ResponseTopic`, `CustomTopic`. Паттерн (раскладка `isolators/` + `executors/`, подключение через `import "./executors"` в `modules/<module>/index.ts`, таблица всех изоляторов) описан в `test/docs/principles.md` §«Изоляторы и исполнители»; ниже — три характерных места.

**Тяжёлая обработка файлов.** `FilesIsolator` объявляет шесть методов-заглушек с `@ResponseTopic(true)` — синглтон по аргументам: параллельные запросы одного и того же превью не породят двух конвертаций (`test/src/modules/files/isolators/files.ts:9-49`). Реализация — `FilesExecutor extends FilesIsolator` с `sharp` и хранилищем (`test/src/modules/files/executors/index.ts:12-13`). Вызов идёт из доменного класса: `await FilesIsolator.MakePreview(file.id)` (`test/src/modules/files/classes/Files/Relations.ts:32`).

**Постобработка из хука сущности.** `TicketsIsolator.CommentProcessing` помечен `@CustomTopic(true)` (`test/src/modules/tickets/isolators/tickets.ts:7-10`) и вызывается из хука MikroORM `@AfterCreate` комментария — обработка счётчиков и уведомлений выносится из транзакции запроса (`test/src/modules/tickets/entities/postgres/Tickets/Comments.ts:57-59`).

**Синхронный по смыслу вызов через шину.** `PusherIsolator.RegisterMessage` объявлен `@ResponseTopic()` и в маршруте авторизации результат ожидается: `const result = await PusherIsolator.RegisterMessage(login!.id, message)` (`test/src/modules/notifications/isolators/pusher.ts:17-23`; `test/src/modules/auth/api/routes/index.ts:86`). Это и есть сценарий `KI-TRANSFER-01`: без запущенного модуля `notifications` запрос зависает.

Вторая половина API — `@TopicSchema`, `@IsDistributed`, `@IsQueue`, `collectDistributions`, `restore`, `toInstance` — в приложении не встречается; дистрибуция задействована только тестами пакета и `@aom-js/codegen`.

## Сборка и потребление

Сборка стандартная для пакетов ядра: `bun run build:transfer` в корне ядра (эквивалент `bun --filter @aom-js/transfer build`) прогоняет `tsc` трижды — `tsconfig.build.json` → `dist/cjs`, `tsconfig.build.mjs.json` → `dist/mjs`, `tsconfig.build.types.json` → `dist/types` — и затем `node ../../scripts/post-build.js`, который дописывает расширения относительным импортам и кладёт `dist/cjs/package.json` с `{type: "commonjs"}` (`packages/transfer/package.json:51-56`). Манифест генерируется скриптами (`package.src.json`, `package.version.json` — версия `0.0.7`), править его напрямую не следует. Приложение подключает пакет симлинком `test/node_modules/@aom-js/transfer` и через `exports` попадает в `dist/mjs`; **правки `src` не видны приложению без `bun run build`**. Тесты монорепо, напротив, резолвят алиас `@aom-js/transfer` на `packages/transfer/src`. Полная схема сборки и dist-потребления — `main/docs/architecture.md` §«Сборка, тесты…» и §«Как приложение потребляет ядро».

Незакоммиченных правок в коде пакета нет, состояние на диске = HEAD (`git status --short packages/transfer/src` и `git diff -- packages/transfer/src` пусты; в рабочем дереве изменён только сам этот `readme.md`). `dist` (25 августа) новее исходников (последняя правка `src` — 12 августа), то есть собранный артефакт актуален.

## Тесты

### Что покрыто

| Файл | Что проверяет |
|---|---|
| `packages/transfer/test/rpc.test.ts` (7) | Роундтрип `@ResponseTopic` и reply-топик `reply_MathService.sum_k1_test-node`; falsy-результат `0` доставляется как есть; ошибка исполнителя приходит как `reject`; конверт ошибки переносит `status`/`data` через сериализующую шину; синглтон дедуплицирует параллельные вызовы с одинаковыми аргументами (одна публикация) и не дедуплицирует с разными; `@CustomTopic` доходит до исполнителя |
| `packages/transfer/test/descriptor.test.ts` (8) | Состав дескриптора `@IsDistributed`; именованные `args`, скаляры и `[T]`; пять ошибок валидации `@TopicSchema`; различимость `args: []` и отсутствия поля; `console.warn` для метода без `@TopicSchema`; каскад `components` (`GoodDto` → `PriceDto`); JSON-идемпотентность дескриптора; запрос-ответ реестра по шине |
| `packages/transfer/test/distribution.test.ts` (4) | `toInstance` направляет вызов в топик `Worker.whoami_w1`, безадресный топик не используется; `IsDistributed` регистрирует дескриптор в `registryMap`; `collectDistributions` получает схемы чужого узла; узел не отвечает сам себе |
| `packages/transfer/test/restore.test.ts` (3) | Восстановленный прокси вызывает удалённый метод и получает результат; ошибка со `status` доходит через прокси; повторный `restore` возвращает тот же клиент |
| `packages/transfer/test/cache.test.ts` (1) | Узел B кэширует дескриптор A и раздаёт его C после `bus.mute("A")` |

Все тесты работают на `MemoryBus`, каждая группа создаёт свои `Transfer` с уникальными `instanceName`/`instanceKey` на общей шине.

### Expected-fail

Их нет: в пакете ни одного `it.fails`, все 23 теста проходят. Ранее известный дефект falsy-результатов (`result || {}`) исправлен коммитом `1ebd512` и закрыт обычным проходящим тестом `rpc.test.ts:86-88`. Политика характеризационных тестов — `test/docs/testing.md`.

### Пробелы

- `@IsQueue` и `Executor(instanceId)` в связке: значение `queue` в аргументах `subscriber` не проверяется.
- Нет теста на `console.warn` у `Executor` при методе без реализации.
- Нет теста на LWW-замену при расхождении `hash` и на «собственный дескриптор не затирается».
- Нет теста на поведение без исполнителя (вечное ожидание, `KI-TRANSFER-01`) и на конкурентный `toInstance`.
- Нет теста, что `@CustomTopic` вызывает исходное тело после ответа (`KI-TRANSFER-02`), и на `singletone` для `@CustomTopic`.
- Нет теста `restore` с `instanceId` и с изменившимся `hash`.
- `registry.ts` не покрыт (и нерабочий); не покрыт конверт для ошибки-не-объекта (`throw "str"`).

### Как запускать

```bash
bun run test -- packages/transfer
```

## Расхождения с историческими заметками

| Заметка | Утверждение | Фактически | Evidence |
|---|---|---|---|
| `main/docs/isolators.md:203` | «`@Isolator` — верхний (он INSTANT и разбирает LAST-очередь…)» | Фаза не INSTANT, а FIRST (значение по умолчанию `classDecorator`): выполняется сразу, но сохраняется в `fired` и участвует в наследовании. Требование «верхний» верно | `packages/transfer/src/defines/decorators.ts:22`; `packages/core/src/defines/core.ts:521-534` |
| `main/docs/isolators.md:120` | «Сама изолированная функция не вызывается» | Верно для `@ResponseTopic`; для `@CustomTopic` исходное тело вызывается при завершении подписки, без аргументов | `packages/transfer/src/defines/rx-transfer.ts:104-107` |
| `main/docs/isolators.md:80-103` (пример NATS) | Адаптер строится на `StringCodec` и `JSON.parse(sc.decode(message.data))` | Конфигурация приложения на `@nats-io/transport-node` публикует строку напрямую и читает `message.json()`; `StringCodec` не используется | `test/src/config/aom/transfer.ts:14-24` |
| `main/docs/isolators.md:259-292` | Дескрипторы применяются через CLI `aom-codegen`, дистрибуция подразумевается используемой | В приложении нет ни одного `@IsDistributed`/`@TopicSchema`/`restore`/`collectDistributions`; дистрибуция задействована только тестами пакета и `@aom-js/codegen` | `packages/codegen/src/defines/collect.ts:1-29`; отсутствие вхождений в `test/src` |
| `main/docs/isolators.md:488` (дизайн-лог) | Черновой `requestRegistry` публикует `this.registryMap.entries()` | В реализации уходит массив `[...registryMap.values()]` — сериализуемый; раздел ниже строки 302 помечен автором как история решений | `packages/transfer/src/defines/main.ts:209` |
| `main/docs/superpowers/plans/2026-07-20-test-coverage.md:1477` | «Известный дефект: `execHandler` шлёт `result \|\| {}`», ожидается `it.fails` | Исправлено: `result === undefined ? {} : result`; тест обычный, проходящий | `packages/transfer/src/defines/rx-transfer.ts:166`; `packages/transfer/test/rpc.test.ts:86-88` |
| `main/docs/superpowers/plans/2026-07-20-test-coverage.md:1581` | «Значение схемы в реестре — просто имя класса, а `registryMap.entries()` передаётся итератором (несериализуемо)» | Реестр хранит полные `TransferServiceDescriptor`, по шине уходит массив значений | `packages/transfer/src/defines/main.ts:209`; `packages/transfer/src/defines/decorators.ts:142-153` |
| `main/docs/superpowers/plans/2026-07-20-test-coverage-findings.md` | Таблица дефектов с `it.fails` | По `transfer` записей нет; в тестах пакета ни одного `it.fails` | `bun run test -- packages/transfer` → 5 файлов, 23 passed |
| `main/packages/transfer/readme.md` (прежняя версия) | «Abstract data transfer module.» | Единственная строка описания; фактическая документация жила в `main/docs/isolators.md` и JSDoc. Файл перезаписан настоящим документом | прежнее содержимое файла, 3 строки |
| `main/docs/codegen.md` | Раздел о кодогенерации | Файл — 5 строк вступления без содержания; контракт кодогенерации описан в `main/docs/isolators.md` п. 6 и в `packages/codegen/readme.md` | `main/docs/codegen.md:1-5` |

## Открытые вопросы

> ❓ Открытый вопрос: намеренно ли NATS-адаптер приложения игнорирует `queue` (`test/src/config/aom/transfer.ts:18-24`) — то есть `@IsQueue` в проекте неприменим до появления queue-группы?

> ❓ Открытый вопрос: задаётся ли `INSTANCE_NAME` через окружение процесса dev-сервера, или reply-топики действительно содержат `undefined` (`KI-BOOT-01`)?

> ❓ Открытый вопрос: должен ли `RxTransfer` экспортироваться публично, и что делать с `registry.ts` — удалить или довести до рабочего состояния (`KI-TRANSFER-04`)?

> ❓ Открытый вопрос: планируется ли таймаут или отмена в `RxTransfer.request` — сейчас `Promise` без исполнителя не резолвится никогда (`KI-TRANSFER-01`)?

> ❓ Открытый вопрос: нужен ли `instanceId` в ключе дедупликации синглтона — сейчас вызовы к разным инстансам с одинаковыми аргументами сливаются (`KI-TRANSFER-03`)?

> ❓ Открытый вопрос: останутся ли изоляторы статическими — в `main/docs/isolators.md:638-666` обсуждается перевод на инстансы, что затронуло бы всё API пакета?
