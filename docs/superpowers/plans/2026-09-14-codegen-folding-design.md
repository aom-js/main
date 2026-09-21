# Проект: собственный формат свёртки/развёртки схем для codegen (KI-CODEGEN-01)

Состояние: реализовано 2026-09-14 (подзадачи №1–6 выполнены; решения — раздел 9). Основан на решении автора: плоские декораторы `PropertySchema.*` сохраняются со своими параметрами в собственном формате и восстанавливаются как есть — codegen не разбирает OpenAPI JSON Schema обратно. Общий план по реестру — `2026-09-13-known-issues-plan.md`.

## 1. Суть

Сейчас codegen восстанавливает классы из JSON Schema (`packages/codegen/src/defines/inverse.ts`). Эта свёртка теряет данные: `integer`, `uuid`, `oneOf`, скрытые поля, `extends`. Вместо неё при сборке дескриптора каждое свойство сохраняется как «фабрика `PropertySchema.*` + её параметры как есть», а codegen разворачивает запись обратно в те же декораторы. Функции внутри параметров заменяются метками `{$ref}`, `{$enum}`, `{$date}`, `{$regexp}`, `{$validator}`.

JSON Schema в дескрипторе остаётся (`components`, `methods[].args`) — для OpenAPI-мостов и потребителей без TS; codegen берёт компоненты только из нового поля `schemas`. `args` методов остаются JSON Schema: там словарь `@TopicSchema` (скаляры, ссылка, массив), он обратим один к одному.

## 2. Что показали пробы

- Код, развёрнутый из формата, даёт ту же JSON Schema, что исходные классы. Проверено на 5 классах: базовый, потомок через `extends`, `PickType`, ссылка на класс ниже по файлу (цикл), параметры `@ComponentSchema`.
- Валидаторы class-validator восстанавливаются из их метаданных автоматически: имя метаданной ↔ экспорт-функция (96 из 97, исключение `isLength→Length`), аргументы подбираются минимальные и проверяются повторным применением. Проверено: `IsUUID()`, `IsUUID("all",{each:true})`, `IsEnum(E,{each:true})`, `IsOptional()`, `Length(2,5)`, `MaxLength(3,{message,groups})`, `Matches(/re/i)`, `IsNumber({maxDecimalPlaces:2})`.
- Не восстанавливаются: `Transform`/`TransformToArray` (class-transformer), `ValidateIf(fn)`, свои `registerDecorator`, `message` в виде функции.
- Унаследованное свойство несёт тот же объект параметров, что у родителя (совпадение по ссылке) — так свои свойства отличаются от унаследованных. mapped-types видны как анонимные родители.
- Тип `Ref<T>` в сгенерированном коде снимает `KI-CODEGEN-03` (падение при ссылке на класс ниже по файлу).

## 3. Формат

Новый `packages/schemer/src/defines/folding.ts`, экспорт из `@aom-js/schemer`.

```ts
export type FoldedValue = null | boolean | number | string | FoldedValue[]
  | { [key: string]: FoldedValue }
  | { $date: string }                            // Date → toISOString()
  | { $regexp: [source: string, flags: string] }
  | { $ref: string }                             // Type.value → имя компонента
  | { $enum: string }                            // Enum.value → ключ FoldedSchemas.enums
  | { $validator: string; args: FoldedValue[] }; // элемент decorators; экспорт class-validator
export interface FoldedProperty { factory: SchemaTypes; params: Record<string, FoldedValue> }
export type FoldedParent = string
  | { $mapped: "Pick" | "Omit"; of: FoldedParent; keys: string[] }
  | { $mapped: "Partial"; of: FoldedParent }
  | { $mapped: "Intersection"; of: FoldedParent[] };
export interface FoldedComponent {
  params?: { description?: string; deprecated?: boolean }; // только если аргумент был передан
  extends?: FoldedParent;
  properties: Record<string, FoldedProperty>; // только свои, порядок объявления
}
export interface FoldedSchemas {
  format: 1;
  components: Record<string, FoldedComponent>; // ключи отсортированы
  enums: Record<string, Record<string, string | number>>;
}
export function foldSchemas(roots: Iterable<ClassType>): FoldedSchemas;
```

Правила:

- Порядок ключей параметров и свойств — исходный.
- `params` компонента — только если аргумент `@ComponentSchema` был передан. `name` не хранится: он удаляется из `@ComponentSchema` (`KI-SCHEMER-06`).
- Свойства — только свои (ссылка на объект параметров не совпадает с родительской).
- `extends`: прямой родитель — компонент → его имя, родитель в очередь обхода; родитель — mapped-класс → `{$mapped, of, keys}` рекурсивно, так что `IntersectionType(A, PartialType(B))` тоже описывается; родитель не компонент (например `AssignEntity`) → `extends` нет.
- `Type`: вызвать `value()`. Класс с `@ComponentSchema` → `{$ref}` и в очередь обхода; анонимный mapped-класс или не-компонент → ошибка с подсказкой «унаследуйте именованным классом». Циклы не мешают: ссылки по имени, обход с посещёнными, как в `SchemasCollector`.
- `Enum`: → `{$enum}`, значения — в общем словаре `enums`, только прямые пары (без обратных ключей числового enum); одинаковые объекты объединяются по ссылке. Имя — новый необязательный параметр `PropertySchema.Enum({ enumName })` (в JSON Schema не попадает, в формате хранится как есть), иначе `${Компонент}${Свойство}`. Одно имя с разными значениями → ошибка.

## 4. Свёртка `decorators`

Каждый декоратор применяется к пустому временному классу. Если он дал ровно одну метаданную class-validator с известным именем и минимальные аргументы подтвердились повторным применением — `{ $validator: "IsUUID", args: [...] }`. Иначе декоратор пропускается молча: `Transform`/`TransformToArray`, `ValidateIf`, свои `registerDecorator`, `message`-функции. Это допустимая потеря, заложенная в архитектуру: такие декораторы нужны базовому конструкту, а восстановленный класс передаёт только общую схему (решение автора). Образец алгоритма — приложение А.

## 5. Где собирается

- При декорировании добавить только то, что сейчас теряется: параметры `@ComponentSchema` → `$.componentParams`; в mapped-helper'ах пометка анонимного класса `$.mapped = { kind, of, keys }`. Параметры свойств уже хранятся (`schemaName`/`schemaParams` в `packages/schemer/src/defines/properties.ts`).
- `foldSchemas` вызывается при сборке дескриптора распределённого изолятора — `@Isolator(transfer, { distributed: true })` после `KI-TRANSFER-07` (сейчас `@IsDistributed`). К этому моменту классы загружены и `value: () => X` можно вызвать; приложения без transfer ничего не платят.
- `AomSchemas`: `componentParams?: ClassDescriptionsProperties`, `mapped?: { kind: "Pick" | "Omit" | "Partial" | "Intersection"; of: ClassType[]; keys?: string[] }`.
- `SchemasCollector`: `readonly classes = new Map<string, ClassType>()`, заполнять рядом с `components` (`packages/schemer/src/defines/collector.ts:65`).
- `TransferServiceDescriptor`: `schemas?: FoldedSchemas`; `hash = sha256(JSON.stringify({ methods, components, schemas }))`.

## 6. Развёртка в codegen

- `emitSchemas(descriptor)`: нет `schemas` при непустых `components` → ошибка «дескриптор до формата 1 — пересоберите collect» (старые дескрипторы не поддерживаются — решение автора); `format !== 1` → ошибка.
- Сначала enum (`export enum Имя { K = v }` — TS сам вернёт обратные ключи, объект в рантайме совпадёт), затем классы в топологическом порядке по `extends` и источникам mapped (при равенстве — по имени); ссылки `() => X` ленивые.
- TS-типы полей: String→`string`, Number→`number`, Boolean→`boolean`, Date→`Date`, Any→`any`, Enum→`Имя`, Type→`Ref<X>` (`type Ref<T> = T`); `isArray` → `[]`; `nullable` → `| null`; `isOptional` → `?`, иначе `!`.
- Метки в код: `$ref`→`() => X`, `$enum`→`X`, `$date`→`new Date("…")`, `$regexp`→`new RegExp(src, flags)`, `$validator`→`Имя(...args)` с импортом из `class-validator`.
- `inverse.ts` удаляется (`inverseSchema`/`InversedSchema`); `refName`/`scalarNameOf` переезжают в `emit-isolator.ts`.

## 7. Ошибки `foldSchemas`

Текст начинается с `foldSchemas:`:
- mapped-класс как компонент или как цель ссылки;
- одно имя у двух разных классов;
- `@PropertySchema` на статическом свойстве (в приложении таких нет);
- одно имя enum с разными значениями.

## 8. Пример

Сокращённо: `DefaultEntity`/`EnabledEntity` (`test/src/common/schemas/postgres/base.ts`), `RolesTypesSpecifications`/`RolesAccessTypesSpecifications` (`test/src/common/schemas/postgres/roles-specifications.ts`). У `DefaultEntity` нет `extends`: его родитель `AssignEntity` не компонент.

```json
{ "format": 1,
  "enums": { "RolesAccessTypesSpecificationsAllowedTypes": { "…": "значения PermissionsTypes" } },
  "components": {
    "DefaultEntity": { "params": { "description": "Базовый состав сущностей" }, "properties": {
      "id": { "factory": "String", "params": { "description": "ID", "decorators": [{ "$validator": "IsUUID", "args": [] }] } },
      "deletedAt": { "factory": "Date", "params": { "description": "Дата удаления", "nullable": true, "decorators": [] } } } },
    "EnabledEntity": { "params": { "description": "Сущности с активацией" }, "extends": "DefaultEntity", "properties": {
      "enabled": { "factory": "Boolean", "params": { "description": "Признак активности", "decorators": [] } } } },
    "RolesAccessTypesSpecifications": { "params": { "description": "Ограничения к типам полномочий" }, "properties": {
      "allowedTypes": { "factory": "Enum", "params": { "value": { "$enum": "RolesAccessTypesSpecificationsAllowedTypes" }, "description": "Разрешенные типы полномочий", "isArray": true } } } },
    "RolesTypesSpecifications": { "params": { "description": "Спецификации ролей доступа" }, "properties": {
      "permissions": { "factory": "Type", "params": { "value": { "$ref": "RolesAccessTypesSpecifications" }, "description": "Ограничения к типам полномочий" } } } } } }
```

## 9. Решения автора (2026-09-14)

1. `PropertySchema.Enum` получает необязательный параметр `enumName` — имя enum в сгенерированном коде; без него — `${Компонент}${Свойство}`.
2. Декораторы из `decorators`, которые переносятся вместе с аргументами (подтверждено повторным применением), сохраняются; остальные пропускаются — восстановленный класс передаёт общую схему, потеря допустима.
3. Дескрипторы без `schemas` не поддерживаются: codegen завершается с ошибкой и просит пересобрать; все hash сменятся один раз.

## 10. Риски и ограничения

- Смешанные версии узлов: пока часть узлов на старом transfer, у одного сервиса разные hash, и кэш реестра (хранит последнюю пришедшую копию) перескакивает между ними. Проходит после обновления всех узлов.
- `foldSchemas` применяет пользовательские декораторы к временным классам: побочные эффекты декораторов сработают ещё раз; метаданные временных классов остаются в хранилище class-validator.
- Объект с единственным ключом `$date`/`$regexp` внутри `examples`/`default` будет прочитан как метка.
- Связь с планом: `KI-SCHEMER-03` (`Date`/`Type` не применяют `decorators`) и `KI-SCHEMER-06` (`name`/`decorators` из `@ComponentSchema` протекают в JSON Schema) чинить до или вместе; формат хранит параметры как есть, сквозная проверка от них не ломается. Формат опирается на то, что `inherit` передаёт потомку тот же объект параметров, — это охраняет тест #5.

## 11. Подзадачи

| # | Подзадача | Роль | Файлы | Зависит от | Готово, когда |
|---|---|---|---|---|---|
| 1 | Захват при декорировании и `foldSchemas` | implementer | `schemer/src/defines/{module,decorators,collector,types}.ts`, `mapped-types/*.helper.ts`, новый `folding.ts`, `schemer/src/index.ts` | — | Контракты раздела 3; алгоритм `decorators` — приложение А с исключением `isLength→Length`; `enumName` в параметрах `Enum` (в JSON Schema не попадает); тесты schemer и router зелёные |
| 2 | Модульные тесты свёртки | test-engineer | `schemer/test/folding.test.ts` | контракты (параллельно с #1) | Покрыты: `extends` по ссылке на параметры, mapped (включая вложенные), enum (строковый и числовой, общий объект), `$date`/`$regexp`/`$validator`, пропуск `Transform`/своего декоратора/`message`-функции, `enumName`, все ошибки `foldSchemas:` |
| 3 | Дескриптор: `schemas` и hash | implementer | `transfer/src/defines/{types,decorators}.ts`, `transfer/test/descriptor.test.ts` | #1 | `schemas` в дескрипторе, hash его учитывает, JSON-круг без потерь, тесты transfer зелёные |
| 4 | Развёртка в codegen + KI-SCHEMER-08, KI-CODEGEN-02 | implementer | `codegen/src/**`, удалить `inverse.ts`, `codegen/test/emit.test.ts`, `post-build.js` codegen; из schemer — только `SCALAR_TYPE_SCHEMAS.date` в `collector.ts` | #1 | Правила раздела 6, `Ref<T>`, топологический порядок, ошибка на старый дескриптор; `emit.test` переписан под `schemas`; словарь `date` — в форме `oneOf` class-validator и распознаётся `scalarNameOf`; `chmod` для `bin`, `check` сообщает об удалённых сервисах (код 1), `serviceDirName("HTTPService") → "http-service"` |
| 5 | Сквозная проверка | test-engineer | `codegen/test/roundtrip.test.ts`, фикстура рядом, `.gitignore` (`packages/codegen/test/__generated__/`) | #3, #4 | Классы → дескриптор → `emitService` → `__generated__` → `import()` → `foldSchemas` → `toEqual` со `schemas`; `render` каждого компонента `toEqual`; фикстура по образцу приложения (IsUUID, Date nullable, Enum isArray, Type isArray с циклом, Pick/Partial/Intersection, параметры `@ComponentSchema`) |
| 6 | Документация | docs-writer | `docs/isolators.md` §6, `codegen/readme.md`, `test/docs/known-issues.md` | #5 | Правила восстановления из формата вместо JSON Schema; `KI-CODEGEN-01` и `-03` закрыты со ссылкой на тест; пропускаемые декораторы описаны как штатная потеря |

Волны: #1 и #2 → #3 и #4 → #5 → #6 → прогон тестов и ревью.

## Приложение А. Образец свёртки одного декоратора (проба)

```js
require("reflect-metadata");
const cv = require("class-validator");
const store = cv.getMetadataStorage();
const fns = Object.keys(cv).filter((k) => /^[A-Z]/.test(k) && typeof cv[k] === "function");
const byName = { isLength: "Length" };
Object.keys(cv).filter((k) => /^[A-Z_]+$/.test(k) && typeof cv[k] === "string").forEach((k) => {
  const f = fns.find((fn) => fn.toUpperCase() === k.replace(/_/g, "")); if (f) byName[cv[k]] = f;
});
const mask = (x) => JSON.stringify(x, (k, v) => v instanceof RegExp ? `/${v.source}/${v.flags}` : typeof v === "function" ? "<fn>" : v);
const meta = (decs) => { class S {} Reflect.decorate(decs, S.prototype, "p");
  return store.getTargetValidationMetadatas(S, "", true, false).map((m) => ({ type: m.type, name: m.name, constraints: m.constraints, each: m.each, message: m.message, groups: m.groups, always: m.always, context: m.context })); };
// fold одного декоратора: ровно одна метадата с известным именем → минимальные аргументы, проверенные повтором
function fold(dec) {
  const ms = meta([dec]); if (ms.length !== 1 || !byName[ms[0].name]) return null;
  const m = ms[0], F = cv[byName[m.name]];
  const opts = {}; if (m.each) opts.each = true; if (m.groups?.length) opts.groups = m.groups;
  if (m.always) opts.always = true; if (typeof m.message === "string") opts.message = m.message; if (m.context) opts.context = m.context;
  const c = m.constraints || [];
  for (let k = c.length; k >= 0; k--) {
    const args = c.slice(0, k); while (args.length && args[args.length - 1] === undefined) args.pop();
    if (Object.keys(opts).length) { while (args.length < k) args.push(undefined); args.push(opts); }
    try { if (mask(meta([F(...args)])) === mask(ms)) return `${byName[m.name]}(${mask(args).slice(1, -1)})`; } catch {}
  }
  return "UNVERIFIED";
}
```

`null` — декоратор не class-validator или дал несколько метаданных; `"UNVERIFIED"` — аргументы не подобрались; в обоих случаях декоратор пропускается. В реализации возвращать `{ $validator, args }` вместо строки.
