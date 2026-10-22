# @aom-js/codegen

Пакет решает обратную задачу к дистрибуции изоляторов: транспорт (`@aom-js/transfer`) публикует по шине сериализуемый контракт сервиса (`TransferServiceDescriptor`), а `@aom-js/codegen` превращает его обратно в исходники TypeScript — DTO с `@ComponentSchema`/`@PropertySchema.*` и класс-изолятор с `@Isolator`/`@ResponseTopic`/`@CustomTopic`/`@IsQueue`/`@TopicSchema`. Потребитель получает типизированного клиента чужого сервиса, не импортируя его исходники.
Читать до: `packages/transfer/readme.md` (дескриптор, `foldSchemas`, дистрибуция), `packages/schemer/readme.md` (`PropertySchema`, `SCALAR_TYPE_SCHEMAS`, `FoldedSchemas`). Читать после: `main/docs/architecture.md`. Термины — `test/docs/README.md#словарь`.

Пакет построен вокруг собственного формата свёртки схем (`descriptor.schemas`, `KI-CODEGEN-01`); прежний модуль обратного разбора JSON Schema в PropertySchema-декораторы удалён из пакета вместе со своей экспортируемой функцией. Приложением пакет не используется (см. §«Как использует приложение»).

## Назначение и место в стеке

Рантайм-альтернатива без генерации — `Transfer.restore(descriptor)` (`packages/transfer/src/defines/main.ts`, см. `packages/transfer/readme.md`). `@aom-js/codegen` даёт то же самое, но статически: класс со всеми декораторами, который можно закоммитить и импортировать без живой шины на момент сборки.

Зависимости — `@aom-js/transfer` (тип дескриптора, `StructureCollectorFunction`) и `@aom-js/schemer` (`SCALAR_TYPE_SCHEMAS`, типы `FoldedSchemas`/`FoldedComponent`/`FoldedProperty`/`FoldedParent`/`FoldedValue`, `isFoldedValidatorName`, `PropertySchema`, `SchemaTypes`), см. `packages/codegen/package.src.json`. Обратных зависимостей нет — ни один пакет ядра `@aom-js/codegen` не импортирует.

Разделение ответственности жёсткое: все функции пакета чистые (дескриптор → строки или план файлов), файловой системой и `process.exit` занимается исключительно CLI (`packages/codegen/src/cli.ts`).

## Публичный API

Экспортируется всё из `src/defines/*`, кроме `cli.ts` и `safe.ts` — оба не реэкспортируются из `index.ts` (`packages/codegen/src/index.ts`). `safe.ts` (`assertIdentifier`, `assertDeclarableName`, `propertyKey`, `commentText`) — внутренняя граница «дескриптор → код», используется только `emit-schemas.ts`/`emit-isolator.ts`.

| Экспорт                     | Сигнатура                                                                                               | Назначение                                                                                                                          | Используется приложением |
| --------------------------- | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| `collect`                   | `collect(source: CollectSource, timeoutMs = 3000): Promise<TransferServiceDescriptor[]>`                | Снапшот реестра шины за таймаут; LWW по имени, результат отсортирован; нестроковое `name` отбрасывается                             | нет                      |
| `CollectSource`             | `{ collectDistributions(handler: StructureCollectorFunction): void }`                                   | Минимальная часть `Transfer`, нужная для сбора (подстановка в тестах)                                                               | нет                      |
| `emitSchemas`               | `emitSchemas(descriptor: TransferServiceDescriptor): string \| undefined`                               | `descriptor.schemas` (`FoldedSchemas`) → исходник `schemas.ts`; `undefined`, если компонентов нет                                   | нет                      |
| `emitIsolator`              | `emitIsolator(descriptor: TransferServiceDescriptor, config: CodegenConfig): string`                    | `methods` → исходник изолятора с исходными декораторами                                                                         | нет                      |
| `refName`                   | `refName(ref: string, knownComponents: ReadonlySet<string>): string`                                    | Хвост `$ref` после `/`; бросает, если это не identifier или не входит в `knownComponents`                                           | нет                      |
| `scalarNameOf`              | `scalarNameOf(schema: Record<string, any>): string \| undefined`                                        | Имя скаляра по точному совпадению JSON Schema со словарём `SCALAR_TYPE_SCHEMAS`                                                     | нет                      |
| `emitService`               | `emitService(descriptor: TransferServiceDescriptor, config: CodegenConfig): EmittedService`             | Генерация одного сервиса: `schemas.ts?` + исходник изолятора                                                                             | нет                      |
| `serviceDirName`            | `serviceDirName(name: string): string`                                                                  | `HTTPService` → `http-service`; бросает на `/`, `\`, `..`, пустое имя                                                               | нет                      |
| `planGeneration`            | `planGeneration(descriptors: TransferServiceDescriptor[], config: CodegenConfig): GenerationPlan`       | Чистое планирование генерации по снапшоту: один плохой дескриптор не блокирует остальные; коллизия каталога — ошибка для обоих имён | нет                      |
| `PlannedService`            | `{ service: EmittedService; dir: string }`                                                              | Один успешно спланированный сервис + имя каталога                                                                                   | нет                      |
| `GenerationPlan`            | `{ succeeded: PlannedService[]; errors: string[] }`                                                     | Результат `planGeneration`                                                                                                          | нет                      |
| `diffManifest`              | `diffManifest(descriptors: TransferServiceDescriptor[], manifest: Record<string, string>): CheckResult` | Чистая сверка снапшота с `<out>/manifest.json`: `drifted`/`missing`/`removed`                                                       | нет                      |
| `CheckResult`               | `{ drifted; missing: TransferServiceDescriptor[]; removed: string[] }`                                  | Результат `diffManifest`; `removed` — сервис пропал из снапшота (`KI-CODEGEN-02`)                                                   | нет                      |
| `CodegenConfig`             | `{ transferImport: string; transferExportName?: string }`                                               | Откуда сгенерированный изолятор берёт настроенный транспорт                                                                         | нет                      |
| `EmittedFile`               | `{ path: string; source: string }`                                                                      | Один сгенерированный файл                                                                                                           | нет                      |
| `EmittedService`            | `{ name: string; hash: string; files: EmittedFile[] }`                                                  | Результат генерации сервиса                                                                                                         | нет                      |
| `TransferServiceDescriptor` | `export type { TransferServiceDescriptor } from "@aom-js/transfer"`                                     | Реэкспорт типа дескриптора                                                                                                          | нет                      |
| `aom-codegen`               | `aom-codegen collect\|generate\|check --flag value …`                                                   | CLI (`bin`, не экспортируется из `index.ts`)                                                                                        | нет                      |

Evidence: `packages/codegen/src/index.ts`; `packages/codegen/src/defines/types.ts`; `packages/codegen/src/defines/collect.ts`; `packages/codegen/src/defines/emit-schemas.ts` (`emitSchemas`); `packages/codegen/src/defines/emit-isolator.ts` (`refName`, `scalarNameOf`, `emitIsolator`); `packages/codegen/src/defines/emit.ts`; `packages/codegen/src/defines/check.ts`.

## Внутренние модули

| Файл                                                  | Ответственность                                                                                                                                                                  | Ключевые символы                                                                               |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `packages/codegen/src/index.ts`                       | Реэкспорт `defines/*`, кроме `safe.ts`; `cli.ts` не включён                                                                                                                      | —                                                                                              |
| `packages/codegen/src/defines/types.ts`               | Типы конфигурации и результата; реэкспорт типа дескриптора                                                                                                                       | `CodegenConfig`; `EmittedFile`; `EmittedService`                                               |
| `packages/codegen/src/defines/collect.ts`             | Снапшот реестра шины по таймауту                                                                                                                                                 | `CollectSource`; `collect`                                                                     |
| `packages/codegen/src/defines/safe.ts`                | Граница «недоверенный дескриптор → идентификатор/ключ/комментарий сгенерированного кода»                                                                                         | `assertIdentifier`; `assertDeclarableName`; `propertyKey`; `commentText`; `FORBIDDEN_NAMES`    |
| `packages/codegen/src/defines/emit-schemas.ts`        | `descriptor.schemas` (`FoldedSchemas`) → текст `schemas.ts`: классы, enum'ы, топологический порядок, метки `$date/$regexp/$ref/$enum/$validator`                                 | `emitSchemas`; `topoOrder`; `parentExpr`; `renderValue`; `tsType`; `emitComponent`; `emitEnum` |
| `packages/codegen/src/defines/emit-isolator.ts`       | `methods` → текст изолятора, импорты и сигнатуры                                                                                                                             | `emitIsolator`; `emitMethod`; `refName`; `scalarNameOf`; `typeSource`; `tsOf`; `collectRefs`   |
| `packages/codegen/src/defines/emit.ts`                | Сборка файлов сервиса, имя каталога, планирование генерации по снапшоту                                                                                                          | `emitService`; `serviceDirName`; `planGeneration`                                              |
| `packages/codegen/src/defines/check.ts`               | Чистая сверка снапшота с `<out>/manifest.json`                                                                                                                                   | `diffManifest`; `CheckResult`                                                                  |
| `packages/codegen/src/cli.ts`                         | CLI: разбор флагов, чтение/запись файлов, `<out>/manifest.json`, коды выхода                                                                                                     | `flags`; `required`; `collectCommand`; `generateCommand`; `checkCommand`                       |
| `packages/codegen/test/collect.test.ts`               | `collect`: LWW, сортировка, поздний ответ                                                                                                                                        | —                                                                                              |
| `packages/codegen/test/emit.test.ts`                  | Восстановление DTO/изолятора, enum/extends/mapped-types, ошибки формата, вся граница безопасности (HIGH/MEDIUM/LOW), `check`                                                     | —                                                                                              |
| `packages/codegen/test/roundtrip.test.ts`             | Сквозные тесты: классы фикстуры → дескриптор → `emitService` → `__generated__` → `import()` → `foldSchemas`/`render` `toEqual` с исходником                                      | —                                                                                              |
| `packages/codegen/test/fixtures/roundtrip-service.ts` | Фикстура сквозного теста: наследование, `IsUUID`, `Date` nullable, `Enum` (`isArray`+`enumName`), цикл `Type` A↔B, `Pick`/`Partial`/`Intersection`, `Transform` (штатная потеря) | —                                                                                              |
| `packages/codegen/package.src.json`                   | Исходный `package.json` (`bin`, зависимости); итоговый генерирует `scripts/prebuild.js`                                                                                          | `bin.aom-codegen`                                                                              |

## Ключевые механизмы

### Снапшот реестра (collect)

Не изменился по сравнению с прежней версией пакета: `collect` подписывает обработчик через `source.collectDistributions(...)`, складывает дескрипторы в `Map` по `name` (последний ответ побеждает) и по истечении `timeoutMs` резолвит отсортированный массив. Единственное дополнение — запись с нестроковым `name` отбрасывается до `.sort()`, а не роняет весь снапшот на сравнении:

`packages/codegen/src/defines/collect.ts` (`collect`)

```ts
source.collectDistributions((data) => {
  const descriptors: TransferServiceDescriptor[] = Array.isArray(data.value) ? data.value : [];
  descriptors
    .filter((descriptor) => typeof descriptor?.name === "string")
    .forEach((descriptor) => byName.set(descriptor.name, descriptor));
});
setTimeout(() => {
  resolve([...byName.values()].sort((a, b) => a.name.localeCompare(b.name)));
}, timeoutMs);
```

Evidence: `packages/codegen/src/defines/collect.ts` (`collect`); `packages/transfer/src/defines/main.ts` (`collectDistributions`, `acceptRegistry`); `packages/codegen/test/collect.test.ts` («собирает дескрипторы от нескольких узлов до таймаута, LWW по имени, сортировка», «ответ после таймаута не попадает в снапшот»).

### Восстановление DTO из собственного формата (emitSchemas)

`emitSchemas` больше не разбирает JSON Schema — он читает `descriptor.schemas` (`FoldedSchemas` из `@aom-js/schemer`, `foldSchemas`) и разворачивает его обратно в те же вызовы `@PropertySchema.*`, что были в исходном классе, с теми же параметрами. Без `schemas` при непустых `components` (дескриптор до формата 1, из старого кэша реестра) — явная ошибка вместо попытки угадать формат:

`packages/codegen/src/defines/emit-schemas.ts` (`emitSchemas`)

```ts
export function emitSchemas(descriptor: TransferServiceDescriptor): string | undefined {
  const { schemas } = descriptor;
  if (!schemas) {
    if (Object.keys(descriptor.components).length) {
      throw new Error("codegen: дескриптор до формата 1 — пересоберите collect");
    }
    return undefined;
  }
  if (schemas.format !== 1) {
    throw new Error(`codegen: неизвестный формат схем (format: ${schemas.format})`);
  }
  if (!Object.keys(schemas.components).length) return undefined;
```

Правила развёртки:

- **Порядок объявления** — сначала все `enum`'ы (по имени), затем классы в топологическом порядке по `extends` (прямой родитель и все источники mapped-цепочки — раньше потомка), при отсутствии зависимости — по имени (`topoOrder`, `packages/codegen/src/defines/emit-schemas.ts`). Цикл в `extends` — ошибка `codegen: цикл extends на "…"`; циклы по `Type`-ссылкам циклами не считаются — они разворачиваются лениво (см. ниже).
- **`extends`** — если родитель компонент, класс объявляется как `export class X extends Родитель`; если родитель — mapped-цепочка (`{$mapped: "Pick"|"Omit", of, keys}` / `{$mapped: "Partial", of}` / `{$mapped: "Intersection", of: [...]}`), она рекурсивно превращается в вызов `PickType(...)`/`OmitType(...)`/`PartialType(...)`/`IntersectionType(...)`, в том числе вложенный (`IntersectionType(A, PartialType(B))`); если родитель не компонент (обычный класс), `extends` в схеме отсутствует, и восстановленный класс его не получает.
- **Типы полей**: `String`/`Number`/`Boolean`/`Date`/`Any` → `string`/`number`/`boolean`/`Date`/`any`; `Enum` → имя `enum`'а из `schemas.enums` (`enumName`, если задан, иначе `${Компонент}${Свойство}`); `Type` → `Ref<X>` — псевдоним `type Ref<T> = T` добавляется в файл, если использован хотя бы раз, а сама ссылка на класс — ленивая (`() => X`), это снимает `KI-CODEGEN-03` (падение при ссылке на класс, объявленный ниже по файлу, из-за `design:type`); `isArray` даёт суффикс `[]`, `nullable` — `| null`, `isOptional` — `?` у имени свойства, иначе `!`.
- **Метки в параметрах**: `{$date}` → `new Date("…")`, `{$regexp: [source, flags]}` → `new RegExp(source, flags)`, `{$ref}` → `() => Компонент`, `{$enum}` → имя `enum`'а, `{$validator, args}` → вызов декоратора `class-validator` с этими аргументами и отдельный сортированный импорт из `"class-validator"`.
- **`@ComponentSchema(params)`** — восстанавливается только если `params` были переданы при декорировании (`component.params` есть в `FoldedComponent`); без параметров — `@ComponentSchema()`.

Evidence: `packages/codegen/src/defines/emit-schemas.ts` (`emitSchemas` — сборка файла, импорты), (`topoOrder`/`leafNames`/`parentExpr`), (`renderValue`, метки), (`tsType`), (`emitProperty`/`emitComponent`/`emitEnum`); формат — `packages/schemer/src/defines/folding.ts`; тесты `packages/codegen/test/emit.test.ts` (enum/extends/mapped), (nullable/числовой enum/цикл Type).

### Штатная потеря: декораторы без аргументов

Декоратор из `component.properties[x].params.decorators`, который `foldSchemas` не смог свернуть в `{$validator, args}` (не декоратор `class-validator`, или дал больше одной метаданной, или его минимальные аргументы не подтвердились повторным применением — `Transform`/`TransformToArray` из `class-transformer`, `ValidateIf(fn)`, собственные `registerDecorator`, `message`-функции), при свёртке просто отсутствует в списке — `emitSchemas` о нём ничего не знает и восстанавливает свойство без него. Это решение автора, а не пробел реализации: восстановленный класс передаёт общую схему валидации, а не побитово идентичный декоратор.

Evidence: `packages/schemer/src/defines/folding.ts` (свёртка `decorators`, см. `packages/schemer/readme.md`); тест `packages/codegen/test/roundtrip.test.ts` («непереносимый декоратор (Transform) молча пропадает при свёртке ChildEntity.note») (`ChildEntity.note` с `Transform` — `decorators` пустой после свёртки) и фикстура `packages/codegen/test/fixtures/roundtrip-service.ts` (`ChildEntity.note`).

### Восстановление изолятора (emitIsolator)

Не изменилось в части декораторов метода: `waitForResponse` выбирает `@ResponseTopic`/`@CustomTopic`, `singleton` — их аргумент, `queue` даёт `@IsQueue()`; наличие поля `args` (а не его длина) отличает описанный метод от неописанного. Изменилось окружение: `$ref` в JSON Schema аргументов/ответа теперь обязан указывать на компонент из `descriptor.schemas.components` (см. границу безопасности ниже), а опция `{ distributed: true }` у `@Isolator` по-прежнему не переносится — сгенерированный код всегда получает голый `@Isolator(transfer)`: сгенерированный изолятор только вызывает чужой сервис, а с опцией узел-потребитель собрал бы дескриптор со своим `origin` и раздавал бы чужой контракт как свой; переизлучением чужих контрактов занимается кэш реестра (`packages/transfer/readme.md` §«Протокол реестра и кэш LWW»).

`packages/codegen/src/defines/emit-isolator.ts` (`emitIsolator`)

```ts
export function emitIsolator(descriptor: TransferServiceDescriptor, config: CodegenConfig): string {
  assertDeclarableName(descriptor.name, "имя сервиса", ISOLATOR_OWN_NAMES);
  const knownComponents = new Set(Object.keys(descriptor.schemas?.components ?? {}));
  const methods = descriptor.methods.map((method) => emitMethod(method, knownComponents));
```

Тело метода — всегда заглушка `return undefined as never`; тип возврата — `Promise<T>` по `returns`, иначе `Promise<unknown>` при `waitForResponse` и `Promise<void>` без него. Набор импортов из `@aom-js/transfer` вычисляется по фактически нужным декораторам, импорт транспорта — `default` либо именованный по `config.transferExportName`, импорт DTO из `"./schemas"` добавляется только при наличии `$ref`-ов. `hash` дескриптора зашивается константой `<Name>Hash`; имя сервиса, которое дало бы `<Name>Hash`, совпадающий с именем импортируемого через `$ref` компонента (например сервис `Foo` при компоненте `FooHash`), — тоже ошибка (redeclare того же identifier'а), проверяется отдельно от `ISOLATOR_OWN_NAMES`.

Сигнатура метода: имена параметров — ключи пар `args` (`[{ "id": { "type": "string" } }]` → `id: string`, имя проверяет `assertIdentifier`); метод без поля `args` → `(...args: unknown[])` без `@TopicSchema`; `args: []` → `()`. Тип в `@TopicSchema` и тип в сигнатуре строятся раздельно (`typeSource`, `tsOf`): `$ref` → имя компонента, скаляр → строковое имя по `scalarNameOf` в декораторе и TS-тип в сигнатуре, `{"type": "array", "items": X}` → `[X]` в декораторе и `X[]` в сигнатуре. Сгенерированный изолятор — обычный `@Isolator`-класс: наследник с `@Executor` делает узел исполнителем чужого контракта (`packages/transfer/readme.md` §«Executor и привязка исполнителя»).

Evidence: `packages/codegen/src/defines/emit-isolator.ts` (`emitIsolator`, `emitMethod`, `typeSource`, `tsOf`), (проверка `<Name>Hash`); тесты `packages/codegen/test/emit.test.ts` («изолятор: исходные декораторы, именованные аргументы, hash-константа» — декораторы, hash-константа, `distributed` не переносится; «LOW: имя сервиса не может совпадать с тем, что импортирует/объявляет сам isolator.ts» и «LOW: имя сервиса, дающее '<имя>Hash' == имени импортируемого компонента — ошибка (redeclare)» — имя сервиса против собственных импортов изолятора и против `<Имя>Hash`).

### Граница безопасности: дескриптор с шины — недоверенные данные

Дескриптор приходит по шине от произвольного узла (`KI-CODEGEN-01`). Всё, что из него превращается в идентификатор, ключ или литерал сгенерированного TS-кода, проходит через `safe.ts` и точечные проверки в `emit-schemas.ts`/`emit-isolator.ts`:

- **Идентификаторы.** Имена сервиса, компонента, enum, метода, аргумента метода — только `/^[A-Za-z_$][A-Za-z0-9_$]*$/` (`assertIdentifier`). Имена, которые становятся `export class`/`export enum` (компонент, enum, имя сервиса — оно же класс изолятора), дополнительно не могут совпадать с глобальным объектом рантайма генератора (`Object.getOwnPropertyNames(globalThis)` + явный список `KEY_GLOBALS`: `Date`, `RegExp`, `Function`, `Object`, `Promise`, `process`, `require`, …), зарезервированным словом/встроенным типом TS, собственным импортом генератора (`ComponentSchema`, `PropertySchema`, `Ref`, `PickType`/`OmitType`/`PartialType`/`IntersectionType`) или именем валидатора из `isFoldedValidatorName` (`assertDeclarableName`, `packages/codegen/src/defines/safe.ts`). Имя сервиса дополнительно сверяется с тем, что импортирует сам сгенерированный файл изолятора (`Isolator`, `ResponseTopic`, `CustomTopic`, `IsQueue`, `TopicSchema`, `transfer`) — иначе, например, сервис `Isolator` дал бы `export class Isolator {}` рядом с `import { Isolator } from "@aom-js/transfer"` (`ISOLATOR_OWN_NAMES`, `packages/codegen/src/defines/emit-isolator.ts`) — и ещё раз с производной от него константой `<Name>Hash` (см. ниже).
- **Ссылки.** `extends`, `$ref`, `$enum` (в т. ч. листья mapped-цепочки) принимаются только если это identifier И реально существующий компонент/enum **этого же** дескриптора (`assertKnownName` в `emit-schemas.ts`, `refName` в `emit-isolator.ts` со сверкой `knownComponents`) — иначе, например, `extends: "process"` или `$ref: "globalThis"` доставали бы из области видимости потребителя произвольный класс/функцию вместо компонента схемы.
- **`$validator`.** Имя проверяется белым списком `isFoldedValidatorName` из `@aom-js/schemer` — тем же, которым `foldSchemas` ограничивает себя при свёртке; экспорты `class-validator`, не являющиеся фабриками декораторов свойств (`useContainer`, `registerDecorator`, `validateSync`, …), отклоняются, даже если они синтаксически валидный identifier и реально существуют в модуле (`emit-schemas.ts`, `renderValue`).
- **`$regexp`.** Метка обязана быть парой `[string, string]`; флаги — только `^[dgimsuvy]*$` без повторов; помимо формы, `new RegExp(source, flags)` реально вызывается на этапе генерации — невалидный regexp (не только флаги, но и сам паттерн) падает в codegen, а не у потребителя (`emit-schemas.ts`, `renderValue`).
- **`$date`.** Только строка, для которой `Date.parse(...)` не даёт `NaN` — произвольный текст (включая попытки вставить код) отклоняется до того, как попасть в `new Date(...)` (`emit-schemas.ts`, `renderValue`).
- **Строки и числа.** Любое строковое значение параметра идёт через `JSON.stringify` — экранирование `*/`, обратных кавычек, `${`, переводов строк гарантировано; числа — тоже через `JSON.stringify` (`NaN`/`Infinity` невозможны как параметр; для значения `enum` нечисловое/нецелое отдельно отклоняется явной проверкой). Ключ `__proto__` в объектном литерале параметров выводится вычисляемой формой `["__proto__"]`, чтобы он остался обычным собственным свойством, а не сменил `[[Prototype]]` объекта (`propertyKey`, `safe.ts`); тот же ключ как имя члена `enum` — ошибка, а не автоматическое исправление (`enum` компилируется через присваивание, и computed-форма для него не работает — член молча потерялся бы без ошибки).
- **Свойства и методы.** Имя свойства `constructor` — ошибка (поле с таким именем не собирается у потребителя); имена методов изолятора `name`/`length`/`prototype`/`constructor`/`caller`/`arguments` — тоже ошибка (это собственные свойства `Function.prototype`, метод `name` иначе молча подменил бы имя класса).
- **Пути.** `serviceDirName` не пропускает `/`, `\`, `..` и пустое имя; коллизия каталогов при разном регистре/разбиении слов (`serviceDirName` регистронезависим: `Foo`/`foo`, `HTTPService`/`HttpService`, `HTTP_Service` → один и тот же `http-service`/`http_service`) ловится отдельно, на уровне снапшота — см. `planGeneration` ниже.

Evidence: `packages/codegen/src/defines/safe.ts` (весь файл); `packages/codegen/src/defines/emit-schemas.ts` (`emitSchemas`, `assertKnownName`, `renderValue`, `emitProperty`, `emitComponent`, `emitEnum`); `packages/codegen/src/defines/emit-isolator.ts` (`ISOLATOR_OWN_NAMES`, `FORBIDDEN_METHOD_NAMES`, `refName`, `emitIsolator`); тесты `packages/codegen/test/emit.test.ts` (весь блок `describe("codegen: граница «данные шины → код»…")`, включая `HIGH`/`MEDIUM`/`LOW`-пробы из аудита безопасности).

### Планирование генерации (planGeneration) и CLI

`planGeneration` — чистая функция: по снапшоту дескрипторов строит `{ succeeded, errors }`, не трогая файловую систему. Один сломанный дескриптор эмитится в своём `try/catch` и не блокирует остальные; коллизия каталога (два разных имени сервиса дают один и тот же `serviceDirName`) — тоже ошибка с обоими именами, а не молчаливая перезапись файлов одного сервиса другим:

`packages/codegen/src/defines/emit.ts` (`planGeneration`)

```ts
descriptors.forEach((descriptor) => {
  try {
    const service = emitService(descriptor, config);
    emitted.push({ service, dir: serviceDirName(service.name) });
  } catch (error) {
    errors.push(`${JSON.stringify(descriptor?.name ?? null)}: ${(error as Error).message}`);
  }
});
// ...
byDir.forEach((services, dir) => {
  if (services.length > 1) {
    errors.push(
      `каталог "${dir}" собрали бы сразу сервисы ${services.map((s) => JSON.stringify(s.name)).join(", ")} — переименуйте один из них`,
    );
    return;
  }
  succeeded.push({ service: services[0], dir });
});
```

`generateCommand` (CLI) пишет на диск только `succeeded`, но манифест `<out>/manifest.json` (`{ имя сервиса: hash }`) обновляет всегда (сервисы с коллизией/ошибкой в нём не появляются — `check` затем честно сообщает о них как о «не сгенерированных», а не молчит); если `errors.length`, все сообщения печатаются в `stderr`, и процесс завершается кодом 1. `checkCommand` сравнивает снапшот с `<out>/manifest.json` через `diffManifest`: `drifted` (hash разошёлся), `missing` (есть в снапшоте, нет в manifest) и `removed` (был в manifest, пропал из снапшота — `KI-CODEGEN-02`) — любой непустой список даёт код выхода 1.

```bash
aom-codegen collect  --transfer-module <путь к модулю с Transfer> [--export <имя>] [--timeout 3000] --out descriptors.json
aom-codegen generate --from descriptors.json --out <каталог> --transfer "<module specifier>" [--transfer-export <имя>]
aom-codegen check    --from descriptors.json --out <каталог>
```

Живая шина нужна только `collect`: он импортирует модуль с настроенным `Transfer` (модуль на TS — запускать под bun, node потребует скомпилированный), а `generate` и `check` работают по файлу снапшота. Поэтому снапшот и `<out>` (код и манифест) рассчитаны на коммит в репозиторий потребителя: сборка воспроизводима без шины, а `check` на свежем снапшоте ловит дрейф контракта (`cli.ts` (`collectCommand`, `USAGE`)).

Evidence: `packages/codegen/src/defines/emit.ts` (`planGeneration`); `packages/codegen/src/defines/check.ts`; `packages/codegen/src/cli.ts` (`generateCommand`, `checkCommand`); тесты `packages/codegen/test/emit.test.ts` («planGeneration: коллизия каталога (Foo/foo → foo) — ошибка с обоими именами, ничего не пишем», «planGeneration: один сломанный дескриптор не блокирует генерацию остальных», «planGeneration: null-запись в снапшоте не роняет обработку остальных, имена в ошибках экранированы» — `planGeneration`; «дрейф: hash в снапшоте разошёлся с manifest», «не сгенерирован: сервис есть в снапшоте, но не в manifest», «удалён: сервис есть в manifest, но пропал из снапшота», «совпадение — все списки пустые» — `diffManifest`).

## Инварианты и подводные камни

- Имя класса изолятора и имена компонент переносятся дословно: топики выводятся из имени (`${Class}.${method}`), а `$ref`-имена — из `target.name`; переименование ломает адресацию.
- Различие «метод не описан» (`args` отсутствует) и «аргументов нет» (`args: []`) обязано сохраняться — на нём построены две ветки генерации сигнатуры.
- Эмиттеры не касаются файловой системы; запись, создание каталогов, `<out>/manifest.json` и коды выхода — только в `cli.ts`.
- Спецификатор `'./schemas'` в сгенерированном коде собран из двух литералов (`"./" + "schemas"`), чтобы post-build монорепо не принял его за относительный импорт самого пакета `@aom-js/codegen` (`scripts/post-build.js`).
- `collect` требует живой шины и одного `structureCollector` на транспорт; для тестов достаточно подставить объект с одним методом (`CollectSource`).
- Сгенерированный код зависит на стороне потребителя от `@aom-js/transfer`, `@aom-js/schemer` и модуля `config.transferImport`; сам пакет эти зависимости не проверяет.
- `foldSchemas` на стороне узла-издателя применяет пользовательские декораторы к временным классам (см. `packages/schemer/readme.md`) — это цена свёртки, а не codegen, но влияет на то, какие декораторы вообще могут попасть в `descriptor.schemas`.

### Известные дефекты (закрыты)

> ✅ `KI-CODEGEN-01` (закрыт): прежняя функция обратного разбора JSON Schema в `PropertySchema.*` падала на любой схеме вне узкого словаря скаляров (`format: uuid`, `oneOf`, `enum`) и теряла `integer`/ограничения. Заменена собственным форматом свёртки/развёртки — `descriptor.schemas` (`FoldedSchemas`), из которого классы восстанавливаются с исходными параметрами `PropertySchema.*`, без разбора JSON Schema. Модуль с прежней функцией удалён из пакета вместе с ней.
> Evidence: удаление — модуля разбора в `packages/codegen/src/defines/` нет; замена — `packages/codegen/src/defines/emit-schemas.ts`; формат — `packages/schemer/src/defines/folding.ts`; сквозной тест — `packages/codegen/test/roundtrip.test.ts` («сгенерированные классы после import(): foldSchemas и render совпадают с исходными») (классы фикстуры → дескриптор → генерация → `import()` → `foldSchemas`/`render` `toEqual` с исходником).

> ✅ `KI-CODEGEN-02` (закрыт): `dist/cjs/cli.js` не получал бит `+x`, `check` не замечал сервисы, пропавшие из снапшота, `serviceDirName("HTTPService")` не расставлял дефис на границе аббревиатуры (`→ "httpservice"`).
> Evidence: `chmod 0o755` для всех `pkg.bin` — `main/scripts/post-build.js` (комментарий на `KI-CODEGEN-02`), проверено на диске (`dist/cjs/cli.js` — `-rwxr-xr-x`); `removed` в `CheckResult`/`diffManifest` — `packages/codegen/src/defines/check.ts`, тест `packages/codegen/test/emit.test.ts` («удалён: сервис есть в manifest, но пропал из снапшота»); аббревиатура — `packages/codegen/src/defines/emit.ts` (`serviceDirName`), тест `packages/codegen/test/emit.test.ts` («serviceDirName разбивает аббревиатуру и следующее слово (KI-CODEGEN-02)» — `HTTPService → http-service`).

> ✅ `KI-CODEGEN-03` (закрыт): сгенерированный `schemas.ts` падал при импорте (`Cannot access 'X' before initialization`), если свойство `Type` ссылалось на класс, объявленный ниже по файлу — TS эмитит `design:type` как значение, вычисляемое немедленно.
> Evidence: `type Ref<T> = T` + ленивая ссылка `() => X` вместо прямого имени класса — `packages/codegen/src/defines/emit-schemas.ts` (`emitSchemas`, `renderValue`, `tsType`); тест на цикл `A↔B` (оба направления ссылаются друг на друга) — `packages/codegen/test/emit.test.ts` («цикл Type A↔B: обе стороны — Ref<> и ленивая ссылка () => X, независимо от порядка объявления»); в сквозном тесте — `packages/codegen/test/fixtures/roundtrip-service.ts` (`NodeA`/`NodeB`).

Связанный дефект в `@aom-js/schemer`, устранённый в той же волне, — `KI-SCHEMER-08` (`SCALAR_TYPE_SCHEMAS.date` и конструктор `Date` дают форму `oneOf`, которую рендерит `PropertySchema.Date`; подробности — `packages/schemer/readme.md`).

## Легаси и мёртвый код

Закомментированного и отвергнутого кода в пакете нет: все файлы `src/` участвуют в сборке, все экспорты `index.ts` достижимы. `safe.ts` не реэкспортируется намеренно — это внутренняя граница, а не публичный API. Единственный «недостижимый» элемент — сам пакет: его не импортирует ни ядро, ни приложение.

## Как использует приложение

Не использует. Симлинк `test/node_modules/@aom-js/codegen` (и `node_modules/.bin/aom-codegen`) есть, как у всех пакетов ядра — установка линкует каждый `main/packages/*` (`test/README.md#запуск-с-нуля`), но импортов `@aom-js/codegen` в `test/src/**` нет, в `dependencies` приложения пакет не объявлен.

Материала для генерации в приложении тоже нет: изоляторы модулей (`test/src/modules/{files,notifications,tickets}/isolators/`) объявлены `@Isolator(transfer)` без опции `{ distributed: true }` и без `@TopicSchema` на методах — их контракты в реестр шины (`transfer.registryMap`) не попадают и дескрипторов не порождают.

`test/src/modules/files/isolators/files.ts` (`FilesIsolator.MakePreview`)

```ts
@Isolator(transfer)
export class FilesIsolator {
  @ResponseTopic(true)
  static async MakePreview(fileId: string): Promise<FileType> {
    return <any>void 0;
    //
  }
```

Чтобы пакет стал применим, изоляторам приложения нужны `@TopicSchema` на методах и `@Isolator(transfer, { distributed: true })` на классе — паттерн изоляторов приложения описан в `test/docs/principles.md` §«Изоляторы и исполнители», механика дескрипторов — в `packages/transfer/readme.md`.

## Сборка и потребление

Сборка стандартная для монорепо: `bun run build:codegen` (он же `bun --filter @aom-js/codegen build`) — три прохода `tsc` (cjs → mjs → types) и `scripts/post-build.js`, который дописывает расширение `".js"` к относительным импортам в `dist`, кладёт `dist/cjs/package.json` с `{"type":"commonjs"}` и выставляет `chmod 0o755` на файлы из `pkg.bin`. Итоговый `package.json` и `tsconfig.build*.json` генерирует `scripts/prebuild.js` из `package.src.json`; редактировать нужно `package.src.json`, а не `package.json`.

## Тесты

### Что покрыто

- `packages/codegen/test/collect.test.ts` — снапшот реестра: три ответа от разных узлов, LWW по имени, сортировка результата; ответ после таймаута в снапшот не попадает.
- `packages/codegen/test/emit.test.ts` (`describe("codegen: восстановление сервиса из дескриптора")`) — `emitService` на рукописном дескрипторе `GoodsService`: состав файлов, перенос `hash`, `serviceDirName`; DTO с `@ComponentSchema`/`.String/.Type/.Date`, `isOptional` и `?`, `Ref<T>` для forward-ссылки на класс ниже по файлу, сквозной `description`; `$validator` (`IsUUID`) с импортом; изолятор — импорты, `<Name>Hash`, `@TopicSchema` с именованными аргументами, `@ResponseTopic(true)`, `@IsQueue()`, массивы `[T]`/`T[]`, `distributed` не переносится; три состояния метода (описан, `args: []`, не описан); сервис без компонент.
- `packages/codegen/test/emit.test.ts` (`describe("codegen: emitSchemas — enum, extends, mapped-types")`, `describe("codegen: emitSchemas — nullable, числовой enum, цикл Type")`) — `emitSchemas`: `enum` (строковый и числовой, `enumName`), топологический порядок `extends`, `PickType`/`IntersectionType(A, PartialType(B))` со вложенной композицией, параметры `@ComponentSchema`, несколько `$validator`+`$regexp` на одном свойстве, `nullable → "| null"`, цикл `Type` A↔B независимо от порядка объявления.
- `packages/codegen/test/emit.test.ts` (`describe("codegen: emitSchemas — ошибки формата")`) — ошибки формата: дескриптор без `schemas` при непустых `components`, дескриптор без `schemas` и без `components` (не ошибка), неизвестный `format`.
- `packages/codegen/test/emit.test.ts` (`describe("codegen: граница «данные шины → код» — недоверенные данные не становятся кодом")`) — вся граница безопасности: недопустимые имена (компонент/enum/сервис/метод/аргумент), `extends`/`$ref`/`$enum` вне компонентов дескриптора, неизвестная фабрика свойства, весь спектр проверок `$validator` (исполняемый код, синтаксически валидный, но не экспорт, экспорт, но не декоратор, настоящие фабрики), поддельное значение `enum`, `serviceDirName` (traversal/пустое имя/коллизия при разном регистре), `origin` с переводом строки, «неудобное», но допустимое имя свойства, `$regexp` (форма/флаги/компилируемость), `__proto__` как ключ параметра и как ключ `enum`, `planGeneration` (коллизия каталога, один сломанный дескриптор, `null`-запись в снапшоте), сквозной HIGH-сценарий аудитора (`Date extends Function` + `$date`), имя сервиса против собственных импортов изолятора и против `<Имя>Hash`.
- `packages/codegen/test/emit.test.ts` (`describe("codegen: check — сверка снапшота с manifest (KI-CODEGEN-02)")`) — `diffManifest`: дрейф, «не сгенерирован», «удалён», совпадение.
- `packages/codegen/test/roundtrip.test.ts` — сквозной тест на фикстуре из 10 компонентов и 2 `enum` (наследование, `IsUUID`, `Date` nullable, циклы `Type`, все mapped-types, `Transform`): дескриптор несёт `schemas` формата 1 со всеми классами; повторный `emitService` на том же дескрипторе идемпотентен; `Transform` молча пропадает при свёртке; сгенерированные классы после `import()` дают `foldSchemas`/`render`, побитово совпадающие с исходными (эталон снят **до** генерации, чтобы совпадающие имена классов в одном процессе не давали ложный успех через общие метаданные `class-validator`).

### Expected-fail

`it.fails`-тестов в пакете нет.

### Пробелы

- CLI не покрыт напрямую (`flags`, `collectCommand`) — только `planGeneration`/`diffManifest`, которые CLI вызывает.
- Нет теста на `transferExportName` в импорте транспорта.
- Ни один тест не грузит `dist` — vitest ходит по `src` через алиас `@aom-js/codegen` (`vitest.config.ts`), кроме `roundtrip.test.ts`, который импортирует уже сгенерированный `__generated__/…/schemas.ts` напрямую по файловому пути (не через алиас пакета).
- Нет явного детектора ReDoS для `$regexp` — сознательное решение автора, см. §«Ограничения».

### Как запускать

```bash
bunx vitest run packages/codegen
```

## Ограничения

- **ReDoS.** `$regexp` из чужого дескриптора проверяется по форме (`[string, string]`), флагам (`^[dgimsuvy]*$` без повторов) и реальной компилируемостью (`new RegExp(source, flags)` на этапе генерации), но не по катастрофическому бэктрекингу источника — паттерн вида `(a+)+$` пройдёт все проверки и создаст `RegExp`, который зависнет на подходящей строке уже у потребителя, при валидации данных. Осознанно не реализовано: надёжно отличить безопасный regexp от катастрофического без эвристик нельзя, а эвристики дают ложные срабатывания.
- **Захват каталога сервиса.** Чужой узел, опубликовавший сервис с именем, которое даёт тот же `serviceDirName`, что и легитимный сервис (совпадение после разбиения по регистру/подчёркиванию), блокирует генерацию **обоих** — `planGeneration` возвращает ошибку с обоими именами и не пишет ни один из файлов. Это шумный отказ генерации, а не тихая подмена: `<out>/manifest.json` не получает запись ни для одного из двух сервисов, и последующий `check` честно сообщит «не сгенерирован» для обоих.
- **Происхождение дескриптора не проверяется.** Шина принимает дескрипторы без проверки источника (`acceptRegistry` в `@aom-js/transfer` не сверяет подпись/`origin`); узел, опубликовавший сервис с тем же именем и тем же контрактом (тем же `hash`), неотличим от легитимного издателя ни для `collect`, ни для `check` — `hash` защищает от дрейфа контракта, а не от подмены источника. Это граница ответственности транспортного слоя, а не codegen.
- **Mapped-класс нельзя использовать напрямую как компонент распределённого сервиса.** И `SchemasCollector`, и `foldSchemas` требуют, чтобы у класса, участвующего в `components`, было собственное имя — анонимный результат `PickType(...)`/`PartialType(...)`/… нужно обернуть именованным наследником с `@ComponentSchema()` (тот же паттерн, что уже требуется для рендера OpenAPI, см. `packages/schemer/readme.md`, `KI-SCHEMER-07`).

## Расхождения с историческими заметками

| Заметка                                          | Утверждение                                                                                                                                                                | Фактически                                                                                                                                                                                                                                 | Evidence                                                                                                                                                                                                                   |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/codegen.md` (старая заметка)               | Кодогенерация должна уметь работать и с API — «карты методов» для стандартных процедур                                                                                     | Реализованы только схемы и дескрипторы шины; маршрутов и OpenAPI пакет не касается                                                                                                                                                         | `packages/codegen/src/index.ts`                                                                                                                                                                                            |
| Предыдущая версия этого `readme.md`              | Прежняя функция обратного разбора JSON Schema — публичный экспорт пакета; `@JSONSchema`-фолбэк для непереносимых ключей — планируемая доработка                            | Функция удалена вместе с породившим её модулем; идея фолбэка снята вместе с целым подходом — параметры фабрик теперь хранятся как есть, терять там нечего                                                                                  | `packages/codegen/src/defines/emit-schemas.ts` (маркеров `dropped` и комментариев-заглушек codegen в нём нет)                                                                                                                                             |

## Открытые вопросы

> ❓ Открытый вопрос: где предполагается запускать CLI у потребителя — в приложении `aom-codegen` доступен только через `bun link` (`node_modules/.bin/aom-codegen`), в ядре `bin` не слинкован; нужна ли команда-обёртка в `test/package.json`?

> ❓ Открытый вопрос: стоит ли `$regexp` из недоверенного дескриптора всё же получить грубый детектор катастрофического бэктрекинга (лимит длины источника или запрет вложенных квантификаторов), раз ReDoS остаётся единственным непроверяемым сценарием на этой границе?

> ❓ Открытый вопрос: `acceptRegistry` (`@aom-js/transfer`) не проверяет происхождение дескриптора — стоит ли решать это на уровне транспорта (подпись/allowlist `origin`) или это осознанно оставлено на усмотрение адаптера шины конкретного приложения?
