# `@aom-js/core`

Механика декораторной фабрики aom: реестр мета-инстансов, узел, фазы исполнения, наследование метаданных, `resolveFor`. Документ — единый источник истины по этой механике; router, schemer, transfer, holder и api ссылаются сюда вместо собственных объяснений.
Читать до: `docs/architecture.md` (состав ядра, граф пакетов, сборка). Читать после: `packages/router/readme.md`, `packages/schemer/readme.md`.

## Назначение и место в стеке

Пакет даёт любому мета-классу — наследнику `AomCore` — две вещи: собственный реестр «мета-инстансов», ключуемых парой «класс + свойство», и пять фабрик legacy-декораторов, которые не выполняют обработчик немедленно, а кладут ленивый вызов `[handler, [$, ...args], inherit, parameter?]` в очередь одной из четырёх фаз (`ExecutionPhase`); четвёртый элемент — признак вызова декоратора параметра конструктора, используется при переносе на потомка (см. §«Наследование…»). Всё прикладное состояние хранят поля наследника; сам `AomCore` держит единственное поле экземпляра — узел `_` (`packages/core/src/defines/core.ts`, `AomCore._`).

Runtime-зависимостей у пакета нет (`packages/core/package.json`, `dependencies: {}`); `reflect-metadata` он не использует и о HTTP ничего не знает. Потребители — все остальные пакеты ядра: router (`AomApi`, `packages/router/src/common/api.ts`), schemer (`AomSchemas`, `packages/schemer/src/defines/module.ts`), transfer (`AomIsolator`, `packages/transfer/src/defines/main.ts`), holder (`AomHolder`, `packages/holder/src/init.ts`), api (`AomAccessCore`, `packages/api/src/controllers/access/types.ts`). Приложение на ядре может объявить и собственный мета-класс (см. [§«Пример собственного мета-класса»](#пример-собственного-мета-класса)). Полный граф пакетов и порядок сборки — `docs/architecture.md`.

## Публичный API

Точка входа — `packages/core/src/index.ts` → `export * from "./defines"`; каталога констант в `packages/core/src` нет.

### Классы и статические методы

| Экспорт                      | Сигнатура                                                                                                                                           | Назначение                                                                                                                                                                                                                          |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AomCore`                    | `class AomCore { _: AomNode<this>; constructor(base, target, property?, origin?) }`                                                                 | Базовый мета-класс; наследуется и получает собственный реестр и фабрики                                                                                                                                                             |
| `AomCore.instance`           | `static instance<T, E>(this: AomClass<T>, target: E, property?: Property): T`                                                                       | Найти или создать мета-инстанс по `target` (+`property`)                                                                                                                                                                            |
| `AomCore.checkExists`        | `static checkExists<T, E>(this: AomClass<T>, target: E, property?: Property): T \| undefined`                                                       | Вернуть существующий инстанс без создания; для свойства без дескриптора теоретически может создать синтетический инстанс, но эта ветка на практике недостижима — все вызовы в кодовой базе передают только класс (см. §«Особенности») |
| `AomCore.resolveFor`         | `static resolveFor<T>(this: AomClass<T>, $: T, context: ClassConstructor): T`                                                                       | Перепривязать инстанс статики родителя к каррированной копии потомка                                                                                                                                                                |
| `AomCore.classDecorator`     | `static classDecorator<T>(handler: ($: T) => void, storeFlag?: ExecutionPhase, inherit?: InheritPlacement): ClassDecorator`                         | Фабрика декоратора класса                                                                                                                                                                                                           |
| `AomCore.methodDecorator`    | `static methodDecorator<T>(handler: ($: T, descriptor: PropertyDescriptor) => void, storeFlag?, inherit?): MethodDecorator`                         | Фабрика декоратора метода (статического или прототипного); обработчик возвращает `void`: возврат всё равно никуда не доходит                                                                                                        |
| `AomCore.propertyDecorator`  | `static propertyDecorator<T>(handler: ($: T) => void, storeFlag?, inherit?): PropertyDecorator`                                                     | Фабрика декоратора поля                                                                                                                                                                                                             |
| `AomCore.parameterDecorator` | `static parameterDecorator<T>(handler: ($: T, parameterIndex: number) => void, storeFlag?, inherit?): ParameterDecorator`                           | Фабрика декоратора параметра; `parameterIndex` передаётся только обработчику                                                                                                                                                        |
| `AomCore.combinedDecorator`  | `static combinedDecorator<T>(handler: ($: T, descriptor?: PropertyDescriptor) => void, storeFlag?, inherit?): CombinedDecorator`                    | Декоратор для класса ИЛИ метода; `descriptor` есть только у метода                                                                                                                                                                  |
| `ClassInstanceMap`           | `class ClassInstanceMap { set<T>(key: ClassConstructor<T>, value: T): this; get<T>(key): T \| undefined; has(key): boolean; delete(key): boolean }` | Типизированная WeakMap «конструктор → экземпляр»; в самом core не используется, нужна router как `RxContext.state`                                                                                                                  |
| `isClass`                    | `function isClass(value: InstanceTarget): boolean`                                                                                                  | Проверка «это class-синтаксис» через `Function.prototype.toString`                                                                                                                                                                  |

Значения по умолчанию у всех пяти фабрик: `storeFlag = ExecutionPhase.FIRST`, `inherit` не задан (`packages/core/src/defines/core.ts`, `classDecorator`, `combinedDecorator`, `methodDecorator`, `propertyDecorator`, `parameterDecorator`).

### Типы и перечисления

| Экспорт             | Сигнатура                                                                                                                  | Назначение                                                                       |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `ExecutionPhase`    | `enum { INSTANT="instant", FIRST="first", LAST="last", DELAY="delay" }`                                                    | Фаза выполнения ленивого вызова (`packages/core/src/defines/types.ts`)           |
| `InheritPlacement`  | `enum { APPEND="append", PREPEND="prepend", SKIP="skip" }`                                                                 | Размещение вызова при переносе на потомка (`packages/core/src/defines/types.ts`) |
| `ClassConstructor`  | `type ClassConstructor<T = {}> = new (...args: any[]) => T`                                                                | Тип конструктора                                                                 |
| `ClassType`         | `type ClassType = ClassConstructor \| Function`                                                                            | Конструктор или функция                                                          |
| `Property`          | `type Property = string \| symbol`                                                                                         | Ключ свойства                                                                    |
| `InstanceTarget`    | `type InstanceTarget = ClassType \| InstanceType<ClassConstructor>`                                                        | Цель декорирования: класс, функция, прототип или объект                          |
| `CombinedDecorator` | `type CombinedDecorator = <T>(target: ClassType, propertyKey?: Property, descriptor?: TypedPropertyDescriptor<T>) => void` | Сигнатура комбинированного декоратора                                            |

### Не экспортируется

| Символ                                                             | Где                                                                                                              | Почему важен                                                     |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `AomNode`                                                          | `packages/core/src/defines/node.ts`                                                                              | Модель узла; доступна только через `$._` — тип наружу не выведен |
| `AomCallstack`, `AomCallstackQueue`                                | `packages/core/src/defines/callstack.ts`                                                                         | Очереди фаз; доступны через `$._.callstack`                      |
| `LazyCall`, `OriginDescriptor`, `NodeOriginDescriptor`, `AomClass` | `callstack.ts` (`LazyCall`), `node.ts` (`NodeOriginDescriptor`), `internals.ts` (`OriginDescriptor`, `AomClass`) | Внутренние типы ленивого вызова и origin-дескриптора             |

Собственных констант ошибок в пакете нет; router держит свои (`packages/router/src/constants/errors.ts`, `CONSTRUCTOR_TYPE_ERROR`, `CONSTRUCTOR_PROPERTY_TYPE_ERROR`).

## Внутренние модули

| Файл                                                                                                                                                  | Ответственность                                                                                                                                          | Ключевые символы                                                                                                                                               |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/core/src/index.ts`                                                                                                                          | Единственная точка входа: `export * from "./defines"`                                                                                                    | —                                                                                                                                                              |
| `packages/core/src/defines/index.ts`                                                                                                                  | Реэкспорт `functions`, `types`, `classes`, `core` (файлы `node.ts`, `callstack.ts`, `internals.ts` наружу не реэкспортируются)                           | —                                                                                                                                                              |
| `packages/core/src/defines/core.ts`                                                                                                                   | Мета-класс: реестр мета-инстансов и пять фабрик декораторов                                                                                              | `AomCore`                                                                                                                                                      |
| `packages/core/src/defines/node.ts`                                                                                                                   | Узел мета-инстанса: origin-дескрипторы, `apply`, `inherit`                                                                                               | `AomNode`, `NodeOriginDescriptor` (не экспортируются наружу)                                                                                                   |
| `packages/core/src/defines/callstack.ts`                                                                                                              | Очередь одной фазы и стек очередей по фазам                                                                                                              | `AomCallstackQueue`, `AomCallstack`, `LazyCall` (не экспортируются наружу)                                                                                     |
| `packages/core/src/defines/internals.ts`                                                                                                              | Внутренние типы, общие для файлов пакета: сигнатуры обработчиков, `AomClass`, origin-дескриптор                                                          | `AomHandler`, `AomCombinedHandler`, `AomMethodHandler`, `AomPropertyHandler`, `AomParameterHandler`, `AomClass`, `OriginDescriptor` (не экспортируются наружу) |
| `packages/core/src/defines/types.ts`                                                                                                                  | Публичные типы и перечисления                                                                                                                            | `ExecutionPhase`, `InheritPlacement`, `ClassConstructor`, `ClassType`, `Property`, `InstanceTarget`, `CombinedDecorator`                                       |
| `packages/core/src/defines/classes.ts`                                                                                                                | Типизированная обёртка над `WeakMap<конструктор, экземпляр>`                                                                                             | `ClassInstanceMap`                                                                                                                                             |
| `packages/core/src/defines/functions.ts`                                                                                                              | Проверка class-синтаксиса регуляркой по `toString`                                                                                                       | `isClass`                                                                                                                                                      |
| `packages/core/test/smoke.test.ts`, `packages/core/test/registry.test.ts`, `packages/core/test/phases.test.ts`, `packages/core/test/inherit.test.ts`  | Тесты пакета (см. §«Тесты»)                                                                                                                              | —                                                                                                                                                              |
| `packages/core/package.json`, `packages/core/tsconfig.build.json`, `packages/core/tsconfig.build.mjs.json`, `packages/core/tsconfig.build.types.json` | Генерируются `scripts/prebuild.js` из общей версии корневого `package.json`, `package.src.json` и `scripts/jsons/package.dist.json`; в `.gitignore` (правила `packages/**/package.json` и `packages/**/tsconfig.build*.json`) | —                                                                                                                                                              |

## Ключевые механизмы

### Реестр инстансов и ключи

Реестр каждого мета-класса — `WeakMap`, лежащая на статическом свойстве самого класса под ключом `Symbol.for(\`AOM_MAP_${this.name}\`)`; при первом обращении карта создаётся (`packages/core/src/defines/core.ts`, `AomCore.instancesMap`). Символ глобальный, но читается он с конкретного `this`, поэтому мета-классы с разными именами всегда независимы.

Ключ вычисляет `instanceKey(target, property)` (`packages/core/src/defines/core.ts`, `AomCore.instanceKey`). Конструктор берётся как сам `target`, если это функция, иначе `target.constructor`. Далее:

- `property` не задан либо конструктор не является классом (`isClass`) → ключ = сам `target`;
- `property` задан, дескриптор существует, у него есть `value` и он не `enumerable` (то есть это метод) → ключ = сама функция `descriptor.value`, поэтому `Meta.instance(A, "run")` и `Meta.instance(A.run)` дают один инстанс;
- иначе (поле без дескриптора или `enumerable`-статика) → создаётся синтетический инстанс `new this(this, constructor, property, originDescriptor)`, который кладётся в карту сам на себя (`map.set(instanceKey, instanceKey)`) и в `root._.statics` (если `target === constructor`) либо в `root._.properties` (если `target` — прототип).

| Что декорируется          | Вызов                                    | Ключ в реестре            | Куда попадает                          |
| ------------------------- | ---------------------------------------- | ------------------------- | -------------------------------------- |
| Класс                     | `instance(A)`                            | сам класс `A`             | —                                      |
| Статический метод         | `instance(A, "run")` = `instance(A.run)` | функция `A.run`           | `root._.origins`                       |
| Прототипный метод         | `instance(A.prototype, "run")`           | функция `A.prototype.run` | `root._.origins`                       |
| Поле инстанса             | `instance(A.prototype, "field")`         | синтетический инстанс     | `root._.properties` + `root._.origins` |
| Статическое data-поле     | `instance(A, "config")`                  | синтетический инстанс     | `root._.statics`                       |
| Свойство не-class функции | `instance(fn, "x")`                      | сама `fn`                 | — (карты не задействованы)             |

Последняя строка — следствие условия `property && isClass(constructor)` (`packages/core/src/defines/core.ts`, `AomCore.instanceKey`): для обычной функции или стрелки `property` игнорируется и ключом становится сам `target`, поэтому разные свойства одной функции получат один инстанс.

`instance()` (`packages/core/src/defines/core.ts`, `AomCore.instance`) ищет по ключу, при отсутствии создаёт инстанс и сохраняет. Отдельная ветка `packages/core/src/defines/core.ts` (`AomCore.instance`) чинит порядок обращений: если инстанс уже был создан по значению функции (без `property`), а теперь запрошен по паре «класс + свойство», его узел `_` пересоздаётся с корректными `target`, `property` и `root`.

`packages/core/test/registry.test.ts` («инстанс, созданный по значению функции, дополняется нодой при обращении по свойству»):

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

Evidence: `packages/core/src/defines/core.ts` (`AomCore.instancesMap`, `AomCore.instanceKey`, `AomCore.checkExists`, `AomCore.instance`); `packages/core/test/registry.test.ts`.

### Узел `AomNode`

Узел (`packages/core/src/defines/node.ts`, `AomNode`) — служебная часть мета-инстанса, доступная как `$._`.

| Поле                     | Тип                      | Содержание                                                                                                                                         |
| ------------------------ | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `base`                   | мета-класс               | Класс, чей реестр создал инстанс; через него узел вызывает `instance()`                                                                            |
| `target`                 | `ClassConstructor`       | Конструктор-владелец — всегда конструктор, и для статики, и для полей инстанса                                                                     |
| `property`               | `Property?`              | Ключ свойства; у узла класса не задан                                                                                                              |
| `self`                   | мета-инстанс             | Сам инстанс, которому принадлежит узел                                                                                                             |
| `root`                   | мета-инстанс             | Для узла свойства — мета-инстанс класса, для узла класса — `self`                                                                                  |
| `originInstance`         | `InstanceTarget`         | То, что реально декорировалось: класс (статика) или прототип (свойство инстанса)                                                                   |
| `origins`                | `NodeOriginDescriptor[]` | Узлы декорированных свойств; наполняется только у корневого узла                                                                                   |
| `properties` / `statics` | `Map<Property, T>`       | Синтетические инстансы полей инстанса и статических data-полей                                                                                     |
| `callstack`              | `AomCallstack`           | Очереди фаз собственного узла                                                                                                                      |
| `inherited`              | `WeakSet<ClassType>`     | Родители, чьи вызовы уже перенесены на этот узел; не даёт повторному `inherit(parent)` повторно выполнить его FIRST-очередь                        |

`origins` наполняется только у корневого узла и только когда дескриптор отсутствует либо не `enumerable` (`packages/core/src/defines/node.ts`, `AomNode.origins`): туда попадают методы (статические и прототипные) и поля инстанса, но не `enumerable`-статические data-поля — те живут исключительно в `statics`. Разделение «статика или прототип» восстанавливается сравнением `origin.target === $origin._.target` (`packages/core/src/defines/node.ts`, `AomNode.inherit`); эту же формулу повторяют holder (`packages/holder/src/decorators.ts`, `Apply`) и mapped-types схемера (`packages/schemer/src/defines/mapped-types/partial-type.helper.ts`, `PartialType`).

`apply()` (`packages/core/src/defines/node.ts`, `AomNode.apply`) разбирает отложенные очереди в фиксированном порядке: сначала все узлы из `properties`, затем из `statics`, затем из `origins`, и только потом собственный `callstack` узла.

Evidence: `packages/core/src/defines/node.ts` (`AomNode`, `AomNode.apply`); `packages/core/test/registry.test.ts` («свойство инстанса попадает в карту properties корневого класса», «статическое НЕ-методное свойство попадает в карту statics»).

### Фазы и очереди

`AomCallstack` создаёт по одной очереди `AomCallstackQueue` на каждое значение `ExecutionPhase` — в `stores` (`packages/core/src/defines/callstack.ts`). Поведение очереди задаётся фазой в конструкторе `AomCallstackQueue` (`packages/core/src/defines/callstack.ts`): `async = true` только у `DELAY`, `deferred = true` у `LAST` и `DELAY`.

| Фаза      | Когда выполняется                | Где сохраняется   | Наследуется                             | Возврат доходит до декоратора |
| --------- | -------------------------------- | ----------------- | --------------------------------------- | ----------------------------- |
| `INSTANT` | в момент декорирования           | нигде             | нет (особенность, не дефект — см. ниже) | нет                           |
| `FIRST`   | в момент декорирования           | `fired`           | да, с повторным выполнением на потомке  | нет                           |
| `LAST`    | при `_.apply()` корневого узла   | `queue` → `fired` | да, встаёт в очередь потомка            | нет                           |
| `DELAY`   | в `setTimeout` после `_.apply()` | `queue` → `fired` | да, встаёт в очередь потомка            | нет                           |

`add()` (`packages/core/src/defines/callstack.ts`, `AomCallstackQueue.add`) реализует эту таблицу тремя ветками: `deferred` (`LAST`/`DELAY`) кладёт вызов в `queue` через `push` и ждёт `exec()`; `FIRST` кладёт вызов в `fired` через `push` и тут же выполняет, поэтому он и срабатывает сразу, и остаётся доступным для переноса на потомка; `INSTANT` только выполняет, нигде не сохраняя. Индекс параметра в размещении вызова участия больше не принимает — раньше здесь был `place()`, писавший по индексу в `queue`/`fired`; сейчас `parameterIndex` попадает только в аргументы обработчика (см. §«Фабрики декораторов»).

INSTANT-вызовы намеренно нигде не сохраняются: `@Controller()`, `@ComponentSchema()`, `@Delay`/`@Apply` holder'а вызывают `$._.inherit()`/`$._.apply()` и объявлены в фазе INSTANT именно затем, чтобы не сохраняться в очереди — иначе `transferTo` повторил бы вызов агрегатора на потомке и увёл бы в рекурсию. Это особенность, а не дефект; характеризационный тест — `packages/core/test/phases.test.ts` («INSTANT выполняется немедленно и не сохраняется в очередях»).

`exec()` (`packages/core/src/defines/callstack.ts`, `AomCallstackQueue.exec`) вычерпывает очередь через `while ((value = this.queue.shift()))` и складывает выполненное в `fired` — повторный `apply()` те же `LAST` не повторяет. `run()` (`packages/core/src/defines/callstack.ts`, `AomCallstackQueue.run`) вызывает обработчик через `Reflect.apply(handler, null, args)`; для `DELAY` — внутри `setTimeout` без аргумента задержки, поэтому возвращаемое значение обработчика теряется, а брошенное исключение никем не перехватывается (см. §«Особенности»).

`AomCallstack.apply()` (`packages/core/src/defines/callstack.ts`) перебирает фазы в порядке объявления enum — `INSTANT`, `FIRST`, `LAST`, `DELAY` — и для каждой вызывает `exec()` на `stores`. Очереди `INSTANT`/`FIRST` к этому моменту пусты по построению.

`packages/core/test/phases.test.ts` («порядок фаз при apply(): FIRST уже выполнен, затем LAST, затем DELAY (асинхронно)»):

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

Evidence: `packages/core/src/defines/callstack.ts` (`AomCallstackQueue`, `AomCallstack`); `packages/core/test/phases.test.ts` («LAST на методе выполняется только при apply() корневого класса», «порядок фаз при apply(): FIRST уже выполнен, затем LAST, затем DELAY (асинхронно)», «INSTANT выполняется немедленно и не сохраняется в очередях»).

### Фабрики декораторов

Все пять фабрик устроены одинаково: захватывают `this` (мета-класс) в `self`, получают мета-инстанс через `self.instance(target, property)` и добавляют ленивый вызов в очередь заданной фазы. Различаются они целью и составом аргументов обработчика (`packages/core/src/defines/core.ts`, `classDecorator`, `combinedDecorator`, `methodDecorator`, `propertyDecorator`, `parameterDecorator`):

| Фабрика              | Инстанс берётся по                                                                                      | Аргументы обработчика                                                                                |
| -------------------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `classDecorator`     | `instance(target)`                                                                                      | `[$]`                                                                                                |
| `combinedDecorator`  | `instance(target, property)`                                                                            | `[$, descriptor]` — `descriptor` определён только для метода                                         |
| `methodDecorator`    | `instance(target, property)`                                                                            | `[$, descriptor]`                                                                                    |
| `propertyDecorator`  | `instance(target, property)`                                                                            | `[$]`                                                                                                |
| `parameterDecorator` | `instance(target, property)` — для параметров конструктора `property === undefined`, значит узел класса | `[$, parameterIndex]` — `parameterIndex` передаётся только обработчику, позицией в очереди не служит |

Значение, возвращённое обработчиком, **не доходит до TypeScript ни в одной фазе**. `AomCallstackQueue.add()` действительно возвращает результат `run()` в ветках `FIRST`/`INSTANT` (`packages/core/src/defines/callstack.ts`), но ни одна фабрика не возвращает этот результат наружу декоратору — все они вызывают `targetInstance._.callstack.add(...)` (то есть `AomCallstack.add()`, `packages/core/src/defines/callstack.ts`, который сам вызывает `store.add(value)` тоже без `return`) как побочный эффект. Поэтому `AomMethodHandler` возвращает `void` (`packages/core/src/defines/internals.ts`) — тип соответствует фактическому поведению: `methodDecorator` не может подменить дескриптор метода возвращаемым значением ни в `FIRST`, ни в `LAST`.

Evidence: `packages/core/src/defines/core.ts` (`classDecorator`, `combinedDecorator`, `methodDecorator`, `propertyDecorator`, `parameterDecorator`), `packages/core/src/defines/internals.ts` (`AomHandler`, `AomCombinedHandler`, `AomMethodHandler`, `AomPropertyHandler`, `AomParameterHandler`, `AomClass`), `packages/core/src/defines/callstack.ts` (`LazyCallHandler`, `AomCallstackQueue.add`, `AomCallstack.add`); `packages/core/test/phases.test.ts` («propertyDecorator работает на свойствах инстанса», «parameterDecorator получает индекс параметра», «LAST на параметре выполняется, даже если левее декорированных параметров нет», «два LAST-декоратора на одном параметре выполняются оба», «combinedDecorator различает класс и статический метод»).

### Наследование: `inherit`, `transferTo`, каррирование

`AomNode.inherit(parent)` (`packages/core/src/defines/node.ts`) выполняет два шага.

Перед этим — дедупликация: `inherited` — `WeakSet<ClassType>` с уже унаследованными родителями (`packages/core/src/defines/node.ts`, `AomNode.inherited`). Повторный `inherit(того же parent)` просто возвращает `$parent` без повторного переноса (`packages/core/src/defines/node.ts`, `AomNode.inherit`) — без этого каждый вызов заново выполнял бы FIRST-очередь родителя; тест — `packages/core/test/inherit.test.ts` («повторный inherit того же родителя не повторяет FIRST-вызовы»).

Шаг первый — перенос собственных вызовов класса-родителя: `$parent._.callstack.transferTo(this.self)`. `transferTo` (`packages/core/src/defines/callstack.ts`, `AomCallstack.transferTo`, `AomCallstackQueue.transferTo`) для каждой фазы обходит `[...fired, ...queue]` и добавляет вызов в очередь потомка, подменив первый аргумент (`$`) на мета-инстанс потомка. Следствия: `FIRST` в момент `inherit` выполняется повторно — уже в контексте потомка; `LAST`/`DELAY` просто встают в очередь потомка. Размещение задаёт третий элемент ленивого вызова:

| `InheritPlacement`  | Отложенные фазы (`LAST`/`DELAY`)                                                  | `FIRST`                                            |
| ------------------- | --------------------------------------------------------------------------------- | -------------------------------------------------- |
| не задан / `APPEND` | в конец очереди потомка, после его собственных вызовов                            | выполняется на потомке после его собственных       |
| `PREPEND`           | единым блоком в начало очереди потомка, взаимный порядок внутри блока сохраняется | как `APPEND` — порядок уже задан моментом переноса |
| `SKIP`              | не переносится                                                                    | не переносится                                     |

Блок `PREPEND` собирается в отдельный массив и ставится в начало через `prependBatch` (`packages/core/src/defines/callstack.ts`) — поштучный `unshift` развернул бы порядок. Этим механизмом пользуется `@Before` роутера, чтобы родительские pre-middleware оказывались перед собственными (`packages/router/src/decorators/middlewares/index.ts`, `Before`).

Шаг второй — перенос декорированных свойств родителя по `$parent._.origins` (`packages/core/src/defines/node.ts`, `AomNode.inherit`). Перенос выполняется, только если потомок ещё не владеет свойством; проверок две и обе нужны: `Object.hasOwn` закрывает статики и прототипные методы, реестр (`root._.statics` / `root._.properties`) — поля класса, которых физически нет ни на конструкторе, ни на прототипе. При переносе метода `transferDescritorWithDecorators` (`packages/core/src/defines/node.ts`, `AomNode.inherit`) определяет у потомка **собственное** свойство с каррированной обёрткой:

`packages/core/src/defines/node.ts` (`AomNode.inherit`):

```ts
if (descriptor && descriptor.value) {
  // здесь обязательно каррирование, так как иначе будет замена контекста исходного дескриптора изначального родительского класса
  // this пробрасывается вызывающей стороне (не фиксируется на null): для статики это
  // конкретный класс, для прототипного метода — инстанс, на котором его вызвали
  const curriedDescriptor = function (this: any, ...args: any[]) {
    return Reflect.apply(descriptor.value, this, args);
  };
  // определим
  Reflect.defineProperty(target, property, {
    ...descriptor,
    value: curriedDescriptor,
  });
}
```

Копия — другая функция, значит и другой ключ в реестре: у потомка появляется собственный мета-инстанс метода, на который переносятся декораторы родителя. Каррированная копия — обычная `function`, и `this` внутри — тот, с которым вызвали копию (класс-потомок для статики, инстанс — для прототипного метода); тесты — `packages/core/test/inherit.test.ts` («унаследованный статический метод получает потомка как this при вызове», «унаследованный прототипный метод получает инстанс как this при вызове»). Идентичность методов родителя и потомка при этом разная (`Child.run !== Parent.run`) — это не дефект, сравнивать нужно по мета-инстансу.

Порядок вызовов `inherit` по цепочке задаёт вызывающая сторона. `@Controller()` идёт от ближайшего родителя вверх (`packages/router/src/decorators/controllers/index.ts`, `Controller`), поэтому при `PREPEND` блок прародителя оказывается перед блоком родителя (`packages/core/test/inherit.test.ts`, «PREPEND у нескольких уровней: блок прародителя встаёт раньше блока родителя»).

Evidence: `packages/core/src/defines/callstack.ts` (`AomCallstack.transferTo`, `AomCallstackQueue.transferTo`), `packages/core/src/defines/node.ts` (`AomNode.inherit`); `packages/core/test/inherit.test.ts`.

Декораторы параметров конструктора — особый случай `transferTo`: если у потомка свой конструктор со своими декорированными параметрами, родительские декораторы параметров конструктора вообще не переносятся, вместо того чтобы встать в очередь после собственных и перезаписать их результат (`AomCallstackQueue.hasParameters()`, `packages/core/src/defines/callstack.ts`, и `skipParameters` в `AomCallstack.transferTo`, `packages/core/src/defines/callstack.ts`; признак — четвёртый элемент ленивого вызова, `parameter?: boolean`, `packages/core/src/defines/callstack.ts` (`LazyCall`)). Ограничение (см. комментарий `shortcut:`, `packages/core/src/defines/callstack.ts` (`AomCallstack.transferTo`)): свой конструктор потомка без собственных декорированных параметров не распознаётся, и родительские декораторы параметров всё равно перенесутся — точное распознавание требует чтения `design:paramtypes`. Тесты — `packages/core/test/inherit.test.ts` («потомок со своими декораторами параметров конструктора не получает родительские» — свой конструктор со своими параметрами не получает родительские, «потомок без своего конструктора получает декораторы параметров конструктора родителя» — без своего конструктора родительские переносятся как раньше, «собственные декораторы полей потомка не дополняются родительскими» — свои декораторы полей не дополняются родительскими); `packages/router/test/router-exec.test.ts` («потомок со своим конструктором получает свои аргументы, а не родительские») (тот же случай через `@Query`).

Вызовы параметр-декораторов лежат в очереди подряд, без привязки к индексу параметра, поэтому перенос метода с `FIRST`-декоратором не на первом параметре проходит без ошибки.

`packages/core/test/inherit.test.ts` («метод с FIRST-декоратором не первого параметра переносится на потомка без ошибки»):

```ts
it("метод с FIRST-декоратором не первого параметра переносится на потомка без ошибки", () => {
  const seen: string[] = [];
  const Param = () =>
    Meta.parameterDecorator(($, index) => seen.push(`${$._.target.name}:${index}`));
  class Parent {
    static run(a: string, @Param() b: string) {}
  }
  class Child extends Parent {}
  expect(() => Meta.instance(Child)._.inherit(Parent)).not.toThrow();
  expect(seen).toEqual(["Parent:1", "Child:1"]);
});
```

Evidence: `packages/core/test/inherit.test.ts` («метод с FIRST-декоратором не первого параметра переносится на потомка без ошибки»).

### `resolveFor`

Evidence: `packages/core/src/defines/core.ts` (`AomCore.resolveFor`) (добавлено коммитом `4d7a5be`, `+12` строк).

`resolveFor($, context)` решает задачу поздней привязки. Ссылка вида `@Before(Self.Method)` вычисляется в момент декорирования, когда `@Controller()` потомка ещё не отработал, и потому фиксирует мета-инстанс статики **родителя**. После `inherit()` у потомка появляется собственная каррированная копия метода со своим мета-инстансом, и ссылку нужно доразрешить.

`packages/core/src/defines/core.ts` (`AomCore.resolveFor`):

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

Единственный потребитель — router: `AomCursor` перепривязывает `$` при создании курсора (`packages/router/src/common/cursor.ts`), а `@Before`/`@After`/`@UseMarker`/`@Next` доразрешают ссылки на middleware в контексте класса, объявившего декоратор (`packages/router/src/decorators/middlewares/index.ts`, `Before`, `After`, `UseMarker`, `Next`). Косвенное покрытие — `packages/router/test/inherited-static-refs.test.ts` («Before(Self.InheritedStatic) резолвится в инстанс потомка», «курсор реализует delayStack в контексте потомка (исходный краш)») (добавлен тем же коммитом `4d7a5be`).

## Инварианты и подводные камни

- Мета-класс — наследник `AomCore` с собственными полями состояния; фабрики вызываются на самом мета-классе (`Meta.methodDecorator(($) => …)`). Деструктурировать фабрику нельзя: `this` внутри — это мета-класс, из него берутся реестр и конструктор инстанса.
- Ссылки на владельца внутри обработчика — только через узел: `$._.target`, `$._.property`, `$._.root`. Прикладные данные класса складываются в `$._.root`, данные свойства — в сам `$`.
- Декораторы-агрегаторы, вызывающие `$._.inherit()` и `$._.apply()`, объявляются в фазе `INSTANT` — иначе перенос на потомка повторит агрегатор и вызовет рекурсию. Так сделаны `@Controller()` (`packages/router/src/decorators/controllers/index.ts`, `Controller`), `@ComponentSchema()` (`packages/schemer/src/defines/decorators.ts`, `ComponentSchema`), `@Delay` (`packages/holder/src/decorators.ts`, `Delay`); `@Apply` объявлен в той же фазе и делает то же самое опосредованно — через `Reflect.decorate([Delay(...)])` (`packages/holder/src/decorators.ts`, `Apply`). Поэтому `INSTANT`-вызовы намеренно нигде не сохраняются и не наследуются — это особенность, а не дефект, см. §«Особенности» ниже.
- `LAST`-вызовы свойств разбираются только через `apply()` корневого узла класса: без агрегатора на классе отложенные декораторы методов не выполнятся никогда.
- Порядок применения legacy-декораторов задаёт TypeScript: методы класса декорируются раньше самого класса (`packages/core/test/phases.test.ts` («combinedDecorator различает класс и статический метод»)), а несколько декораторов на одной цели применяются снизу вверх — это правило TypeScript, тестом пакета не закреплено (комментарий в `packages/core/test/phases.test.ts`, тест «порядок фаз при apply(): FIRST уже выполнен, затем LAST, затем DELAY (асинхронно)»).
- Реестры мета-классов с разными именами независимы (`Symbol.for` читается с конкретного `this`). Слияние возможно только у наследника мета-класса с тем же `name`: символ совпадает, собственного свойства у наследника ещё нет, и он читает карту родителя через цепочку статического наследования (проверено пробой на `dist`).
- Относительные импорты в `src` пишутся без расширений — `tsc` их не подставляет, расширения дописывает `scripts/post-build.js` в `dist`; спецификаторы, уже написанные с расширением (js, json, mjs, cjs), скрипт пропускает как есть, падает он только на неразрешимых путях — копит их в `errors` и завершается с кодом 1 (`scripts/post-build.js` (`SPEC`, `errors`)).
- `strictPropertyInitialization` выключен намеренно: поля узлов и мета-классов заполняют декораторы, а не конструктор (`tsconfig.base.json`).

### Известные дефекты

Открытых дефектов нет. Известное ограничение переноса декораторов параметров конструктора (комментарий `shortcut:`) — в §«Наследование: `inherit`, `transferTo`, каррирование».

### Особенности

Вызовы фазы `INSTANT` нигде не сохраняются и потому не наследуются — это намеренное поведение, не дефект. Evidence: `packages/core/src/defines/callstack.ts` (`AomCallstackQueue.add`) (ветка `INSTANT` только выполняет `run()`, не пишет ни в `queue`, ни в `fired`); характеризационный тест — `packages/core/test/phases.test.ts` («INSTANT выполняется немедленно и не сохраняется в очередях»). Причина — в §«Инварианты и подводные камни» выше: агрегаторы `@Controller()`/`@ComponentSchema()`/`@Delay`/`@Apply` вызывают `$._.inherit()`/`$._.apply()` и объявлены в `INSTANT` именно затем, чтобы не сохраняться — иначе перенос на потомка повторил бы агрегатор и ушёл в рекурсию. Поэтому holder сам переносит `$.queue` родительского `AomHolder`-инстанса перед `inherit()` — иначе класс-декораторы из `@Delay` родителя не доезжали бы до потомка при `@Apply` (`packages/holder/readme.md`). Как использовать: для наследуемого поведения выбирать `FIRST` вместо `INSTANT`.

После `inherit` каррированная копия метода — другая функция с собственным мета-инстансом, поэтому `Child.run !== Parent.run`; сравнивать методы родителя и потомка нужно по мета-инстансу (`AomApi.instance(...)`), а не по ссылке на функцию. `this` копия пробрасывает вызывающей стороне (см. §«Наследование: `inherit`, `transferTo`, каррирование»). Evidence: `packages/core/src/defines/node.ts` (`AomNode.inherit`); тесты — `packages/core/test/inherit.test.ts` («унаследованный статический метод получает потомка как this при вызове», «унаследованный прототипный метод получает инстанс как this при вызове»).

`checkExists` для свойства без дескриптора теоретически не является чистой проверкой — та же ветка `instanceKey`, что и в `instance()`, может создать и зарегистрировать синтетический инстанс (`packages/core/src/defines/core.ts` (`AomCore.instanceKey`) — ветка создания, `AomCore.checkExists` — сама `checkExists`). На практике эта ветка недостижима: она требует вызова с `property`, а во всей кодовой базе (`grep -rn "checkExists("`) каждый вызов передаёт только класс. Как использовать: не передавать `property` в `checkExists` без крайней необходимости; если понадобится — иметь в виду побочный эффект.

Фаза `DELAY` выполняется в `setTimeout` (`packages/core/src/defines/callstack.ts`, `AomCallstackQueue`, `AomCallstackQueue.run`) без `try/catch`. Ошибка обработчика `DELAY` не «теряется молча» — она роняет процесс необработанным исключением (`uncaughtException`/`unhandledRejection`); проверено пробой в bun и node. Автоматического теста на это поведение в пакете нет — падение процесса тестом не воспроизвести без отдельного дочернего процесса. Решение автора — оставить фазу `DELAY` как есть. Как использовать: не класть в обработчик `DELAY` код, который может бросить исключение.

Возврат обработчика из фабрик декораторов не доходит до TypeScript ни в одной фазе, поэтому обработчик метода типизирован как `void` — см. §«Фабрики декораторов» выше.

### Легаси и мёртвый код

Известного легаси и мёртвого кода в пакете нет.

## Пример собственного мета-класса

Приложение на ядре может объявить собственный мета-класс, например реестр «метод эндпоинта → требуемая роль»:

```ts
class RoleRelay extends AomCore {
  required: { target: ClassConstructor; property: Property; role: string }[] = [];
}

const RequireRole = (role: string) =>
  RoleRelay.methodDecorator(($) => {
    const { target, property } = $._;
    $._.root.required.push({ target, property, role });
    Reflect.decorate([Before(CheckRole) as MethodDecorator], target, property!);
  });
```

Здесь видны сразу три приёма из §«Ключевые механизмы»: владелец и имя метода берутся из узла (`$._.target`, `$._.property`), накопитель кладётся в мета-инстанс **класса** (`$._.root`), а не свойства, и обработчик сам навешивает декораторы роутера через `Reflect.decorate` — то есть мета-класс выступает генератором маршрутных декораторов. В рантайме middleware `CheckRole` берёт мета-инстанс класса-владельца курсора через `RoleRelay.instance(origin._.target)` и находит запись по `origin._.property`.

Косвенно ядро задействовано в каждом классе приложения на ядре: `@Controller()`, `@ComponentSchema()`, `@Isolator()` и все параметр-декораторы маршрутов — это фабрики `AomCore` поверх мета-классов router, schemer и transfer.

## Сборка и потребление

Сборка пакета — `bun run build:core` в корне ядра (эквивалент `bun --filter @aom-js/core build`, `package.json` (`typescript`)): три прохода `tsc` по сгенерированным конфигам (`tsconfig.build.json` → `dist/cjs`, `tsconfig.build.mjs.json` → `dist/mjs`, `tsconfig.build.types.json` → `dist/types`), затем `node ../../scripts/post-build.js`, который дописывает расширения относительным импортам в собранном коде и кладёт `dist/cjs/package.json` с `{"type":"commonjs"}`. Сам `package.json` и все `tsconfig.build*.json` генерирует `scripts/prebuild.js` и они игнорируются git — править нужно `package.src.json` и шаблоны в `scripts/jsons`.

Потребитель резолвит пакет через `exports` в `dist/mjs` (`dist/cjs` — для `require`). Отсюда инвариант: **правки `src` не видны потребителю без `bun run build`**. Полная схема сборки монорепо и dist-потребления — `docs/architecture.md`.

> ❓ Открытый вопрос: `tsconfig.build.json` комбинирует `module: "commonjs"` с унаследованным `moduleResolution: "bundler"` — пара валидна только для TS 7 (комментарий в `packages/core/tsconfig.build.json`). Как предполагается работать в IDE с TS 5, не открывая этот конфиг?

## Тесты

### Что покрыто

| Файл                                                 | Что проверяет                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/core/test/smoke.test.ts`                   | SWC эмитит legacy-сигнатуру декоратора `(target, property)` и `design:type`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `packages/core/test/registry.test.ts`                | Идентичность инстанса по классу; независимость мета-классов; ключ по функции для метода; пересоздание узла при обращении по свойству после обращения по функции; карты `properties`/`statics`; `checkExists` не создаёт инстанс для класса; `ClassInstanceMap`                                                                                                                                                                                                                                                                                                                                                                             |
| `packages/core/test/phases.test.ts`                  | `FIRST`/`INSTANT` в момент декорирования (включая характеризацию: INSTANT не сохраняется в очередях)              ; `LAST` при `apply()`; `DELAY` асинхронно; порядок фаз; фабрики `property`/`parameter`/`combined`; `LAST` на параметре без декорированных соседей слева и два `LAST`-декоратора на одном параметре                                                                                                                                                                                                                                                                                 |
| `packages/core/test/inherit.test.ts`                 | Повтор `FIRST` на потомке; каррированная копия статики; `this` каррированной копии — сам класс/инстанс, с которым её вызвали, а не `null`; повторный `inherit` того же родителя не повторяет `FIRST`-вызовы; защита собственных переопределений (статика и прототип); перенос `LAST`; `PREPEND` на одном и двух уровнях; `SKIP`; синтетический инстанс поля у потомка; перенос метода с `FIRST`-декоратором не первого параметра без ошибки; декораторы параметров конструктора не переносятся потомку со своим конструктором |
| `packages/router/test/inherited-static-refs.test.ts` | Косвенное покрытие `resolveFor`: `@Before(Self.InheritedStatic)` резолвится в инстанс потомка, курсор реализует отложенный стек в контексте потомка                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

Запуск: `bun run test` из корня ядра, отдельно по пакету — `bunx vitest run packages/core`. Число файлов и тестов печатает сам прогон. Тесты пишутся только через публичный API пакета, классы объявляются внутри файла — vitest изолирует модули по файлам, поэтому WeakMap-реестры между файлами не пересекаются.

### Expected-fail

В самом пакете `it.fails`-тестов нет и не было: особенность фазы `INSTANT` характеризуется обычным (проходящим) тестом — `packages/core/test/phases.test.ts` («INSTANT выполняется немедленно и не сохраняется в очередях»). Связанный сценарий holder проверяет обычный проходящий тест того пакета — `packages/holder/test/holder.test.ts` («Delay на родителе + Apply на потомке переносит класс-декораторы родителя»).

### Пробелы

- `resolveFor` не покрыт тестом в core — только косвенно через router.
- `DELAY` с исключением, роняющим процесс — не покрыт автотестом: падение процесса не воспроизвести в рамках vitest без отдельного дочернего процесса; проверено пробой в bun и node вручную. `DELAY` при `inherit`/`transferTo` тестом тоже не покрыт.
- `isClass` на нестандартных значениях: стрелка, `bound`-функция, class-выражение с ведущим комментарием.
- Наследование мета-классов (`Meta2 extends Meta`) и общий реестр при совпадении имён.
- Методы с symbol-ключами.

## Расхождения с историческими заметками

| Заметка                                                 | Утверждение                                                                                                   | Фактически                                                                                                                                                                                                                           | Evidence                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/core/readme.md` (прежний, 5 строк, HEAD)      | `aom` = `abstract-oriented models`; «Core decoration fabric mechanism» — всё содержание                       | Пакет не описан; расшифровка расходится с `packages/core/src/readme.md` (`API over Maps`); файл перезаписан настоящим документом                                                                                                  | `packages/core/src/readme.md`                                                                                                                                                                                                                                                                                                                                             |
| `packages/core/src/readme.md`                           | `target` + `property` хранятся «синглтоном в мета-свойствах» (Reflect metadata)                               | Хранение — в `WeakMap` на статическом Symbol-свойстве мета-класса; `reflect-metadata` в пакете не используется                                                                                                                       | `packages/core/src/defines/core.ts` (`AomCore.instancesMap`)                                                                                                                                                                                                                                                                                                                 |
| `packages/core/src/readme.md`                           | API вида `$.property.meta.handler.define(origin)`, `$.target.meta.endpoints`, `$.meta.usedMiddlewares`        | Таких полей нет; узел доступен как `$._` с `target`/`property`/`root`, а «мету» реализуют поля наследника                                                                                                                            | `packages/core/src/defines/node.ts` (`AomNode.target`, `AomNode.property`, `AomNode.root`), `packages/core/src/defines/node.ts` (`AomCore._`)                                                                                                                                                                                                                                |
| `packages/core/src/readme.md`                           | Независимо от статического или собственного свойства `target` равен самому классу                             | `_.target` действительно всегда конструктор, но `instance()` вызывается с классом для статики и с прототипом для полей инстанса; различие хранит `_.originInstance` и восстанавливает сравнение `origin.target === $origin._.target` | `packages/core/src/defines/node.ts` (`AomNode.target`, `AomNode.originInstance`, `AomNode.inherit`)                                                                                                                                                                                                                                                                          |
| `../../readme.md`                                          | Ядро работает для класса и статических методов, декораторы методов инстанса и свойств «ещё бы запихнуть»      | Уже реализовано: `propertyDecorator`, карты `properties`/`statics`, перенос прототипных методов                                                                                                                                      | `packages/core/src/defines/core.ts` (`AomCore.propertyDecorator`), `packages/core/src/defines/node.ts` (`AomNode.properties`, `AomNode.statics`); `packages/core/test/inherit.test.ts` («собственный прототипный метод потомка не затирается переносом», «перенос декораторов свойств инстанса: у потомка появляется собственный мета-инстанс свойства»)                     |
| `../../readme.md`                                          | Для не-функциональных свойств нужен «двойной `map.set`/`map.get`» с собственным ключом                        | Реализовано именно так: синтетический инстанс в `properties`/`statics` сам является ключом WeakMap                                                                                                                                   | `packages/core/src/defines/core.ts` (`AomCore.instanceKey`)                                                                                                                                                                                                                                                                                                                  |
| `docs/correct-extends.md`                               | Родительские декораторы всегда переносятся в конец очереди потомка, нужен рефакторинг порядка                 | Добавлен `InheritPlacement`: `PREPEND` переносит блоком в начало (для отложенных фаз), `SKIP` исключает перенос                                                                                                                      | `packages/core/src/defines/callstack.ts` (`AomCallstackQueue.transferTo`); `packages/core/test/inherit.test.ts` («PREPEND: родительские LAST-вызовы встают единым блоком перед собственными вызовами потомка», «PREPEND у нескольких уровней: блок прародителя встаёт раньше блока родителя», «SKIP: вызов не переносится на потомка, APPEND-соседи переносятся как раньше») |
| `docs/lazy-evaluations.md`                              | Наиболее корректный запуск lazy-декораторов — `setTimer` после всех наследований                              | Основной отложенный режим — `LAST`, выполняемый синхронно в `_.apply()`; `setTimeout` остался только у `DELAY`                                                                                                                       | `packages/core/src/defines/callstack.ts` (`AomCallstackQueue`, `AomCallstackQueue.run`)                                                                                                                                                                                                                                                                                      |
| `docs/lazy-evaluations.md`                              | Замену контекста на потомка (`cursor.constructor = origin.constructor`) «имеет смысл повторить», место неясно | Реализовано как `AomCore.resolveFor`; вызывается в `AomCursor` и в `@Before`/`@After`/`@UseMarker`/`@Next`                                                                                                                           | `packages/core/src/defines/core.ts` (`AomCore.resolveFor`); `packages/router/src/common/cursor.ts` (`AomCursor`)                                                                                                                                                                                                                                                             |
| `docs/core.md`                                          | В конфигурацию запуска ядра передаётся «внешний» веб-фреймворк                                                | В core нет ничего про HTTP и фреймворки; это уровень router и api                                                                                                                                                                    | `packages/core/src/index.ts`; `packages/core/package.json` (`dependencies: {}`)                                                                                                                                                                                                                                                                                              |

## Открытые вопросы

Закрыт: нужен ли `try/catch`/Promise-обёртка вокруг `DELAY` — решение автора: оставить фазу как есть, `DELAY` остаётся особенностью с описанным риском (роняет процесс), а не дефектом для исправления.

> ❓ Открытый вопрос: `resolveFor` помещён в общий `AomCore`, хотя единственный потребитель — router. Оставлять в ядре или перенести в `AomApi`?

> ❓ Открытый вопрос: при переходе на stage-3 декораторы — как сохранить ключ реестра по `descriptor.value` и синтетические инстансы полей, если дескрипторы в новой модели недоступны?

Закрыт: каррирование с `this = null` было временным решением, не осознанным ограничением — исправлено, `this` теперь пробрасывается вызывающей стороне.

> ❓ Открытый вопрос: наследование мета-классов (`Meta2 extends Meta`) — ожидается общий реестр или отдельный? Сейчас он отдельный, если имена различаются, и общий, если `name` совпадает.
