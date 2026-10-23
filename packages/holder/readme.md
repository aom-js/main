# `@aom-js/holder`

Пакет-черновик: три декоратора `Hold` / `Delay` / `Apply`, которые откладывают применение сторонних декораторов на предках и применяют их на конечном потомке.
Читать до: `packages/core/readme.md` (фазы исполнения, узел, `inherit`/`apply`). Читать после: `docs/architecture.md` §«Состав…» (место пакета в графе).

## Назначение и место в стеке

Пакет решает одну задачу: набор декораторов, объявленных на базовом классе, не должен выполняться на этом базовом классе, а должен выполниться на его конечном потомке. Мотивация автора (`docs/holder.md`, вступление) — конфликт `@aom-js/schemer` и MikroORM: оба переносят декорированные свойства на потомков собственными механизмами, и базовый класс, объявленный обычными декораторами, уже становится сущностью/компонентом. `Hold` копит декораторы свойства в очереди мета-инстанса, `Apply` на потомке эту очередь исполняет через `Reflect.decorate`.

Зависимости — только `@aom-js/core` (мета-класс, фабрики декораторов, наследование метаданных) и `reflect-metadata` (`packages/holder/package.src.json`). Обратных зависимостей нет: ни один пакет ядра `@aom-js/holder` не импортирует; полный граф — в `docs/architecture.md`.

Пакет вводит один собственный термин: **очередь холдера** — поле `queue` мета-инстанса `AomHolder`, в которое складываются ещё не применённые декораторы (`packages/holder/src/init.ts`, `AomHolder.queue`).

## Публичный API

| Экспорт     | Сигнатура                                                        | Назначение                                                                                                              |
| ----------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `Hold`      | `Hold(...queue: PropertyDecorator[]): PropertyDecorator`         | Кладёт декораторы свойства в очередь холдера в фазе LAST, не применяя их на текущем классе                              |
| `Delay`     | `Delay(...queue: ClassDecorator[]): ClassDecorator`              | Фаза INSTANT: кладёт классовые декораторы в очередь холдера класса, выполняет `$._.inherit(родитель)` и `$._.apply()`   |
| `Apply`     | `Apply(...queue: ClassDecorator[]): ClassDecorator`              | Фаза INSTANT: `Delay(...)` + применение накопленных очередей к свойствам класса и собственной очереди — к самому классу |
| `AomHolder` | `class AomHolder extends AomCore { queue: CombinedDecorator[] }` | Мета-класс пакета (свой реестр инстансов). **Не экспортируется** из `index.ts`                                          |

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

`$.queue` (очередь **классовых** декораторов самого `AomHolder`-инстанса) — не часть callstack AOM и `inherit()` её не трогает, поэтому `Delay` переносит её вручную через `unshift` перед `inherit()`, чтобы порядок был «сначала унаследованное, потом собственное». `WeakSet queueInherited` защищает от повторного переноса: `Apply` сам вызывает `Delay` через `Reflect.decorate` (см. §«Apply…» ниже), и на одном `$` `Delay` может отработать больше одного раза.

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

- Проверенные сценарии — `Hold` на свойствах предка + `Apply` на потомке (один уровень) и `Delay`/`Delay`/`Apply` (два уровня наследования класс-декораторов). Остальные комбинации либо не работают (см. §«Известные дефекты»), либо не покрыты тестами.
- `Delay` на классе не применяет к нему свои классовые декораторы: их исполняет только `Reflect.decorate($.queue, $._.target)` в `Apply` (`packages/holder/src/decorators.ts`). `@Delay(X())` без последующего `@Apply()` в иерархии — no-op в части `X()`.
- `Apply`/`Delay` наследуют ровно от прямого родителя: `Object.getPrototypeOf($._.target)` внутри `Delay` (`packages/holder/src/decorators.ts`). Транзитивность класс-декораторов (`$.queue`) работает через цепочку, если каждый промежуточный класс сам помечен `@Delay` или `@Apply` — каждый уровень переносит `$.queue` своего прямого родителя. Транзитивность декораторов **свойств** (`Hold`) идёт другим механизмом — через `callstack`/`inherit`, и по-прежнему работает лишь на один уровень за раз: если между предком с `@Hold` и потомком с `@Apply` есть обычный класс без декораторов холдера, очередь свойства теряется молча — ни ошибки, ни применения декораторов (см. §«Известные дефекты»).
- От класса, помеченного `@Apply`, наследовать `@Apply` повторно небезопасно: `transferTo` переносит на потомка и выполненные, и ожидающие вызовы, не очищая источник (`packages/core/src/defines/callstack.ts`, `AomCallstack.transferTo`, `AomCallstackQueue.transferTo`), поэтому `@Apply` на внуке повторно исполнит те же `Hold`-очереди. Ядро защищает только от повторного `inherit(того же parent)` на одном и том же узле — не от этой многоуровневой цепочки. Черновик `docs/holder.md` (абзац после примера `Contractors`) предписывает вместо этого заводить буферный класс с «подвешенными» декораторами.
- Порядок нескольких декораторов внутри одного `Hold` тестом не зафиксирован (проверка через `arrayContaining`, `packages/holder/test/holder.test.ts`, «несколько Hold-декораторов применяются в сохраненном порядке»), полагаться на него нельзя.
- Потребитель исполняет собранный `dist`, поэтому после правки `src` нужен `bun run build` — см. §«Сборка и потребление».

### Известные дефекты

Открытых дефектов, кроме описанного в §«Известные дефекты», нет. Фаза `INSTANT`, в которой объявлены `@Delay`/`@Apply`, — особенность, а не дефект: без неё сами `@Delay`/`@Apply` ушли бы в рекурсию при переносе.

### Легаси и мёртвый код

> 🧱 Легаси: `readme.md` пакета до перезаписи содержал заголовок `` `@aom-js/mixer` `` — «Class decorators mixer», имя `mixer` в коде отсутствует.
> Где лежит: HEAD-версия `packages/holder/readme.md` (заменена этим документом).
> Почему не используется: пакет называется `@aom-js/holder` (`packages/holder/package.src.json` (`name`)), мета-класс — `AomHolder` (`packages/holder/src/init.ts`).
> Чем заменён: настоящим документом; см. §«Расхождения с историческими заметками».

> 🧱 Легаси: типы на границе очереди не сходятся — `Hold` принимает `PropertyDecorator[]`, а `queue` объявлена как `CombinedDecorator[]`, поэтому в обе стороны стоят приведения через `unknown`.
> Где лежит: `packages/holder/src/decorators.ts` (`Hold`, `Apply`).
> Почему не используется иначе: у `CombinedDecorator` `propertyKey` необязателен, у `PropertyDecorator` — обязателен; единого типа для очереди нет.
> Чем заменён: ничем, приведения оставлены намеренно.

## Сборка и потребление

Сборка стандартна для монорепо: `bun run build:holder` (или `bun --filter @aom-js/holder build`) прогоняет `tsc` трижды — `tsconfig.build.json` (cjs), `tsconfig.build.mjs.json` (mjs), `tsconfig.build.types.json` (типы) — и запускает `scripts/post-build.js`; `package.json` собирает `scripts/prebuild.js` слиянием общей версии из корневого `package.json`, `package.src.json` и `scripts/jsons/package.dist.json` (`scripts/prebuild.js`, `scripts/files.js`), а `tsconfig.build*.json` он просто копирует из `scripts/jsons/` (`scripts/prebuild.js`, `scripts/files.js`) — поэтому зависимости правятся в `package.src.json`, а опции компиляции — в `scripts/jsons/tsconfig.build*.json`. Потребитель читает `dist` через поле `exports`, так что правки `src` ему не видны без пересборки. Полная схема — `docs/architecture.md` §«Сборка, тесты…» и §«Как приложение потребляет ядро».

## Тесты

### Что покрыто

`packages/holder/test/holder.test.ts` — характеризационные тесты на синтетических декораторах-шпионах:

| Тест                                              | Что фиксирует                                                                                    | Строки                                                                                                     |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `Hold` на свойстве родителя + `Apply` на потомке  | декоратор применяется один раз, к свойству потомка                                               | `test/holder.test.ts` («Hold на свойстве родителя + Apply на потомке применяет декоратор к потомку»)       |
| `Apply` применяет переданные ему класс-декораторы | собственная очередь `$.queue` исполняется на самом классе                                        | `test/holder.test.ts` («Apply применяет переданные ему декораторы класса к самому классу»)                 |
| `Delay` на родителе + `Apply` на потомке          | класс-декораторы родителя переносятся на потомка | `test/holder.test.ts` («Delay на родителе + Apply на потомке переносит класс-декораторы родителя»)         |
| трёхуровневая цепочка `Delay`/`Delay`/`Apply`     | очередь прародителя и родителя переносится без дублирования                                      | `test/holder.test.ts` («трёхуровневая цепочка Delay/Delay/Apply переносит очередь прародителя и родителя») |
| несколько `Hold`-декораторов                      | оба применяются (порядок не проверяется)                                                         | `test/holder.test.ts` («несколько Hold-декораторов применяются в сохраненном порядке»)                     |

### Expected-fail

`it.fails`-тестов в пакете нет.

### Пробелы

- `@Delay` на классе без последующего `@Apply` (декораторы класса не применяются) — не проверено.
- `Hold` на статических свойствах и методах — ветка `isClassOrigin` (`packages/holder/src/decorators.ts`, `Apply`) не покрыта.
- Повторное наследование от `@Apply`-класса (`Grand extends Child`, где `Child` уже разобран `@Apply`) — поведение не зафиксировано тестом, см. §«Инварианты и подводные камни».
- Цепочка с недекорированным промежуточным классом (`Hold` на прадеде, обычный класс посередине, `@Apply` на потомке) — не проверена; фактически очередь свойства теряется, см. §«Известные дефекты» (это перенос `Hold`-очереди **свойств**, а не `$.queue` класс-декораторов: тот работает и покрыт трёхуровневым тестом).
- Совместимость с реальными сторонними декораторами (`PropertySchema.*`, MikroORM `@Property`/`@Entity`) — ради чего пакет и писался — не проверяется вовсе.
- Взаимный порядок нескольких `Hold`: `arrayContaining` его не фиксирует.
- `dist` тестами не грузится; собранный пакет проверяет только `scripts/smoke.js` на этапе `bun run build`.

### Как запускать

```bash
bun run test -- packages/holder
```

Число тестов печатает сам прогон; `it.fails` в пакете нет. Алиас `@aom-js/holder` в vitest указывает на `packages/holder/src` (`vitest.config.ts`), то есть тесты идут по исходникам, минуя `dist`.

## Известные дефекты

> ⚠️ Дефект: очередь `Hold` (декораторы **свойств**) теряется молча, если между предком с `@Hold` и потомком с `@Apply` стоит промежуточный класс без декораторов холдера. Это не перенос `$.queue` класс-декораторов (он работает) — здесь перенос идёт через `callstack`/`inherit()`, который затрагивает только прямого родителя.
> Evidence: `packages/holder/src/decorators.ts` (`Delay`) (`Delay` наследует только от `Object.getPrototypeOf($._.target)`), `packages/core/src/defines/node.ts` (`AomNode.inherit`) (`inherit` переносит callstack ровно одного родителя), `packages/core/src/defines/core.ts` (`AomCore.instance`) (`instance()` создаёт мета-инстанс по конструктору, без обхода цепочки прототипов — у недекорированного класса callstack и `origins` пусты).
> Последствия: `Base` с `@Hold(...)` → обычный `Mid extends Base` → `@Apply() class Leaf extends Mid` не применяет ни одного отложенного декоратора; ошибки при этом нет, расхождение обнаруживается только по отсутствующей схеме/колонке.
> Как обходить: помечать `@Delay()` каждый промежуточный класс цепочки либо наследовать конечный потомок напрямую от класса с `@Hold`.

## Расхождения с историческими заметками

| Заметка                                                         | Утверждение                                                                           | Фактически                                                                                                                                                                                                                                                                                           | Evidence                                                                                                                                            |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/holder/readme.md` (HEAD, заменён этим документом) | Пакет называется `@aom-js/mixer`, «Class decorators mixer»                            | Имя пакета — `@aom-js/holder`, мета-класс — `AomHolder`; сущности `mixer` в коде нет                                                                                                                                                                                                                 | `packages/holder/package.src.json` (`name`); `packages/holder/src/init.ts` (`AomHolder`)                                                                   |
| `docs/holder.md`                                                | Очередь — свойство класса `AomMixer`, перенос очереди происходит при наследовании     | Класс называется `AomHolder` (не `AomMixer`); декораторы **свойств** переносятся через callstack узла (`AomNode.inherit`), очередь потомка наполняется исполнением перенесённых LAST-вызовов; **классовые** декораторы (`$.queue`) переносятся отдельно, вручную, в `Delay` | `packages/holder/src/init.ts` (`AomHolder`); `packages/holder/src/decorators.ts` (`Delay`); `packages/core/src/defines/node.ts` (`AomNode.inherit`) |

## Открытые вопросы

> ❓ Открытый вопрос: что должно происходить при наследовании от класса, помеченного `@Apply`, — ошибка сборки или идемпотентное поведение? Сейчас механика `transferTo` (`packages/core/src/defines/callstack.ts`, `AomCallstack.transferTo`, `AomCallstackQueue.transferTo`) ведёт к повторному применению, но тестом это не зафиксировано.
