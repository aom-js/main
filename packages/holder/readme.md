# `@aom-js/holder`

Пакет-черновик (версия `0.0.1`): три декоратора `Hold` / `Delay` / `Apply`, которые откладывают применение сторонних декораторов на предках и применяют их на конечном потомке. Приложением не используется.
Читать до: `packages/core/readme.md` (фазы исполнения, узел, `inherit`/`apply`). Читать после: `docs/architecture.md` §«Состав…» (место пакета в графе). Термины — `test/docs/README.md#словарь`.

## Назначение и место в стеке

Пакет решает одну задачу: набор декораторов, объявленных на базовом классе, не должен выполняться на этом базовом классе, а должен выполниться на его конечном потомке. Мотивация автора (`docs/holder.md`, вступление) — конфликт `@aom-js/schemer` и MikroORM: оба переносят декорированные свойства на потомков собственными механизмами, и базовый класс, объявленный обычными декораторами, уже становится сущностью/компонентом. `Hold` копит декораторы свойства в очереди мета-инстанса, `Apply` на потомке эту очередь исполняет через `Reflect.decorate`.

Зависимости — только `@aom-js/core` (мета-класс, фабрики декораторов, наследование метаданных) и `reflect-metadata` (`packages/holder/package.src.json`). Обратных зависимостей нет: ни один пакет ядра `@aom-js/holder` не импортирует; полный граф — в `docs/architecture.md`.

Потребителей у пакета нет. Приложение его не использует: симлинк `test/node_modules/@aom-js/holder` существует, но импортов в `test/src` нет и в `dependencies` приложения пакет не объявлен (см. §«Как использует приложение»).

Пакет вводит один собственный термин: **очередь холдера** — поле `queue` мета-инстанса `AomHolder`, в которое складываются ещё не применённые декораторы (`packages/holder/src/init.ts`, `AomHolder.queue`).

## Публичный API

| Экспорт     | Сигнатура                                                        | Назначение                                                                                                              | Используется приложением |
| ----------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| `Hold`      | `Hold(...queue: PropertyDecorator[]): PropertyDecorator`         | Кладёт декораторы свойства в очередь холдера в фазе LAST, не применяя их на текущем классе                              | нет                      |
| `Delay`     | `Delay(...queue: ClassDecorator[]): ClassDecorator`              | Фаза INSTANT: кладёт классовые декораторы в очередь холдера класса, выполняет `$._.inherit(родитель)` и `$._.apply()`   | нет                      |
| `Apply`     | `Apply(...queue: ClassDecorator[]): ClassDecorator`              | Фаза INSTANT: `Delay(...)` + применение накопленных очередей к свойствам класса и собственной очереди — к самому классу | нет                      |
| `AomHolder` | `class AomHolder extends AomCore { queue: CombinedDecorator[] }` | Мета-класс пакета (свой реестр инстансов). **Не экспортируется** из `index.ts`                                          | нет                      |

`packages/holder/src/index.ts` реэкспортирует только `./decorators`; `AomHolder` доступен исключительно внутри пакета. Побочный импорт `reflect-metadata` — там же (`import "reflect-metadata"` перед реэкспортом).

## Внутренние модули

| Файл                                  | Ответственность                                                  | Ключевые символы         |
| ------------------------------------- | ---------------------------------------------------------------- | ------------------------ |
| `packages/holder/src/index.ts`        | Точка входа: `import "reflect-metadata"` и реэкспорт декораторов | —                        |
| `packages/holder/src/init.ts`         | Мета-класс пакета с единственным прикладным полем `queue`        | `AomHolder`, `queue`     |
| `packages/holder/src/decorators.ts`   | Три декоратора и приведения типов на границе очереди             | `Hold`, `Delay`, `Apply` |
| `packages/holder/test/holder.test.ts` | 5 характеризационных тестов (vitest), `it.fails` нет             | —                        |
| `packages/holder/package.src.json`    | Источник для генерации `package.json` (`scripts/prebuild.js`)    | —                        |

## Ключевые механизмы

Все три декоратора построены фабриками `AomCore` (`packages/core/src/defines/core.ts`, `classDecorator` — для `Delay`/`Apply`, `propertyDecorator` — для `Hold`) поверх собственного мета-класса, поэтому у холдера свой реестр инстансов, независимый от `AomApi`/`AomSchemas`. Механику фаз, узла и наследования метаданных здесь не пересказываем — см. `packages/core/readme.md` §«Ключевые механизмы».

### Hold: отложить декораторы свойства (LAST)

`Hold` — property-декоратор фазы LAST. Его обработчик не применяет переданные декораторы, а лишь дописывает их в очередь мета-инстанса свойства:

`packages/holder/src/decorators.ts` (`Hold`)

```ts
export function Hold(...queue: PropertyDecorator[]): PropertyDecorator {
  return AomHolder.propertyDecorator(($) => {
    $.queue.push(...(queue as unknown as CombinedDecorator[]));
    //
  }, ExecutionPhase.LAST);
}
```

LAST — отложенная фаза: вызов ложится в очередь узла и не исполняется, пока кто-то не вызовет `apply()` (`packages/core/src/defines/callstack.ts`, `AomCallstackQueue.add`, `AomCallstackQueue.exec`). На самом базовом классе `apply()` никто не вызывает, поэтому очередь свойства остаётся пустой, а декораторы — неприменёнными. При наследовании отложенный вызов переносится на мета-инстанс одноимённого свойства потомка (`packages/core/src/defines/callstack.ts`, `AomCallstack.transferTo`, `AomCallstackQueue.transferTo`; `packages/core/src/defines/node.ts`, `AomNode.inherit`), и уже там наполняет `queue` потомка.

Evidence: `packages/holder/src/decorators.ts` (`Hold`); `packages/core/src/defines/callstack.ts` (`AomCallstackQueue`, `AomCallstackQueue.add`), `packages/core/src/defines/node.ts` (`AomNode.inherit`).

### Delay: перенос очереди и callstack родителя + apply (INSTANT)

`Delay` — классовый декоратор фазы INSTANT. Он делает три вещи: кладёт свои классовые декораторы в очередь холдера этого класса, переносит `$.queue` прямого родителя (если ещё не переносил), наследует метаданные прямого родителя и разбирает отложенные очереди.

`packages/holder/src/decorators.ts` (`Delay`)

```ts
// защита от повторного переноса очереди родителя в один и тот же $.queue: Apply сам
// вызывает Delay, и на одном target Delay может отработать больше одного раза
const queueInherited = new WeakSet<AomHolder>();

export function Delay(...queue: ClassDecorator[]): ClassDecorator {
  return AomHolder.classDecorator(($) => {
    $.queue.push(...queue);

    const parent = Object.getPrototypeOf($._.target);
    if (!queueInherited.has($)) {
      queueInherited.add($);
      // $.queue — не часть callstack AOM, inherit() её не переносит, переносим её сами
      $.queue.unshift(...(AomHolder.checkExists(parent)?.queue ?? []));
    }

    // перенесем декораторы со свойствами из родителя
    $._.inherit(parent);

    $._.apply(); // применим перенесенные декораторы
  }, ExecutionPhase.INSTANT);
}
```

`$._.inherit(parent)` переносит на потомка callstack родителя и его декорированные свойства (это `Hold`-очереди свойств, они идут через LAST-фазу ядра); `$._.apply()` прогоняет LAST-очереди свойств, статик и origins узла (`packages/core/src/defines/node.ts`, `AomNode.apply`). Именно этот `apply()` наполняет `queue` свойств потомка вызовами, положенными туда `Hold` на родителе.

`$.queue` (очередь **классовых** декораторов самого `AomHolder`-инстанса) — не часть callstack AOM и `inherit()` её не трогает; раньше она нигде не переносилась, и `@Delay` на родителе терял свои классовые декораторы при наследовании (`KI-HOLDER-01`, закрыт). Исправление переносит её вручную через `unshift` перед `inherit()`, чтобы порядок был «сначала унаследованное, потом собственное». `WeakSet queueInherited` защищает от повторного переноса: `Apply` сам вызывает `Delay` через `Reflect.decorate` (см. §«Apply…» ниже), и на одном `$` `Delay` может отработать больше одного раза.

Сам `Delay` при этом ничего не декорирует непосредственно на классе: `Reflect.decorate` по собственной очереди `$.queue` вызывается только внутри `Apply`. Класс, помеченный только `@Delay(X())` без последующего `@Apply()` в иерархии, декоратор `X()` на себя не получает.

Тесты: `packages/holder/test/holder.test.ts` («Delay на родителе + Apply на потомке переносит класс-декораторы родителя» — двухуровневый перенос: `@Delay` на родителе + `@Apply` на потомке, «трёхуровневая цепочка Delay/Delay/Apply переносит очередь прародителя и родителя» — очередь переносится через оба уровня без дублирования).

Evidence: `packages/holder/src/decorators.ts` (`Delay`); `packages/core/src/defines/node.ts` (`AomNode.apply`, `AomNode.inherit`).

### Apply: применить накопленное на потомке

`Apply` — классовый декоратор фазы INSTANT. Он вызывает `Delay` через `Reflect.decorate`, затем обходит `origins` узла и применяет очередь каждого свойства, и в конце применяет собственную очередь к классу.

`packages/holder/src/decorators.ts` (`Apply`)

```ts
export function Apply(...queue: ClassDecorator[]): ClassDecorator {
  return AomHolder.classDecorator(($) => {
    // применим стандартную процедуру delay для переноса всех свойств
    // console.log("apply delayed decorators", $._.target);
    Reflect.decorate([Delay(...queue)], $._.target);
    // console.log("parent transfered", $._.target);

    // и выполним запуск тех декораторов, которые были перенесены
    $._.origins.forEach((origin) => {
      const $origin = origin.self; // $._.base.instance(origin.descriptor.value);
      const isClassOrigin = origin.target === $origin._.target;

      // применим декораторы из очереди на те свойства, которые были созданы
      Reflect.decorate(
        origin.self.queue as unknown as PropertyDecorator[],
        isClassOrigin ? $._.target : $._.target.prototype,
        origin.property,
      );
    });
    // применим собственные декораторы класса из его очереди
    Reflect.decorate($.queue, $._.target);
    //
  }, ExecutionPhase.INSTANT);
}
```

`origins` — список декорированных свойств, накопленный узлом класса при создании мета-инстансов свойств (`packages/core/src/defines/node.ts`, `AomNode.origins`); после `inherit` он содержит и свойства, перенесённые с родителя. Флаг `isClassOrigin` различает статику (декоратор применяется к конструктору) и свойство инстанса (к прототипу). Последняя строка применяет к классу те классовые декораторы, что были переданы в `Apply` (и попали в `$.queue` через `Delay`, включая перенесённые от родителя).

Рабочий сценарий целиком (`packages/holder/test/holder.test.ts`, «Hold на свойстве родителя + Apply на потомке применяет декоратор к потомку»): `@Hold(Spy("a"))` на поле `HeldBase.field`, `@Apply()` на `HeldChild extends HeldBase` — и `Spy` вызывается ровно один раз, с целью `HeldChild.field`.

Evidence: `packages/holder/src/decorators.ts` (`Apply`); `packages/core/src/defines/node.ts` (`AomNode.origins`, `AomNode.apply`).

## Инварианты и подводные камни

- Проверенные сценарии — `Hold` на свойствах предка + `Apply` на потомке (один уровень) и `Delay`/`Delay`/`Apply` (два уровня наследования класс-декораторов, `KI-HOLDER-01` закрыт). Остальные комбинации либо не работают (см. §«Дефекты без ID»), либо не покрыты тестами.
- `Delay` на классе не применяет к нему свои классовые декораторы: их исполняет только `Reflect.decorate($.queue, $._.target)` в `Apply` (`packages/holder/src/decorators.ts`). `@Delay(X())` без последующего `@Apply()` в иерархии — no-op в части `X()`.
- `Apply`/`Delay` наследуют ровно от прямого родителя: `Object.getPrototypeOf($._.target)` внутри `Delay` (`packages/holder/src/decorators.ts`). Транзитивность класс-декораторов (`$.queue`) теперь работает через цепочку, если каждый промежуточный класс сам помечен `@Delay` или `@Apply` — каждый уровень переносит `$.queue` своего прямого родителя (закрытие `KI-HOLDER-01`). Транзитивность декораторов **свойств** (`Hold`) идёт другим механизмом — через `callstack`/`inherit`, и по-прежнему работает лишь на один уровень за раз: если между предком с `@Hold` и потомком с `@Apply` есть обычный класс без декораторов холдера, очередь свойства теряется молча — ни ошибки, ни применения декораторов (см. §«Дефекты без ID», отдельная от `KI-HOLDER-01` проблема).
- От класса, помеченного `@Apply`, наследовать `@Apply` повторно небезопасно: `transferTo` переносит на потомка и выполненные, и ожидающие вызовы, не очищая источник (`packages/core/src/defines/callstack.ts`, `AomCallstack.transferTo`, `AomCallstackQueue.transferTo`), поэтому `@Apply` на внуке повторно исполнит те же `Hold`-очереди. `KI-CORE-07` (закрыт) защищает только повторный `inherit(того же parent)` на одном и том же узле — не эту многоуровневую цепочку. Черновик `docs/holder.md` (абзац после примера `Contractors`) предписывает вместо этого заводить буферный класс с «подвешенными» декораторами.
- Порядок нескольких декораторов внутри одного `Hold` тестом не зафиксирован (проверка через `arrayContaining`, `packages/holder/test/holder.test.ts`, «несколько Hold-декораторов применяются в сохраненном порядке»), полагаться на него нельзя.
- Правки `src` не видны приложению без `bun run build` — см. §«Сборка и потребление».

### Известные дефекты

> ✅ Закрыт (`KI-HOLDER-01`): класс-декораторы, переданные в `@Delay` на родителе, не переносились на потомка при `@Apply` — очередь родителя оставалась неисполненной.
> Было: `Delay` клал классовые декораторы в `$.queue` и вызывал `$._.inherit(parent)`/`$._.apply()`, но `$.queue` родителя никуда не переносился — `inherit()` переносит только `callstack`, а `$.queue` было собственным полем `AomHolder`-инстанса, вне этого механизма. Фаза `INSTANT`, в которой объявлены `@Delay`/`@Apply`, здесь ни при чём и работает как задумано — она не дефект, а особенность (`KI-CORE-04`): без неё сами `@Delay`/`@Apply` ушли бы в рекурсию при переносе.
> Стало: перед `inherit()` `Delay` переносит `$.queue` прямого родителя через `unshift` (`packages/holder/src/decorators.ts`); `WeakSet queueInherited` (`queueInherited`) защищает от повторного переноса, когда `Delay` вызван из `Apply`.
> Тесты: `packages/holder/test/holder.test.ts` («Delay на родителе + Apply на потомке переносит класс-декораторы родителя» — двухуровневый перенос, раньше был `it.fails`, «трёхуровневая цепочка Delay/Delay/Apply переносит очередь прародителя и родителя»).
> Осталось не покрыто: наследование декораторов **свойств** (`Hold`) через недекорированный промежуточный класс — отдельная, всё ещё живая проблема, см. §«Дефекты без ID».

### Легаси и мёртвый код

> ✅ Закрыт (часть `KI-HOLDER-02`): в `Delay` был объявлен массив `errors`, в который никто не писал и не читал; обёртка `inheritDecorators` вызывалась один раз и не добавляла ничего к `$._.inherit(parent)`. Оба убраны из кода — `Delay` теперь вызывает `$._.inherit(parent)` напрямую (`packages/holder/src/decorators.ts`).

> 🧱 Легаси: `readme.md` пакета до перезаписи содержал заголовок `` `@aom-js/mixer` `` — «Class decorators mixer», имя `mixer` в коде отсутствует.
> Где лежит: HEAD-версия `packages/holder/readme.md` (заменена этим документом).
> Почему не используется: пакет называется `@aom-js/holder` (`packages/holder/package.src.json` (`name`)), мета-класс — `AomHolder` (`packages/holder/src/init.ts`).
> Чем заменён: настоящим документом; см. §«Расхождения с историческими заметками» и `KI-HOLDER-02`.

> 🧱 Легаси: типы на границе очереди не сходятся — `Hold` принимает `PropertyDecorator[]`, а `queue` объявлена как `CombinedDecorator[]`, поэтому в обе стороны стоят приведения через `unknown`.
> Где лежит: `packages/holder/src/decorators.ts` (`Hold`, `Apply`).
> Почему не используется иначе: у `CombinedDecorator` `propertyKey` необязателен, у `PropertyDecorator` — обязателен; единого типа для очереди нет.
> Чем заменён: ничем, приведения оставлены намеренно. См. `KI-HOLDER-02` в `test/docs/known-issues.md`.

## Как использует приложение

Не использует. Симлинк `test/node_modules/@aom-js/holder → ../../../main/packages/holder` создан вместе с остальными пакетами ядра, но `@aom-js/holder` не значится в `dependencies` приложения и не импортируется ни в одном файле `test/src` (grep по `@aom-js/holder` пуст; встречающийся в приложении `@DelayRefStack` — декоратор `@aom-js/router`, к холдеру отношения не имеет).

Сценарий, ради которого пакет писался, в приложении реализован без него: базовые сущности объявлены обычными декораторами — `@ComponentSchema` на классе и пара `@PropertySchema.* + @Property/@PrimaryKey` на каждом поле (`test/src/common/schemas/postgres/base.ts`, `DefaultEntity`, `EnabledEntity`). `DefaultEntity` и `EnabledEntity` при этом сами по себе компонент-схемы и в БД не создаются, потому что не помечены `@Entity()`. Класса `Contractors` из черновика `docs/holder.md` в приложении нет. Правило двойного декорирования — `test/docs/principles.md` §«Двойное декорирование…»; каталог сущностей — `test/docs/data-model.md`.

## Сборка и потребление

Сборка стандартна для монорепо: `bun run build:holder` (или `bun --filter @aom-js/holder build`) прогоняет `tsc` трижды — `tsconfig.build.json` (cjs), `tsconfig.build.mjs.json` (mjs), `tsconfig.build.types.json` (типы) — и запускает `scripts/post-build.js`; `package.json` собирает `scripts/prebuild.js` слиянием `package.version.json` + `package.src.json` + `scripts/jsons/package.dist.json` (`scripts/prebuild.js`, `scripts/files.js`), а `tsconfig.build*.json` он просто копирует из `scripts/jsons/` (`scripts/prebuild.js`, `scripts/files.js`) — поэтому зависимости правятся в `package.src.json`, а опции компиляции — в `scripts/jsons/tsconfig.build*.json`. Приложение читает `dist` через симлинк и поле `exports`, так что правки `src` не видны приложению без пересборки. Полная схема — `docs/architecture.md` §«Сборка, тесты…» и §«Как приложение потребляет ядро».

## Тесты

### Что покрыто

`packages/holder/test/holder.test.ts` — характеризационные тесты на синтетических декораторах-шпионах:

| Тест                                              | Что фиксирует                                                                                    | Строки                                                                                                     |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `Hold` на свойстве родителя + `Apply` на потомке  | декоратор применяется один раз, к свойству потомка                                               | `test/holder.test.ts` («Hold на свойстве родителя + Apply на потомке применяет декоратор к потомку»)       |
| `Apply` применяет переданные ему класс-декораторы | собственная очередь `$.queue` исполняется на самом классе                                        | `test/holder.test.ts` («Apply применяет переданные ему декораторы класса к самому классу»)                 |
| `Delay` на родителе + `Apply` на потомке          | класс-декораторы родителя переносятся на потомка (`KI-HOLDER-01`, закрыт; раньше был `it.fails`) | `test/holder.test.ts` («Delay на родителе + Apply на потомке переносит класс-декораторы родителя»)         |
| трёхуровневая цепочка `Delay`/`Delay`/`Apply`     | очередь прародителя и родителя переносится без дублирования                                      | `test/holder.test.ts` («трёхуровневая цепочка Delay/Delay/Apply переносит очередь прародителя и родителя») |
| несколько `Hold`-декораторов                      | оба применяются (порядок не проверяется)                                                         | `test/holder.test.ts` («несколько Hold-декораторов применяются в сохраненном порядке»)                     |

### Expected-fail

`it.fails`-тестов в пакете больше нет. До исправления тест `test/holder.test.ts` («Delay на родителе + Apply на потомке переносит класс-декораторы родителя») был помечен `it.fails` и соответствовал `KI-HOLDER-01`. Дефект закрыт, тест переведён в обычный проходящий; политика характеризационных тестов — `test/docs/testing.md`.

### Пробелы

- `@Delay` на классе без последующего `@Apply` (декораторы класса не применяются) — не проверено.
- `Hold` на статических свойствах и методах — ветка `isClassOrigin` (`packages/holder/src/decorators.ts`, `Apply`) не покрыта.
- Повторное наследование от `@Apply`-класса (`Grand extends Child`, где `Child` уже разобран `@Apply`) — поведение не зафиксировано тестом, см. §«Инварианты и подводные камни».
- Цепочка с недекорированным промежуточным классом (`Hold` на прадеде, обычный класс посередине, `@Apply` на потомке) — не проверена; фактически очередь свойства теряется, см. §«Дефекты без ID» (не путать с `KI-HOLDER-01`: это перенос `Hold`-очереди **свойств**, а не `$.queue` класс-декораторов, который уже исправлен и покрыт трёхуровневым тестом).
- Совместимость с реальными сторонними декораторами (`PropertySchema.*`, MikroORM `@Property`/`@Entity`) — ради чего пакет и писался — не проверяется вовсе.
- Взаимный порядок нескольких `Hold`: `arrayContaining` его не фиксирует.
- `dist` тестами не грузится; собранный пакет проверяет только `scripts/smoke.js` на этапе `bun run build`.

### Как запускать

```bash
cd main
bun run test -- packages/holder
```

Число тестов печатает сам прогон; `it.fails` в пакете нет. Алиас `@aom-js/holder` в vitest указывает на `packages/holder/src` (`vitest.config.ts`), то есть тесты идут по исходникам, минуя `dist`.

## Дефекты без ID

> ⚠️ Дефект: очередь `Hold` (декораторы **свойств**) теряется молча, если между предком с `@Hold` и потомком с `@Apply` стоит промежуточный класс без декораторов холдера. Это отдельная проблема от `KI-HOLDER-01` (там речь о `$.queue` класс-декораторов, уже исправлено) — здесь перенос идёт через `callstack`/`inherit()`, который затрагивает только прямого родителя.
> Evidence: `packages/holder/src/decorators.ts` (`Delay`) (`Delay` наследует только от `Object.getPrototypeOf($._.target)`), `packages/core/src/defines/node.ts` (`AomNode.inherit`) (`inherit` переносит callstack ровно одного родителя), `packages/core/src/defines/core.ts` (`AomCore.instance`) (`instance()` создаёт мета-инстанс по конструктору, без обхода цепочки прототипов — у недекорированного класса callstack и `origins` пусты).
> Последствия: `Base` с `@Hold(...)` → обычный `Mid extends Base` → `@Apply() class Leaf extends Mid` не применяет ни одного отложенного декоратора; ошибки при этом нет, расхождение обнаруживается только по отсутствующей схеме/колонке.
> Как обходить: помечать `@Delay()` каждый промежуточный класс цепочки либо наследовать конечный потомок напрямую от класса с `@Hold`. В реестре `test/docs/known-issues.md` ID под этот случай нет.

## Расхождения с историческими заметками

| Заметка                                                         | Утверждение                                                                           | Фактически                                                                                                                                                                                                                                                                                           | Evidence                                                                                                                                            |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/holder/readme.md` (HEAD, заменён этим документом) | Пакет называется `@aom-js/mixer`, «Class decorators mixer»                            | Имя пакета — `@aom-js/holder`, мета-класс — `AomHolder`; сущности `mixer` в коде нет                                                                                                                                                                                                                 | `packages/holder/package.src.json` (`name`); `packages/holder/src/init.ts` (`AomHolder`)                                                                   |
| `docs/holder.md`                                                | Очередь — свойство класса `AomMixer`, перенос очереди происходит при наследовании     | Класс называется `AomHolder` (не `AomMixer`); декораторы **свойств** переносятся через callstack узла (`AomNode.inherit`), очередь потомка наполняется исполнением перенесённых LAST-вызовов; **классовые** декораторы (`$.queue`) переносятся отдельно, вручную, в `Delay` (`KI-HOLDER-01`, закрыт) | `packages/holder/src/init.ts` (`AomHolder`); `packages/holder/src/decorators.ts` (`Delay`); `packages/core/src/defines/node.ts` (`AomNode.inherit`) |
| `docs/holder.md`                                                | Пример конечной сущности `Contractors` через `@Apply(ComponentSchema(...), Entity())` | Класса `Contractors` в приложении нет; базовые сущности объявлены прямыми декораторами без холдера                                                                                                                                                                                                   | `test/src/common/schemas/postgres/base.ts` (`DefaultEntity`)                                                                                        |

## Открытые вопросы

Закрыт: перенос `@Delay` починен (`KI-HOLDER-01`) — выбранное решение переносит `$.queue` вручную в самом `Delay` перед `inherit()`, не через фазу LAST ядра.

> ❓ Открытый вопрос: что должно происходить при наследовании от класса, помеченного `@Apply`, — ошибка сборки или идемпотентное поведение? Сейчас механика `transferTo` (`packages/core/src/defines/callstack.ts`, `AomCallstack.transferTo`, `AomCallstackQueue.transferTo`) ведёт к повторному применению, но тестом это не зафиксировано.

> ❓ Открытый вопрос: планируется ли использование холдера в приложении? Черновик `docs/holder.md` описывает именно его базовые сущности, но в `test/src` они собраны прямыми декораторами.
