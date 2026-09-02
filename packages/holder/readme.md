# `@aom-js/holder`

Пакет-черновик (версия `0.0.1`): три декоратора `Hold` / `Delay` / `Apply`, которые откладывают применение сторонних декораторов на предках и применяют их на конечном потомке. Приложением не используется. Состояние на 2026-09-02.
Читать до: `packages/core/readme.md` (фазы исполнения, узел, `inherit`/`apply`). Читать после: `docs/architecture.md` §«Состав…» (место пакета в графе). Термины — `test/docs/README.md#словарь`.

## Назначение и место в стеке

Пакет решает одну задачу: набор декораторов, объявленных на базовом классе, не должен выполняться на этом базовом классе, а должен выполниться на его конечном потомке. Мотивация автора (`docs/holder.md:1-11`) — конфликт `@aom-js/schemer` и MikroORM: оба переносят декорированные свойства на потомков собственными механизмами, и базовый класс, объявленный обычными декораторами, уже становится сущностью/компонентом. `Hold` копит декораторы свойства в очереди мета-инстанса, `Apply` на потомке эту очередь исполняет через `Reflect.decorate`.

Зависимости — только `@aom-js/core` (мета-класс, фабрики декораторов, наследование метаданных) и `reflect-metadata` (`packages/holder/package.src.json:15-18`). Обратных зависимостей нет: ни один пакет ядра `@aom-js/holder` не импортирует; полный граф — в `docs/architecture.md`.

Потребителей у пакета нет. Приложение его не использует: симлинк `test/node_modules/@aom-js/holder` существует, но импортов в `test/src` нет и в `dependencies` приложения пакет не объявлен (см. §«Как использует приложение»).

Пакет вводит один собственный термин: **очередь холдера** — поле `queue` мета-инстанса `AomHolder`, в которое складываются ещё не применённые декораторы (`packages/holder/src/init.ts:3-5`).

## Публичный API

| Экспорт | Сигнатура | Назначение | Используется приложением |
|---|---|---|---|
| `Hold` | `Hold(...queue: PropertyDecorator[]): PropertyDecorator` | Кладёт декораторы свойства в очередь холдера в фазе LAST, не применяя их на текущем классе | нет |
| `Delay` | `Delay(...queue: ClassDecorator[]): ClassDecorator` | Фаза INSTANT: кладёт классовые декораторы в очередь холдера класса, выполняет `$._.inherit(родитель)` и `$._.apply()` | нет |
| `Apply` | `Apply(...queue: ClassDecorator[]): ClassDecorator` | Фаза INSTANT: `Delay(...)` + применение накопленных очередей к свойствам класса и собственной очереди — к самому классу | нет |
| `AomHolder` | `class AomHolder extends AomCore { queue: CombinedDecorator[] }` | Мета-класс пакета (свой реестр инстансов). **Не экспортируется** из `index.ts` | нет |

`packages/holder/src/index.ts:1-3` реэкспортирует только `./decorators`; `AomHolder` доступен исключительно внутри пакета. Побочный импорт `reflect-metadata` — там же, строка 1.

## Внутренние модули

| Файл | Ответственность | Ключевые символы |
|---|---|---|
| `packages/holder/src/index.ts` | Точка входа: `import "reflect-metadata"` и реэкспорт декораторов | — |
| `packages/holder/src/init.ts` | Мета-класс пакета с единственным прикладным полем `queue` | `AomHolder`, `queue` |
| `packages/holder/src/decorators.ts` | Три декоратора и приведения типов на границе очереди | `Hold`, `Delay`, `Apply` |
| `packages/holder/test/holder.test.ts` | 4 характеризационных теста (vitest), один `it.fails` | — |
| `packages/holder/package.src.json` | Источник для генерации `package.json` (`scripts/prebuild.js`) | — |

## Ключевые механизмы

Все три декоратора построены фабриками `AomCore` (`packages/core/src/defines/core.ts:521-534, 576-589`) поверх собственного мета-класса, поэтому у холдера свой реестр инстансов, независимый от `AomApi`/`AomSchemas`. Механику фаз, узла и наследования метаданных здесь не пересказываем — см. `packages/core/readme.md` §«Ключевые механизмы».

### Hold: отложить декораторы свойства (LAST)

`Hold` — property-декоратор фазы LAST. Его обработчик не применяет переданные декораторы, а лишь дописывает их в очередь мета-инстанса свойства:

`packages/holder/src/decorators.ts:9-14`

```ts
export function Hold(...queue: PropertyDecorator[]): PropertyDecorator {
  return AomHolder.propertyDecorator(($) => {
    $.queue.push(...(queue as unknown as CombinedDecorator[]));
    //
  }, ExecutionPhase.LAST);
}
```

LAST — отложенная фаза: вызов ложится в очередь узла и не исполняется, пока кто-то не вызовет `apply()` (`core.ts:99-113`, `115-122`). На самом базовом классе `apply()` никто не вызывает, поэтому очередь свойства остаётся пустой, а декораторы — неприменёнными. При наследовании отложенный вызов переносится на мета-инстанс одноимённого свойства потомка (`core.ts:135-177`, `303-364`), и уже там наполняет `queue` потомка.

Evidence: `packages/holder/src/decorators.ts:9-14`; `packages/core/src/defines/core.ts:71-81, 99-113, 303-364`.

### Delay: перенос callstack родителя + apply (INSTANT)

`Delay` — классовый декоратор фазы INSTANT. Он делает три вещи: кладёт свои классовые декораторы в очередь холдера этого класса, наследует метаданные прямого родителя и разбирает отложенные очереди.

`packages/holder/src/decorators.ts:16-30`

```ts
export function Delay(...queue: ClassDecorator[]): ClassDecorator {
  return AomHolder.classDecorator(($) => {
    $.queue.push(...queue);

    const errors: Error[] = [];

    const inheritDecorators = (parent: ClassType) => {
      $._.inherit(parent);
    };
    // перенесем декораторы со свойствами из родителя
    inheritDecorators(Object.getPrototypeOf($._.target));

    $._.apply(); // применим перенесенные декораторы
  }, ExecutionPhase.INSTANT);
}
```

`$._.inherit(parent)` переносит на потомка callstack родителя и его декорированные свойства, `$._.apply()` прогоняет LAST-очереди свойств, статик и origins узла (`core.ts:282-301`). Именно этот `apply()` и наполняет `queue` свойств потомка вызовами, положенными туда `Hold` на родителе.

Сам `Delay` при этом ничего не декорирует: `Reflect.decorate` по собственной очереди `$.queue` вызывается только внутри `Apply`. Класс, помеченный `@Delay(X())`, декоратор `X()` на себя не получает — ни в момент объявления, ни позже.

Evidence: `packages/holder/src/decorators.ts:16-30`; `packages/core/src/defines/core.ts:282-301, 303-364`.

### Apply: применить накопленное на потомке

`Apply` — классовый декоратор фазы INSTANT. Он вызывает `Delay` через `Reflect.decorate`, затем обходит `origins` узла и применяет очередь каждого свойства, и в конце применяет собственную очередь к классу.

`packages/holder/src/decorators.ts:32-55`

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

`origins` — список декорированных свойств, накопленный узлом класса при создании мета-инстансов свойств (`core.ts:269-276`); после `inherit` он содержит и свойства, перенесённые с родителя. Флаг `isClassOrigin` различает статику (декоратор применяется к конструктору) и свойство инстанса (к прототипу). Последняя строка применяет к классу те классовые декораторы, что были переданы в `Apply` (и попали в `$.queue` через `Delay`).

Рабочий сценарий целиком (`packages/holder/test/holder.test.ts:5-23`): `@Hold(Spy("a"))` на поле `HeldBase.field`, `@Apply()` на `HeldChild extends HeldBase` — и `Spy` вызывается ровно один раз, с целью `HeldChild.field`.

Evidence: `packages/holder/src/decorators.ts:32-55`; `packages/core/src/defines/core.ts:269-276, 282-301`.

## Инварианты и подводные камни

- Единственный проверенный сценарий — `Hold` на свойствах предка + `Apply` на конечном потомке. Остальные комбинации либо не работают (см. дефект), либо не покрыты тестами.
- `Delay` на классе не применяет к нему свои классовые декораторы: их исполняет только `Reflect.decorate($.queue, $._.target)` в `Apply` (`decorators.ts:52`). `@Delay(X())` без последующего `@Apply()` на потомке — no-op в части `X()`.
- `Apply` наследует ровно от прямого родителя: `Object.getPrototypeOf($._.target)` внутри `Delay` (`decorators.ts:26`). Транзитивность работает только если каждый промежуточный класс сам помечен `@Delay` или `@Apply`: `inherit` переносит лишь то, что уже лежит в узле прямого родителя (`packages/core/src/defines/core.ts:303-307`). Если между предком с `@Hold` и потомком с `@Apply` есть обычный класс без декораторов холдера, очередь теряется молча — ни ошибки, ни применения декораторов (см. §«Дефекты без ID»).
- От класса, помеченного `@Apply`, наследовать нельзя. `transferTo` переносит на потомка и выполненные, и ожидающие вызовы, не очищая источник (`core.ts:135-177`), поэтому `@Apply` на внуке повторно исполнит те же `Hold`-очереди. Черновик `docs/holder.md:164` предписывает вместо этого заводить буферный класс с «подвешенными» декораторами.
- Порядок нескольких декораторов внутри одного `Hold` тестом не зафиксирован (проверка через `arrayContaining`, `test/holder.test.ts:60-78`), полагаться на него нельзя.
- Правки `src` не видны приложению без `bun run build` — см. §«Сборка и потребление».

### Известные дефекты

> ⚠️ Дефект: класс-декораторы, переданные в `@Delay` на родителе, не переносятся на потомка при `@Apply` — очередь родителя остаётся неисполненной.
> Evidence: `packages/holder/src/decorators.ts:16-30`, `packages/core/src/defines/core.ts:109-111` (INSTANT только выполняется, никуда не сохраняется), тест `packages/holder/test/holder.test.ts:40-58` (`it.fails`), находка #3 в `docs/superpowers/plans/2026-07-20-test-coverage-findings.md:9`.
> Последствия: сценарий из `docs/holder.md:68-124` (базовые сущности с `@Delay(ComponentSchema(...))`) неработоспособен; отложить можно только декораторы свойств.
> Как обходить: классовые декораторы указывать непосредственно в `@Apply(...)` на конечном потомке. См. `KI-HOLDER-01` в `test/docs/known-issues.md`; корневая причина — `KI-CORE-04` (`packages/core/readme.md`).

### Легаси и мёртвый код

> 🧱 Легаси: в `Delay` объявлен массив `errors`, в который никто не пишет и который никто не читает; обёртка `inheritDecorators` вызывается один раз и не добавляет ничего к `$._.inherit(parent)`.
> Где лежит: `packages/holder/src/decorators.ts:20-26`.
> Почему не используется: остатки замысла собирать конфликты имён при переносе; сам конфликт в `AomNode.inherit` тоже погашен закомментированным блоком (`packages/core/src/defines/core.ts:356-359`).
> Чем заменён: ничем — ошибок пакет не сообщает. См. `KI-HOLDER-02` в `test/docs/known-issues.md`.

> 🧱 Легаси: `readme.md` пакета до перезаписи содержал заголовок `` `@aom-js/mixer` `` — «Class decorators mixer», имя `mixer` в коде отсутствует.
> Где лежит: HEAD-версия `packages/holder/readme.md:1-3` (заменена этим документом).
> Почему не используется: пакет называется `@aom-js/holder` (`packages/holder/package.src.json:2`), мета-класс — `AomHolder` (`packages/holder/src/init.ts:3`).
> Чем заменён: настоящим документом; см. §«Расхождения с историческими заметками» и `KI-HOLDER-02`.

> 🧱 Легаси: типы на границе очереди не сходятся — `Hold` принимает `PropertyDecorator[]`, а `queue` объявлена как `CombinedDecorator[]`, поэтому в обе стороны стоят приведения через `unknown`.
> Где лежит: `packages/holder/src/decorators.ts:4-8` (комментарий-объяснение), `:11`, `:46`.
> Почему не используется иначе: у `CombinedDecorator` `propertyKey` необязателен, у `PropertyDecorator` — обязателен; единого типа для очереди нет.
> Чем заменён: ничем, приведения оставлены намеренно. См. `KI-HOLDER-02` в `test/docs/known-issues.md`.

## Как использует приложение

Не использует. Симлинк `test/node_modules/@aom-js/holder → ../../../main/packages/holder` создан вместе с остальными пакетами ядра, но `@aom-js/holder` не значится в `dependencies` приложения и не импортируется ни в одном файле `test/src` (grep по `@aom-js/holder` пуст; встречающийся в приложении `@DelayRefStack` — декоратор `@aom-js/router`, к холдеру отношения не имеет).

Сценарий, ради которого пакет писался, в приложении реализован без него: базовые сущности объявлены обычными декораторами — `@ComponentSchema` на классе и пара `@PropertySchema.* + @Property/@PrimaryKey` на каждом поле (`test/src/common/schemas/postgres/base.ts:29-58, 77-84`). `DefaultEntity` и `EnabledEntity` при этом сами по себе компонент-схемы и в БД не создаются, потому что не помечены `@Entity()`. Класса `Contractors` из черновика `docs/holder.md:126-161` в приложении нет. Правило двойного декорирования — `test/docs/principles.md` §«Двойное декорирование»; каталог сущностей — `test/docs/data-model.md`.

## Сборка и потребление

Сборка стандартна для монорепо: `bun run build:holder` (или `bun --filter @aom-js/holder build`) прогоняет `tsc` трижды — `tsconfig.build.json` (cjs), `tsconfig.build.mjs.json` (mjs), `tsconfig.build.types.json` (типы) — и запускает `scripts/post-build.js`; `package.json` собирает `scripts/prebuild.js` слиянием `package.version.json` + `package.src.json` + `scripts/jsons/package.dist.json` (`scripts/prebuild.js:17-27`, `scripts/files.js:3-4`), а `tsconfig.build*.json` он просто копирует из `scripts/jsons/` (`scripts/prebuild.js:11-15`, `scripts/files.js:2`) — поэтому зависимости правятся в `package.src.json`, а опции компиляции — в `scripts/jsons/tsconfig.build*.json`. Приложение читает `dist` через симлинк и поле `exports`, так что правки `src` не видны приложению без пересборки. Полная схема — `docs/architecture.md` §«Сборка, тесты…» и §«Как приложение потребляет ядро».

Незакоммиченных правок в исходниках пакета нет, состояние на диске = HEAD (`git status` по `packages/holder` показывает только сам этот `readme.md`; исходники пакета совпадают с HEAD; последний коммит, менявший пакет, — `6c77463` «правки после bun переезда» (правил `src/decorators.ts` и `tsconfig.json`); тест добавлен раньше, коммитом `d68b75e` «test(holder)»). `dist` датирован 25 августа и новее `src`.

## Тесты

### Что покрыто

`packages/holder/test/holder.test.ts` — четыре характеризационных теста на синтетических декораторах-шпионах:

| Тест | Что фиксирует | Строки |
|---|---|---|
| `Hold` на свойстве родителя + `Apply` на потомке | декоратор применяется один раз, к свойству потомка | `test/holder.test.ts:5-23` |
| `Apply` применяет переданные ему класс-декораторы | собственная очередь `$.queue` исполняется на самом классе | `test/holder.test.ts:25-38` |
| `Delay` на родителе + `Apply` на потомке | `it.fails` — см. ниже | `test/holder.test.ts:40-58` |
| несколько `Hold`-декораторов | оба применяются (порядок не проверяется) | `test/holder.test.ts:60-78` |

### Expected-fail

Один `it.fails` — «Delay на родителе + Apply на потомке переносит класс-декораторы родителя» (`test/holder.test.ts:40-58`), находка #3 из `docs/superpowers/plans/2026-07-20-test-coverage-findings.md:9`. Соответствует `KI-HOLDER-01`; политика характеризационных тестов — `test/docs/testing.md`.

### Пробелы

- `@Delay` на классе без последующего `@Apply` (декораторы класса не применяются) — не проверено.
- `Hold` на статических свойствах и методах — ветка `isClassOrigin` (`decorators.ts:42`) не покрыта.
- Повторное наследование от `@Apply`-класса (`Grand extends Child`) — поведение не зафиксировано тестом.
- Цепочка с недекорированным промежуточным классом (`Hold` на прадеде, обычный класс посередине, `@Apply` на потомке) — не проверена; фактически очередь теряется, см. §«Дефекты без ID».
- Совместимость с реальными сторонними декораторами (`PropertySchema.*`, MikroORM `@Property`/`@Entity`) — ради чего пакет и писался — не проверяется вовсе.
- Взаимный порядок нескольких `Hold`: `arrayContaining` его не фиксирует.
- `dist` тестами не грузится; собранный пакет проверяет только `scripts/smoke.js` на этапе `bun run build`.

### Как запускать

```bash
cd main
bun run test -- packages/holder
```

Результат на 2026-09-02: 1 файл, 3 passed, 1 expected fail. Алиас `@aom-js/holder` в vitest указывает на `packages/holder/src` (`vitest.config.ts:25`), то есть тесты идут по исходникам, минуя `dist`.

## Дефекты без ID

> ⚠️ Дефект: очередь `Hold` теряется молча, если между предком с `@Hold` и потомком с `@Apply` стоит промежуточный класс без декораторов холдера.
> Evidence: `packages/holder/src/decorators.ts:26` (`Delay` наследует только от `Object.getPrototypeOf($._.target)`), `packages/core/src/defines/core.ts:303-307` (`inherit` переносит callstack ровно одного родителя), `packages/core/src/defines/core.ts:463-496` (`instance()` создаёт мета-инстанс по конструктору, без обхода цепочки прототипов — у недекорированного класса callstack и `origins` пусты).
> Последствия: `Base` с `@Hold(...)` → обычный `Mid extends Base` → `@Apply() class Leaf extends Mid` не применяет ни одного отложенного декоратора; ошибки при этом нет, расхождение обнаруживается только по отсутствующей схеме/колонке.
> Как обходить: помечать `@Delay()` каждый промежуточный класс цепочки либо наследовать конечный потомок напрямую от класса с `@Hold`. В реестре `test/docs/known-issues.md` ID под этот случай нет.

## Расхождения с историческими заметками

| Заметка | Утверждение | Фактически | Evidence |
|---|---|---|---|
| `packages/holder/readme.md:1-3` (HEAD, заменён этим документом) | Пакет называется `@aom-js/mixer`, «Class decorators mixer» | Имя пакета — `@aom-js/holder`, мета-класс — `AomHolder`; сущности `mixer` в коде нет | `packages/holder/package.src.json:2`; `packages/holder/src/init.ts:3` |
| `docs/holder.md:168` | Очередь — свойство класса `AomMixer`, перенос очереди происходит при наследовании | Класс называется `AomHolder`; переносится callstack узла (`AomNode.inherit`), а не поле `queue`; очередь потомка наполняется заново исполнением перенесённых LAST-вызовов | `packages/holder/src/init.ts:3-5`; `packages/core/src/defines/core.ts:303-307` |
| `docs/holder.md:68-124` | `@Delay(ComponentSchema(...))` на предках — классовые декораторы применятся на конечном потомке через `@Apply` | Классовые декораторы `Delay` родителя на потомка не переносятся: INSTANT не сохраняется в callstack | `packages/core/src/defines/core.ts:109-111`; `packages/holder/test/holder.test.ts:40-58` |
| `docs/holder.md:126-161` | Пример конечной сущности `Contractors` через `@Apply(ComponentSchema(...), Entity())` | Класса `Contractors` в приложении нет; базовые сущности объявлены прямыми декораторами без холдера | `test/src/common/schemas/postgres/base.ts:29-58` |
| `docs/superpowers/plans/2026-07-20-test-coverage.md:1690` | Запуск тестов: `yarn test packages/holder/test/holder.test.ts` | Репозиторий переехал на bun: `bun run test` (`vitest run`) | `package.json:29` (`"test": "vitest run"`); коммит `ac30794` «change yarn to bun» |

## Открытые вопросы

> ❓ Открытый вопрос: планируется ли чинить перенос `@Delay` (хранить очередь классовых декораторов в фазе LAST либо переносить `$.queue` внутри `inherit`), или `Delay` остаётся вспомогательной операцией «перенести свойства родителя без применения»?

> ❓ Открытый вопрос: что должно происходить при наследовании от класса, помеченного `@Apply`, — ошибка сборки или идемпотентное поведение? Сейчас механика `transferTo` ведёт к повторному применению, но тестом это не зафиксировано.

> ❓ Открытый вопрос: планируется ли использование холдера в приложении? Черновик `docs/holder.md` описывает именно его базовые сущности, но в `test/src` они собраны прямыми декораторами.
