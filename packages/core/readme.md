# `@aom-js/core`

Механика декораторной фабрики aom: реестр мета-инстансов, узел, фазы исполнения, наследование метаданных, `resolveFor`. Документ — единый источник истины по этой механике; router, schemer, transfer, holder и api ссылаются сюда вместо собственных объяснений. Состояние на 2026-09-02.
Читать до: `docs/architecture.md` (состав ядра, граф пакетов, сборка). Читать после: `packages/router/readme.md`, `packages/schemer/readme.md`. Термины — `test/docs/README.md#словарь`.

## Назначение и место в стеке

Пакет даёт любому мета-классу — наследнику `AomCore` — две вещи: собственный реестр «мета-инстансов», ключуемых парой «класс + свойство», и пять фабрик legacy-декораторов, которые не выполняют обработчик немедленно, а кладут ленивый вызов `[handler, [$, ...args], inherit]` в очередь одной из четырёх фаз (`ExecutionPhase`). Всё прикладное состояние хранят поля наследника; сам `AomCore` держит единственное поле экземпляра — узел `_` (`packages/core/src/defines/core.ts:367-377`).

Runtime-зависимостей у пакета нет (`packages/core/package.json`, `dependencies: {}`); `reflect-metadata` он не использует и о HTTP ничего не знает. Потребители — все остальные пакеты ядра: router (`AomApi`, `packages/router/src/common/classes.ts:155-173`), schemer (`AomSchemas`, `packages/schemer/src/defines/module.ts:13-23`), transfer (`AomIsolator`, `packages/transfer/src/defines/main.ts:19-27`), holder (`AomHolder`, `packages/holder/src/init.ts:3-5`), api (`AomAccessCore`, `packages/api/src/controllers/access/types.ts:6-12`). Приложение объявляет один собственный мета-класс — `TicketsTypeRelay` (см. §«Как использует приложение»). Полный граф пакетов и порядок сборки — `docs/architecture.md`.

## Публичный API

Точка входа — `packages/core/src/index.ts` → `export * from "./defines"`; каталог `packages/core/src/constants` не реэкспортируется.

### Классы и статические методы

| Экспорт | Сигнатура | Назначение | Используется приложением |
|---|---|---|---|
| `AomCore` | `class AomCore { _: AomNode<this>; constructor(base, target, property?, origin?) }` | Базовый мета-класс; наследуется и получает собственный реестр и фабрики | да (`test/src/modules/tickets/api/routes/tickets/init/aom.ts`) |
| `AomCore.instance` | `static instance<T, E>(this: AomClass<T>, target: E, property?: Property): T` | Найти или создать мета-инстанс по `target` (+`property`) | да (`test/src/modules/tickets/api/routes/tickets/init/controllers/value.ts:69`) |
| `AomCore.checkExists` | `static checkExists<T, E>(this: AomClass<T>, target: E, property?: Property): T \| undefined` | Вернуть существующий инстанс без создания (кроме ключей полей, см. `KI-CORE-08`) | нет |
| `AomCore.resolveFor` | `static resolveFor<T>(this: AomClass<T>, $: T, context: ClassConstructor): T` | Перепривязать инстанс статики родителя к каррированной копии потомка. ✏️ Не закоммичено | нет |
| `AomCore.classDecorator` | `static classDecorator<T>(handler: ($: T) => void, storeFlag?: ExecutionPhase, inherit?: InheritPlacement): ClassDecorator` | Фабрика декоратора класса | нет |
| `AomCore.methodDecorator` | `static methodDecorator<T>(handler: ($: T, descriptor: PropertyDescriptor) => PropertyDescriptor \| void, storeFlag?, inherit?): MethodDecorator` | Фабрика декоратора метода (статического или прототипного) | да (`.../init/controllers/value.ts:52`) |
| `AomCore.propertyDecorator` | `static propertyDecorator<T>(handler: ($: T) => void, storeFlag?, inherit?): PropertyDecorator` | Фабрика декоратора поля | нет |
| `AomCore.parameterDecorator` | `static parameterDecorator<T>(handler: ($: T, parameterIndex: number) => void, storeFlag?, inherit?): ParameterDecorator` | Фабрика декоратора параметра; индекс параметра — позиция в очереди | нет |
| `AomCore.combinedDecorator` | `static combinedDecorator<T>(handler: ($: T, descriptor?: PropertyDescriptor) => void, storeFlag?, inherit?): CombinedDecorator` | Декоратор для класса ИЛИ метода; `descriptor` есть только у метода | нет |
| `ClassInstanceMap` | `class ClassInstanceMap { set<T>(key: ClassConstructor<T>, value: T): this; get<T>(key): T \| undefined; has(key): boolean; delete(key): boolean }` | Типизированная WeakMap «конструктор → экземпляр»; в самом core не используется, нужна router как `RxContext.state` | нет (через router) |
| `isClass` | `function isClass(value: InstanceTarget): boolean` | Проверка «это class-синтаксис» через `Function.prototype.toString` | нет |

Значения по умолчанию у всех пяти фабрик: `storeFlag = ExecutionPhase.FIRST`, `inherit` не задан (`packages/core/src/defines/core.ts:521-614`).

### Типы и перечисления

| Экспорт | Сигнатура | Назначение | Используется приложением |
|---|---|---|---|
| `ExecutionPhase` | `enum { INSTANT="instant", FIRST="first", LAST="last", DELAY="delay" }` | Фаза выполнения ленивого вызова (`packages/core/src/defines/types.ts:14-20`) | нет |
| `InheritPlacement` | `enum { APPEND="append", PREPEND="prepend", SKIP="skip" }` | Размещение вызова при переносе на потомка (`packages/core/src/defines/types.ts:23-31`) | нет |
| `ClassConstructor` | `type ClassConstructor<T = {}> = new (...args: any[]) => T` | Тип конструктора | да (`.../init/aom.ts:4`) |
| `ClassType` | `type ClassType = ClassConstructor \| Function` | Конструктор или функция | нет |
| `Property` | `type Property = string \| symbol` | Ключ свойства | да (`.../init/aom.ts:5`) |
| `InstanceTarget` | `type InstanceTarget = ClassType \| InstanceType<ClassConstructor>` | Цель декорирования: класс, функция, прототип или объект | нет |
| `CombinedDecorator` | `type CombinedDecorator = <T>(target: ClassType, propertyKey?: Property, descriptor?: TypedPropertyDescriptor<T>) => void` | Сигнатура комбинированного декоратора | нет (импортируется, но не используется: `test/src/modules/tickets/api/routes/tickets/init/aom.ts:3`) |

### Не экспортируется

| Символ | Где | Почему важен |
|---|---|---|
| `AomNode` | `packages/core/src/defines/core.ts:223-365` | Модель узла; доступна только через `$._` — тип наружу не выведен |
| `AomCallstack`, `AomCallstackQueue` | `packages/core/src/defines/core.ts:54-221` | Очереди фаз; доступны через `$._.callstack` |
| `LazyCall`, `OriginDescriptor`, `NodeOriginDescriptor`, `AomClass` | `packages/core/src/defines/core.ts:29-52` | Внутренние типы ленивого вызова и origin-дескриптора |
| `CONSTRUCTOR_TYPE_ERROR`, `CONSTRUCTOR_PROPERTY_TYPE_ERROR` | `packages/core/src/constants/errors.ts:1-2` | Не реэкспортированы из `packages/core/src/index.ts` и нигде в core не бросаются; router держит собственную копию (`packages/router/src/constants/errors.ts:1-4`) |

## Внутренние модули

| Файл | Ответственность | Ключевые символы |
|---|---|---|
| `packages/core/src/index.ts` | Единственная точка входа: `export * from "./defines"` | — |
| `packages/core/src/defines/index.ts` | Реэкспорт `functions`, `types`, `classes`, `core` | — |
| `packages/core/src/defines/core.ts` | Вся механика: типы ленивых вызовов, очередь фазы, стек очередей, узел, реестр и фабрики | `AomCore`; `AomNode`, `AomCallstack`, `AomCallstackQueue`, `LazyCall`, `OriginDescriptor`, `NodeOriginDescriptor`, `AomClass` (не экспортируются) |
| `packages/core/src/defines/types.ts` | Публичные типы и перечисления | `ExecutionPhase`, `InheritPlacement`, `ClassConstructor`, `ClassType`, `Property`, `InstanceTarget`, `CombinedDecorator` |
| `packages/core/src/defines/classes.ts` | Типизированная обёртка над `WeakMap<конструктор, экземпляр>` | `ClassInstanceMap` |
| `packages/core/src/defines/functions.ts` | Проверка class-синтаксиса регуляркой по `toString`; импорты `ClassConstructor`/`ClassType`/`Property` не используются | `isClass` |
| `packages/core/src/constants/errors.ts`, `packages/core/src/constants/index.ts` | Две строковые константы; из пакета не экспортируются | `CONSTRUCTOR_TYPE_ERROR`, `CONSTRUCTOR_PROPERTY_TYPE_ERROR` |
| `packages/core/test/smoke.test.ts`, `packages/core/test/registry.test.ts`, `packages/core/test/phases.test.ts`, `packages/core/test/inherit.test.ts` | Тесты пакета (см. §«Тесты») | — |
| `packages/core/package.json`, `packages/core/tsconfig.build.json`, `packages/core/tsconfig.build.mjs.json`, `packages/core/tsconfig.build.types.json` | Генерируются `scripts/prebuild.js` из `package.version.json` + `package.src.json` + `scripts/jsons/package.dist.json`; в `.gitignore` (`.gitignore:4-6`) | — |

## Ключевые механизмы

### Реестр инстансов и ключи

Реестр каждого мета-класса — `WeakMap`, лежащая на статическом свойстве самого класса под ключом `Symbol.for(\`AOM_MAP_${this.name}\`)`; при первом обращении карта создаётся (`packages/core/src/defines/core.ts:379-395`). Символ глобальный, но читается он с конкретного `this`, поэтому мета-классы с разными именами всегда независимы.

Ключ вычисляет `instanceKey(target, property)` (`packages/core/src/defines/core.ts:397-449`). Конструктор берётся как сам `target`, если это функция, иначе `target.constructor`. Далее:

- `property` не задан либо конструктор не является классом (`isClass`) → ключ = сам `target`;
- `property` задан, дескриптор существует, у него есть `value` и он не `enumerable` (то есть это метод) → ключ = сама функция `descriptor.value`, поэтому `Meta.instance(A, "run")` и `Meta.instance(A.run)` дают один инстанс;
- иначе (поле без дескриптора или `enumerable`-статика) → создаётся синтетический инстанс `new this(this, constructor, property, originDescriptor)`, который кладётся в карту сам на себя (`map.set(instanceKey, instanceKey)`) и в `root._.statics` (если `target === constructor`) либо в `root._.properties` (если `target` — прототип).

| Что декорируется | Вызов | Ключ в реестре | Куда попадает |
|---|---|---|---|
| Класс | `instance(A)` | сам класс `A` | — |
| Статический метод | `instance(A, "run")` = `instance(A.run)` | функция `A.run` | `root._.origins` |
| Прототипный метод | `instance(A.prototype, "run")` | функция `A.prototype.run` | `root._.origins` |
| Поле инстанса | `instance(A.prototype, "field")` | синтетический инстанс | `root._.properties` + `root._.origins` |
| Статическое data-поле | `instance(A, "config")` | синтетический инстанс | `root._.statics` |
| Свойство не-class функции | `instance(fn, "x")` | сама `fn` | — (карты не задействованы) |

Последняя строка — следствие условия `property && isClass(constructor)` (`packages/core/src/defines/core.ts:411`): для обычной функции или стрелки `property` игнорируется и ключом становится сам `target`, поэтому разные свойства одной функции получат один инстанс.

`instance()` (`packages/core/src/defines/core.ts:463-506`) ищет по ключу, при отсутствии создаёт инстанс и сохраняет. Отдельная ветка `packages/core/src/defines/core.ts:497-502` чинит порядок обращений: если инстанс уже был создан по значению функции (без `property`), а теперь запрошен по паре «класс + свойство», его узел `_` пересоздаётся с корректными `target`, `property` и `root`.

`packages/core/test/registry.test.ts:44-54`:

```ts
it("инстанс, созданный по значению функции, дополняется нодой при обращении по свойству", () => {
  class A {
    static handler() {}
  }
  const viaValue = Meta.instance(A.handler); // сначала по функции
  const viaProperty = Meta.instance(A, "handler");
  expect(viaProperty).toBe(viaValue);
  // нода заменена на корректную (см. core.ts: instance(), ветка property && target !== constructor)
  expect(viaValue._.target).toBe(A);
  expect(viaValue._.property).toBe("handler");
});
```

Evidence: `packages/core/src/defines/core.ts:379-395`, `397-449`, `451-461`, `463-506`; `packages/core/test/registry.test.ts:9-80`.

### Узел `AomNode`

Узел (`packages/core/src/defines/core.ts:223-280`) — служебная часть мета-инстанса, доступная как `$._`.

| Поле | Тип | Содержание |
|---|---|---|
| `base` | мета-класс | Класс, чей реестр создал инстанс; через него узел вызывает `instance()` |
| `target` | `ClassConstructor` | Конструктор-владелец — всегда конструктор, и для статики, и для полей инстанса |
| `property` | `Property?` | Ключ свойства; у узла класса не задан |
| `self` | мета-инстанс | Сам инстанс, которому принадлежит узел |
| `root` | мета-инстанс | Для узла свойства — мета-инстанс класса, для узла класса — `self` |
| `originInstance` | `InstanceTarget` | То, что реально декорировалось: класс (статика) или прототип (свойство инстанса) |
| `origins` | `NodeOriginDescriptor[]` | Узлы декорированных свойств; наполняется только у корневого узла |
| `properties` / `statics` | `Map<Property, T>` | Синтетические инстансы полей инстанса и статических data-полей |
| `callstack` | `AomCallstack` | Очереди фаз собственного узла |
| `currentProperty` | `T \| undefined` | Мёртвое поле, см. `KI-CORE-06` |

`origins` наполняется только у корневого узла и только когда дескриптор отсутствует либо не `enumerable` (`packages/core/src/defines/core.ts:273-275`): туда попадают методы (статические и прототипные) и поля инстанса, но не `enumerable`-статические data-поля — те живут исключительно в `statics`. Разделение «статика или прототип» восстанавливается сравнением `origin.target === $origin._.target` (`packages/core/src/defines/core.ts:333`); эту же формулу повторяют holder (`packages/holder/src/decorators.ts:42`) и mapped-types схемера (`packages/schemer/src/defines/mapped-types/partial-type.helper.ts:27`).

`apply()` (`packages/core/src/defines/core.ts:282-301`) разбирает отложенные очереди в фиксированном порядке: сначала все узлы из `properties`, затем из `statics`, затем из `origins`, и только потом собственный `callstack` узла.

Evidence: `packages/core/src/defines/core.ts:223-280`, `282-301`; `packages/core/test/registry.test.ts:56-73`.

### Фазы и очереди

`AomCallstack` создаёт по две очереди `AomCallstackQueue` на каждое значение `ExecutionPhase` — в `stores` и в `indexes` (`packages/core/src/defines/core.ts:189-198`). Поведение очереди задаётся фазой (`packages/core/src/defines/core.ts:71-81`): `async = true` только у `DELAY`, `deferred = true` у `LAST` и `DELAY`.

| Фаза | Когда выполняется | Где сохраняется | Наследуется | Возврат доходит до декоратора |
|---|---|---|---|---|
| `INSTANT` | в момент декорирования | нигде | нет (`KI-CORE-04`) | да |
| `FIRST` | в момент декорирования | `fired` | да, с повторным выполнением на потомке | да |
| `LAST` | при `_.apply()` корневого узла | `queue` → `fired` | да, встаёт в очередь потомка | нет |
| `DELAY` | в `setTimeout` после `_.apply()` | `queue` → `fired` | да, встаёт в очередь потомка | нет |

`add()` (`packages/core/src/defines/core.ts:99-113`) реализует эту таблицу тремя ветками: `deferred` (`LAST`/`DELAY`) кладёт вызов в `queue` и ждёт `exec()`; `FIRST` кладёт вызов в `fired` и тут же выполняет, поэтому он и срабатывает сразу, и остаётся доступным для переноса на потомка; `INSTANT` только выполняет, нигде не сохраняя.

`place()` (`packages/core/src/defines/core.ts:84-92`) размещает вызов: без индекса — `push`, при `index >= 0` — присваиванием `store[index] = value`, при отрицательном — `unshift`. Индекс приходит только из `parameterDecorator`. `exec()` (`packages/core/src/defines/core.ts:115-122`) вычерпывает очередь через `while ((value = this.queue.shift()))` и складывает выполненное в `fired` — повторный `apply()` те же `LAST` не повторяет. `run()` (`packages/core/src/defines/core.ts:124-133`) вызывает обработчик через `Reflect.apply(handler, null, args)`; для `DELAY` — внутри `setTimeout` без аргумента задержки, поэтому результат теряется.

`AomCallstack.apply()` (`packages/core/src/defines/core.ts:208-213`) перебирает фазы в порядке объявления enum — `INSTANT`, `FIRST`, `LAST`, `DELAY` — и для каждой вызывает `exec()` сначала на `stores`, потом на `indexes`. Очереди `INSTANT`/`FIRST` к этому моменту пусты по построению.

`packages/core/test/phases.test.ts:48-62`:

```ts
it("порядок фаз при apply(): FIRST уже выполнен, затем LAST, затем DELAY (асинхронно)", async () => {
  const log: string[] = [];
  const Mark = (label: string, phase: ExecutionPhase) =>
    Meta.classDecorator(($) => log.push(label), phase);
  // legacy-декораторы применяются снизу вверх: delay, last, first
  @Mark("first", ExecutionPhase.FIRST)
  @Mark("last", ExecutionPhase.LAST)
  @Mark("delay", ExecutionPhase.DELAY)
  class D {}
  expect(log).toEqual(["first"]); // только FIRST сработал при декорировании
  Meta.instance(D)._.apply();
  expect(log).toEqual(["first", "last"]); // DELAY еще нет — он через setTimeout
  await new Promise((r) => setTimeout(r, 0));
  expect(log).toEqual(["first", "last", "delay"]);
});
```

Evidence: `packages/core/src/defines/core.ts:54-133`, `180-221`; `packages/core/test/phases.test.ts:36-72`.

### Фабрики декораторов

Все пять фабрик устроены одинаково: захватывают `this` (мета-класс) в `self`, получают мета-инстанс через `self.instance(target, property)` и добавляют ленивый вызов в очередь заданной фазы. Различаются они целью и составом аргументов обработчика (`packages/core/src/defines/core.ts:521-614`):

| Фабрика | Инстанс берётся по | Аргументы обработчика | Индекс в очереди |
|---|---|---|---|
| `classDecorator` | `instance(target)` | `[$]` | нет |
| `combinedDecorator` | `instance(target, property)` | `[$, descriptor]` — `descriptor` определён только для метода | нет |
| `methodDecorator` | `instance(target, property)` | `[$, descriptor]` | нет |
| `propertyDecorator` | `instance(target, property)` | `[$]` | нет |
| `parameterDecorator` | `instance(target, property)` — для параметров конструктора `property === undefined`, значит узел класса | `[$, parameterIndex]` | `parameterIndex` |

Значение, возвращённое декоратору, доходит до TypeScript только в фазах `INSTANT` и `FIRST`: `add()` возвращает результат `run()` лишь в этих ветках, а для `deferred` не возвращает ничего (`packages/core/src/defines/core.ts:103-112`). Поэтому `methodDecorator` в фазе `LAST` не может подменить дескриптор метода.

Evidence: `packages/core/src/defines/core.ts:521-614`, `12-43`, `99-113`; `packages/core/test/phases.test.ts:74-108`.

### Наследование: `inherit`, `transferTo`, каррирование

`AomNode.inherit(parent)` (`packages/core/src/defines/core.ts:303-364`) выполняет два шага.

Шаг первый — перенос собственных вызовов класса-родителя: `$parent._.callstack.transferTo(this.self)`. `transferTo` (`packages/core/src/defines/core.ts:135-177`) для каждой фазы обходит `[...fired, ...queue]` и добавляет вызов в очередь потомка, подменив первый аргумент (`$`) на мета-инстанс потомка. Следствия: `FIRST` в момент `inherit` выполняется повторно — уже в контексте потомка; `LAST`/`DELAY` просто встают в очередь потомка. Размещение задаёт третий элемент ленивого вызова:

| `InheritPlacement` | Отложенные фазы (`LAST`/`DELAY`) | `FIRST` |
|---|---|---|
| не задан / `APPEND` | в конец очереди потомка, после его собственных вызовов | выполняется на потомке после его собственных |
| `PREPEND` | единым блоком в начало очереди потомка, взаимный порядок внутри блока сохраняется | как `APPEND` — порядок уже задан моментом переноса |
| `SKIP` | не переносится | не переносится |

Блок `PREPEND` собирается в отдельный массив и ставится в начало через `prependBatch` (`packages/core/src/defines/core.ts:95-97`) — поштучный `unshift` развернул бы порядок. Этим механизмом пользуется `@Before` роутера, чтобы родительские pre-middleware оказывались перед собственными (`packages/router/src/decorators/middlewares/index.ts:10-25`).

Шаг второй — перенос декорированных свойств родителя по `$parent._.origins` (`packages/core/src/defines/core.ts:331-361`). Перенос выполняется, только если потомок ещё не владеет свойством; проверок две и обе нужны: `Object.hasOwn` закрывает статики и прототипные методы, реестр (`root._.statics` / `root._.properties`) — поля класса, которых физически нет ни на конструкторе, ни на прототипе. При переносе метода `transferDescritorWithDecorators` (`packages/core/src/defines/core.ts:309-327`) определяет у потомка **собственное** свойство с каррированной обёрткой:

`packages/core/src/defines/core.ts:315-322`:

```ts
if (descriptor && descriptor.value) {
  // здесь обязательно каррирование, так как иначе будет замена контекста исходного дескриптора изначального родительского класса
  const curriedDescriptor = (...args: any) => Reflect.apply(descriptor.value, null, args);
  // определим
  Reflect.defineProperty(target, property, {
    ...descriptor,
    value: curriedDescriptor,
  });
}
```

Копия — другая функция, значит и другой ключ в реестре: у потомка появляется собственный мета-инстанс метода, на который переносятся декораторы родителя. Оборотная сторона — `this` внутри оригинала равен `null` (см. `KI-CORE-05`).

Порядок вызовов `inherit` по цепочке задаёт вызывающая сторона. `@Controller()` идёт от ближайшего родителя вверх (`packages/router/src/decorators/controllers/index.ts:10-22`), поэтому при `PREPEND` блок прародителя оказывается перед блоком родителя (`packages/core/test/inherit.test.ts:130-145`).

Evidence: `packages/core/src/defines/core.ts:135-177`, `303-364`; `packages/core/test/inherit.test.ts:16-173`.

### `resolveFor`

> ✏️ Не закоммичено: `resolveFor` — единственная правка в пакете относительно HEAD ядра (+12 строк в `packages/core/src/defines/core.ts`).
> Evidence: `git diff packages/core` → `packages/core/src/defines/core.ts:508-518`.
> Последствия: `dist` уже пересобран с этой правкой (`dist/mjs`, `dist/cjs`, `dist/types` содержат `resolveFor`, mtime `dist` новее `src`), поэтому приложение видит новое API. Полный список незакоммиченных правок ядра — `docs/architecture.md` §«Состояние рабочего дерева».

`resolveFor($, context)` решает задачу поздней привязки. Ссылка вида `@Before(Self.Method)` вычисляется в момент декорирования, когда `@Controller()` потомка ещё не отработал, и потому фиксирует мета-инстанс статики **родителя**. После `inherit()` у потомка появляется собственная каррированная копия метода со своим мета-инстансом, и ссылку нужно доразрешить.

`packages/core/src/defines/core.ts:508-518`:

```ts
// позднее доразрешение ссылки на статику по контекстному классу: если инстанс `$`
// привязан к родителю контекста, вернуть инстанс каррированной копии потомка
static resolveFor<T extends AomCore>(this: AomClass<T>, $: T, context: ClassConstructor): T {
  const { target, property } = $._;
  // Object.hasOwn обязателен: собственная копия появляется у потомка только при inherit();
  // без неё instance() создал бы пустой инстанс без дескриптора вместо корректного
  if (property && context.prototype instanceof target && Object.hasOwn(context, property)) {
    return this.instance(context, property);
  }
  return $;
}
```

Три условия проверяются вместе: `$` описывает свойство, `context` — потомок владельца `$`, и у `context` уже есть собственная копия свойства. Не выполнено любое — возвращается исходный `$`, поэтому вызов безопасен на произвольной ссылке.

Единственный потребитель — router: `AomCursor` перепривязывает `$` при создании курсора (`packages/router/src/common/classes.ts:216-226`), а `@Before`/`@After`/`@UseMarker`/`@Next` доразрешают ссылки на middleware в контексте класса, объявившего декоратор (`packages/router/src/decorators/middlewares/index.ts:18`, `:35`, `:85-88`, `:101-104`). Косвенное покрытие — `packages/router/test/inherited-static-refs.test.ts:46-60`.

> ✏️ Не закоммичено: `packages/router/test/inherited-static-refs.test.ts` — новый файл, в HEAD ядра отсутствует (untracked); на сборку `dist` он не влияет.
> Evidence: `git status --short` → `?? packages/router/test/inherited-static-refs.test.ts`.
> Последствия: тест существует только на диске; полный список незакоммиченных правок ядра — `docs/architecture.md` §«Состояние рабочего дерева».

## Инварианты и подводные камни

- Мета-класс — наследник `AomCore` с собственными полями состояния; фабрики вызываются на самом мета-классе (`Meta.methodDecorator(($) => …)`). Деструктурировать фабрику нельзя: `this` внутри — это мета-класс, из него берутся реестр и конструктор инстанса.
- Ссылки на владельца внутри обработчика — только через узел: `$._.target`, `$._.property`, `$._.root`. Прикладные данные класса складываются в `$._.root`, данные свойства — в сам `$`.
- Декораторы-агрегаторы, вызывающие `$._.inherit()` и `$._.apply()`, объявляются в фазе `INSTANT` — иначе перенос на потомка повторит агрегатор и вызовет рекурсию. Так сделаны `@Controller()` (`packages/router/src/decorators/controllers/index.ts:24`), `@ComponentSchema()` (`packages/schemer/src/defines/decorators.ts:45`), `@Delay` (`packages/holder/src/decorators.ts:23`, `:28-29`); `@Apply` объявлен в той же фазе и делает то же самое опосредованно — через `Reflect.decorate([Delay(...)])` (`packages/holder/src/decorators.ts:36`, `:54`). Плата за это — `KI-CORE-04`.
- `LAST`-вызовы свойств разбираются только через `apply()` корневого узла класса: без агрегатора на классе отложенные декораторы методов не выполнятся никогда.
- Порядок применения legacy-декораторов задаёт TypeScript: методы класса декорируются раньше самого класса (`packages/core/test/phases.test.ts:96-108`), а несколько декораторов на одной цели применяются снизу вверх — это правило TypeScript, тестом пакета не закреплено (комментарий `packages/core/test/phases.test.ts:52`).
- Реестры мета-классов с разными именами независимы (`Symbol.for` читается с конкретного `this`). Слияние возможно только у наследника мета-класса с тем же `name`: символ совпадает, собственного свойства у наследника ещё нет, и он читает карту родителя через цепочку статического наследования (проверено пробой на `dist`).
- Относительные импорты в `src` пишутся без расширений — `tsc` их не подставляет, расширения дописывает `scripts/post-build.js` в `dist`; спецификаторы, уже написанные с `.js`, скрипт пропускает как есть (`scripts/post-build.js:46`), падает он только на неразрешимых путях (`scripts/post-build.js:55-58`).
- `strictPropertyInitialization` выключен намеренно: поля узлов и мета-классов заполняют декораторы, а не конструктор (`tsconfig.base.json:27-28`).

### Известные дефекты

Реестр с последствиями для приложения — `test/docs/known-issues.md`; здесь только механика.

> ⚠️ Дефект (`KI-CORE-01`): отложенный декоратор параметра с индексом больше нуля не выполняется, если слева от него нет соседей.
> Evidence: `packages/core/src/defines/core.ts:84-92` (`store[index] = value` оставляет «дыры»), `115-122` (`while ((value = this.queue.shift()))` останавливается на первой дыре). Проба на `dist`: одиночный `parameterDecorator(handler, LAST)` с `parameterIndex = 2` не выполняется вовсе, а полный набор индексов `0,1,2` выполняется целиком.
> Последствия: молчаливая потеря отложенного декоратора параметра. Все декораторы аргументов роутера построены на `parameterDecorator` в фазе `LAST` (`packages/router/src/decorators/arguments/index.ts:21-23`), поэтому ограничение действует и на них. При наследовании класса с разреженной очередью параметров `inherit()` бросает `TypeError: value is not iterable` (проба на `dist`), поэтому потеря не всегда молчаливая.
> Как обходить: декорировать параметры подряд, начиная с нулевого; в фазе `FIRST` вызов выполняется независимо от индекса, но дыра в `fired` ломает сам перенос: `transferTo` разворачивает разреженный массив спредом (`packages/core/src/defines/core.ts:161-162`) и падает с `TypeError: value is not iterable` — то есть `@Controller()` на потомке роняет сборку.

> ⚠️ Дефект (`KI-CORE-02`): два отложенных декоратора на один и тот же параметр перезаписывают друг друга.
> Evidence: `packages/core/src/defines/core.ts:88` (`store[index] = value`). Проба: два `LAST`-декоратора на параметр `0` дают один вызов — последний; те же два в фазе `FIRST` выполняются оба, но в `fired` остаётся только последний, поэтому на потомка при `inherit` перенесётся один.
> Последствия: тихая потеря декоратора и расхождение поведения родителя и потомка.
> Как обходить: один декоратор на параметр; несколько эффектов — одним обработчиком.

> ⚠️ Дефект (`KI-CORE-03`): фаза `DELAY` выполняется в `setTimeout` без `try/catch`.
> Evidence: `packages/core/src/defines/core.ts:79-80`, `126-132`. Проба: обработчик `DELAY`, бросающий ошибку, приводит к `uncaughtException` процесса.
> Последствия: исключение отложенного декоратора не привязано к месту объявления и валит процесс; возвращаемое значение теряется.
> Как обходить: обрабатывать ошибки внутри самого обработчика `DELAY`.

> ⚠️ Дефект (`KI-CORE-04`): вызовы фазы `INSTANT` нигде не сохраняются и потому не наследуются.
> Evidence: `packages/core/src/defines/core.ts:109-111` (ветка `INSTANT` только выполняет, не пишет ни в `queue`, ни в `fired`); следствие в holder — `packages/holder/test/holder.test.ts:40-57` (`it.fails`, находка #3 в `docs/superpowers/plans/2026-07-20-test-coverage-findings.md`).
> Последствия: класс-декораторы из `@Delay` родителя не доезжают до потомка при `@Apply`; см. `KI-HOLDER-01` и `packages/holder/readme.md`.
> Как обходить: для наследуемого поведения выбирать `FIRST` вместо `INSTANT`; агрегаторам `INSTANT` необходим по другой причине (см. инварианты выше).

> ⚠️ Дефект (`KI-CORE-05`): каррированная копия метода вызывает оригинал с `this = null`.
> Evidence: `packages/core/src/defines/core.ts:315-322`, `348-354`. Проба: после `inherit` `Child.run()` внутри видит `this === null`, и `Child.run !== Parent.run`.
> Последствия: статические методы родителя, обращающиеся к `this` (`this.marker`, `this.name`), после наследования ломаются; сравнение методов по идентичности между родителем и потомком не работает.
> Как обходить: не использовать `this` в статиках, которые предполагается наследовать, — брать класс из `$._.target` в декораторе или из аргументов курсора.

> ⚠️ Дефект (`KI-CORE-07`): повторный `inherit` того же родителя повторяет его `FIRST`-вызовы.
> Evidence: `packages/core/src/defines/core.ts:135-177` (дедупликации по источнику нет). Проба: два `inherit(Parent)` подряд дают два повторных вызова на потомке.
> Последствия: двойное применение накопительных декораторов при ромбовидных схемах наследования и при ручном `inherit` в обход агрегатора.
> Как обходить: полагаться на агрегатор класса и не вызывать `$._.inherit()` вручную.

> ⚠️ Дефект (`KI-CORE-08`): `checkExists` для поля без дескриптора создаёт инстанс.
> Evidence: `packages/core/src/defines/core.ts:451-461` (вызов `instanceKey`), `419-443` (ветка создаёт синтетический инстанс и пишет его в карты). Проба: `Meta.checkExists(A, "config")` для статического data-поля возвращает инстанс, и после этого `root._.statics` содержит `config`.
> Последствия: «проверка существования» имеет побочный эффект и загрязняет карты `statics`/`properties`.
> Как обходить: для полей проверять наличие ключа непосредственно в `$._.root._.statics` / `$._.root._.properties`.

### Легаси и мёртвый код

> 🧱 Легаси (`KI-CORE-06`): индексированные очереди `AomCallstack.indexes` не наполняются никогда.
> Где: `packages/core/src/defines/core.ts:200-206` — единственный код, который писал бы в `indexes`, закомментирован; при этом `apply()` и `transferTo()` (`packages/core/src/defines/core.ts:208-220`) продолжают их обходить вхолостую, а ветка `indexed` в `transferTo` (`packages/core/src/defines/core.ts:148-156`) недостижима.
> Чем заменено: индекс параметра передаётся прямо в `stores[phase]` через третий аргумент `add()` (`packages/core/src/defines/core.ts:200-201`, `packages/core/src/defines/core.ts:608-612`).

> 🧱 Легаси (`KI-CORE-06`): поле `AomNode.currentProperty` объявлено (`packages/core/src/defines/core.ts:232`) и нигде не читается и не пишется.

> 🧱 Легаси (`KI-CORE-06`): `packages/core/src/constants/errors.ts:1-2` не реэкспортируется из `packages/core/src/index.ts` и ни разу не используется внутри пакета; router держит собственную копию тех же констант (`packages/router/src/constants/errors.ts:1-4`).

> 🧱 Легаси (`KI-CORE-06`): в `packages/core/src/defines/functions.ts:1` импортируются `ClassConstructor`, `ClassType` и `Property`, из которых используется только `InstanceTarget`.

## Как использует приложение

Приложение объявляет один собственный мета-класс — `TicketsTypeRelay` (`test/src/modules/tickets/api/routes/tickets/init/aom.ts:19-21`):

```ts
// распределитель методов информации по тикетам
export class TicketsTypeRelay extends AomCore {
  required_type: ITicketTypeMetaData[] = [];
}
```

Реестр используется как таблица «метод эндпоинта → требуемый тип тикета». Декоратор `TicketValue.ResponseByType(type)` построен на `methodDecorator` в фазе `FIRST` (`test/src/modules/tickets/api/routes/tickets/init/controllers/value.ts:47-61`):

```ts
return TicketsTypeRelay.methodDecorator(($) => {
  const { target, property } = $._;
  $._.root.required_type.push({ target, property, ticketType });
  Reflect.decorate(
    [Get(ticketType), Before(TicketValue.CheckRequiredType) as MethodDecorator],
    target,
    property!,
  );
});
```

Здесь видны сразу три приёма из §«Ключевые механизмы»: владелец и имя метода берутся из узла (`$._.target`, `$._.property`), накопитель кладётся в мета-инстанс **класса** (`$._.root`), а не свойства, и обработчик сам навешивает декораторы роутера через `Reflect.decorate` — то есть мета-класс приложения выступает генератором маршрутных декораторов.

В рантайме middleware `CheckRequiredType` берёт мета-инстанс класса-владельца курсора через `TicketsTypeRelay.instance(origin._.target)`, находит запись по `origin._.property` и сверяет её с типом загруженного тикета (`.../value.ts:63-78`). Точка применения — `test/src/modules/tickets/api/routes/tickets/info/index.ts:18`.

Косвенно ядро задействовано в каждом классе приложения: `@Controller()`, `@ComponentSchema()`, `@Isolator()` и все параметр-декораторы маршрутов — это фабрики `AomCore` поверх мета-классов router, schemer и transfer. Правила приложения — `test/docs/principles.md`; доменный контекст `TicketsTypeRelay` — `test/docs/modules/tickets.md`.

## Сборка и потребление

Сборка пакета — `bun run build:core` в корне ядра (эквивалент `bun --filter @aom-js/core build`, `package.json:20`): три прохода `tsc` по сгенерированным конфигам (`tsconfig.build.json` → `dist/cjs`, `tsconfig.build.mjs.json` → `dist/mjs`, `tsconfig.build.types.json` → `dist/types`), затем `node ../../scripts/post-build.js`, который дописывает расширения относительным импортам в собранном коде и кладёт `dist/cjs/package.json` с `{"type":"commonjs"}`. Сам `package.json` и все `tsconfig.build*.json` генерирует `scripts/prebuild.js` и они игнорируются git — править нужно `package.src.json` и шаблоны в `scripts/jsons`.

Приложение подключает пакет симлинком `test/node_modules/@aom-js/core → ../../../main/packages/core` и резолвит его через `exports` в `dist/mjs` (`dist/cjs` — для `require`). Отсюда инвариант: **правки `src` не видны приложению без `bun run build`**. На 2026-09-02 `dist` собран позже `src` и уже содержит `resolveFor`. Полная схема сборки монорепо и dist-потребления — `docs/architecture.md`.

> ❓ Открытый вопрос: `tsconfig.build.json` комбинирует `module: "commonjs"` с унаследованным `moduleResolution: "bundler"` — пара валидна только для TS 7 (комментарий в `packages/core/tsconfig.build.json:8-12`). Как предполагается работать в IDE с TS 5, не открывая этот конфиг?

## Тесты

### Что покрыто

| Файл | Что проверяет |
|---|---|
| `packages/core/test/smoke.test.ts` | SWC эмитит legacy-сигнатуру декоратора `(target, property)` и `design:type` |
| `packages/core/test/registry.test.ts` | Идентичность инстанса по классу; независимость мета-классов; ключ по функции для метода; пересоздание узла при обращении по свойству после обращения по функции; карты `properties`/`statics`; `checkExists` не создаёт инстанс для класса; `ClassInstanceMap` |
| `packages/core/test/phases.test.ts` | `FIRST`/`INSTANT` в момент декорирования; `LAST` при `apply()`; `DELAY` асинхронно; порядок фаз; фабрики `property`/`parameter`/`combined` |
| `packages/core/test/inherit.test.ts` | Повтор `FIRST` на потомке; каррированная копия статики; защита собственных переопределений (статика и прототип); перенос `LAST`; `PREPEND` на одном и двух уровнях; `SKIP`; синтетический инстанс поля у потомка |
| `packages/router/test/inherited-static-refs.test.ts` | Косвенное покрытие `resolveFor`: `@Before(Self.InheritedStatic)` резолвится в инстанс потомка, курсор реализует отложенный стек в контексте потомка |

Запуск: `bun run test` из корня ядра, отдельно по пакету — `bunx vitest run packages/core`. Проверено 2026-09-02: 4 файла, 29 тестов, все проходят. Тесты пишутся только через публичный API пакета, классы объявляются внутри файла — vitest изолирует модули по файлам, поэтому WeakMap-реестры между файлами не пересекаются.

### Expected-fail

В самом пакете `it.fails`-тестов нет. Дефект ядра `KI-CORE-04` зафиксирован тестом соседнего пакета — `packages/holder/test/holder.test.ts:40-57` (находка #3).

### Пробелы

- `resolveFor` не покрыт тестом в core — только косвенно через router.
- Отложенные декораторы параметров (`KI-CORE-01`, `KI-CORE-02`) — дефекты найдены пробой, тестов и записей в findings нет.
- `DELAY` при `inherit`/`transferTo` и `DELAY` с исключением (`KI-CORE-03`).
- Повторный `inherit` того же родителя и ромбовидное наследование (`KI-CORE-07`).
- `isClass` на нестандартных значениях: стрелка, `bound`-функция, class-выражение с ведущим комментарием.
- Поведение `this` в каррированной копии прототипного метода (`KI-CORE-05`).
- Наследование мета-классов (`Meta2 extends Meta`) и общий реестр при совпадении имён.
- Методы с symbol-ключами.

## Расхождения с историческими заметками

| Заметка | Утверждение | Фактически | Evidence |
|---|---|---|---|
| `packages/core/readme.md` (прежний, 5 строк, HEAD) | `aom` = `abstract-oriented models`; «Core decoration fabric mechanism» — всё содержание | Пакет не описан; расшифровка расходится с `packages/core/src/readme.md:11` (`API over Maps`); файл перезаписан настоящим документом | `packages/core/src/readme.md:11` |
| `packages/core/src/readme.md:37` | `target` + `property` хранятся «синглтоном в мета-свойствах» (Reflect metadata) | Хранение — в `WeakMap` на статическом Symbol-свойстве мета-класса; `reflect-metadata` в пакете не используется | `packages/core/src/defines/core.ts:379-395` |
| `packages/core/src/readme.md:15-34` | API вида `$.property.meta.handler.define(origin)`, `$.target.meta.endpoints`, `$.meta.usedMiddlewares` | Таких полей нет; узел доступен как `$._` с `target`/`property`/`root`, а «мету» реализуют поля наследника | `packages/core/src/defines/core.ts:223-248`, `367-377` |
| `packages/core/src/readme.md:110` | Независимо от статического или собственного свойства `target` равен самому классу | `_.target` действительно всегда конструктор, но `instance()` вызывается с классом для статики и с прототипом для полей инстанса; различие хранит `_.originInstance` и восстанавливает сравнение `origin.target === $origin._.target` | `packages/core/src/defines/core.ts:268-276`, `331-335` |
| `readme.md:28` | Ядро работает для класса и статических методов, декораторы методов инстанса и свойств «ещё бы запихнуть» | Уже реализовано: `propertyDecorator`, карты `properties`/`statics`, перенос прототипных методов | `packages/core/src/defines/core.ts:576-589`, `348-354`; `packages/core/test/inherit.test.ts:97-112`, `161-173` |
| `readme.md:32` | Для не-функциональных свойств нужен «двойной `map.set`/`map.get`» с собственным ключом | Реализовано именно так: синтетический инстанс в `properties`/`statics` сам является ключом WeakMap | `packages/core/src/defines/core.ts:419-443` |
| `docs/correct-extends.md:3-9` | Родительские декораторы всегда переносятся в конец очереди потомка, нужен рефакторинг порядка | Добавлен `InheritPlacement`: `PREPEND` переносит блоком в начало (для отложенных фаз), `SKIP` исключает перенос | `packages/core/src/defines/core.ts:160-175`; `packages/core/test/inherit.test.ts:114-159` |
| `docs/lazy-evaluations.md:17` | Наиболее корректный запуск lazy-декораторов — `setTimer` после всех наследований | Основной отложенный режим — `LAST`, выполняемый синхронно в `_.apply()`; `setTimeout` остался только у `DELAY` | `packages/core/src/defines/core.ts:79-80`, `126-132` |
| `docs/lazy-evaluations.md:137-147` | Замену контекста на потомка (`cursor.constructor = origin.constructor`) «имеет смысл повторить», место неясно | Реализовано как `AomCore.resolveFor` (рабочее дерево); вызывается в `AomCursor` и в `@Before`/`@After`/`@UseMarker`/`@Next` | `packages/core/src/defines/core.ts:508-518`; `packages/router/src/common/classes.ts:220` |
| `docs/core.md:3-4` | В конфигурацию запуска ядра передаётся «внешний» веб-фреймворк | В core нет ничего про HTTP и фреймворки; это уровень router и api | `packages/core/src/index.ts`; `packages/core/package.json` (`dependencies: {}`) |
| `docs/superpowers/plans/2026-07-20-test-coverage.md:18` | yarn 1 workspaces, команды `yarn test` | Монорепо переехало на bun: `bun run test`, `bun --filter` | `package.json:19-38` |

## Открытые вопросы

> ❓ Открытый вопрос: индексированные очереди `AomCallstack.indexes` — это задел под перенос декораторов параметров «строго в пустой список» (`packages/core/src/defines/core.ts:147-156`) или мёртвый код на удаление?

> ❓ Открытый вопрос: должны ли отложенные декораторы параметров допускать несколько вызовов на один индекс, или перезапись (`KI-CORE-02`) — намеренное поведение?

> ❓ Открытый вопрос: нужен ли `try/catch` или Promise-обёртка вокруг `DELAY` (`KI-CORE-03`), чтобы ошибки отложенных декораторов были видны в месте объявления?

> ❓ Открытый вопрос: `resolveFor` помещён в общий `AomCore`, хотя единственный потребитель — router. Оставлять в ядре или перенести в `AomApi`?

> ❓ Открытый вопрос: при переходе на stage-3 декораторы — как сохранить ключ реестра по `descriptor.value` и синтетические инстансы полей, если дескрипторы в новой модели недоступны?

> ❓ Открытый вопрос: каррирование с `this = null` (`KI-CORE-05`) — осознанное ограничение на статики без `this` или временное решение?

> ❓ Открытый вопрос: наследование мета-классов (`Meta2 extends Meta`) — ожидается общий реестр или отдельный? Сейчас он отдельный, если имена различаются, и общий, если `name` совпадает.
