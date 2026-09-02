# @aom-js/codegen

Пакет восстанавливает исходники aom-классов (компонент-схемы и изолятор) из дескриптора сервиса (`TransferServiceDescriptor`), собранного шиной. Состояние на 2026-09-02 — черновик версии `0.0.1`: приложением не используется, симлинка `test/node_modules/@aom-js/codegen` нет, `bin` нигде не слинкован.
Читать до: `packages/transfer/readme.md` (дескриптор и дистрибуция), `packages/schemer/readme.md` (`PropertySchema`, `SCALAR_TYPE_SCHEMAS`). Читать после: `main/docs/architecture.md` §«Сборка, тесты…». Термины — `test/docs/README.md#словарь`.

## Назначение и место в стеке

Кодогенерация (`collect / inverseSchema / emitSchemas / emitIsolator / emitService`, CLI `aom-codegen`) решает обратную задачу к дистрибуции изоляторов: транспорт публикует по шине сериализуемый контракт (`@IsDistributed` → `TransferServiceDescriptor`), а пакет превращает его обратно в TypeScript — DTO с `@ComponentSchema`/`@PropertySchema.*` и класс-изолятор с `@Isolator`/`@ResponseTopic`/`@CustomTopic`/`@IsQueue`/`@TopicSchema`. Потребитель получает типизированного клиента чужого сервиса, не импортируя его исходники. Рантайм-альтернатива без генерации — `Transfer.restore(descriptor)` (`packages/transfer/src/defines/main.ts:152-185`).

Зависимости — только `@aom-js/transfer` (типы дескриптора) и `@aom-js/schemer` (словарь скаляров `SCALAR_TYPE_SCHEMAS`), см. `packages/codegen/package.src.json:18-21`. Обратных зависимостей нет: ни один пакет ядра codegen не импортирует. Полный граф пакетов — в `main/docs/architecture.md`. Протокол дистрибуции (кто и когда публикует дескрипторы, кэш реестра, LWW по hash) описан в `packages/transfer/readme.md`; здесь — только контракт чтения.

Разделение ответственности жёсткое: все функции пакета чистые (дескриптор → строки), файловой системой занимается исключительно CLI (`packages/codegen/src/defines/emit.ts:9-18`, `packages/codegen/src/cli.ts:62-79`).

## Публичный API

Экспортируется всё из `src/defines/*`, кроме `cli.ts` — CLI в `index.ts` не реэкспортируется (`packages/codegen/src/index.ts:1-6`).

| Экспорт | Сигнатура | Назначение | Используется приложением |
|---|---|---|---|
| `collect` | `collect(source: CollectSource, timeoutMs = 3000): Promise<TransferServiceDescriptor[]>` | Снапшот реестра шины за таймаут; LWW по имени, результат отсортирован | нет |
| `CollectSource` | `{ collectDistributions(handler: StructureCollectorFunction): void }` | Минимальная часть `Transfer`, нужная для сбора (подстановка в тестах) | нет |
| `inverseSchema` | `inverseSchema(schema: Record<string, any>): InversedSchema` | JSON Schema свойства → фабрика `PropertySchema.*`, TS-тип, параметры; бросает на неизвестной схеме | нет |
| `InversedSchema` | `{ factory: 'String'\|'Number'\|'Boolean'\|'Date'\|'Type'; ref?; isArray?; tsType; params; dropped }` | Разбор одного свойства компонента | нет |
| `refName` | `refName(ref: string): string` | Хвост `$ref` после последнего `/` | нет |
| `scalarNameOf` | `scalarNameOf(schema: Record<string, any>): string \| undefined` | Имя скаляра по точному совпадению `{type, format}` со словарём schemer | нет |
| `emitSchemas` | `emitSchemas(descriptor: TransferServiceDescriptor): string \| undefined` | `components` → исходник `schemas.ts`; `undefined`, если компонент нет | нет |
| `emitIsolator` | `emitIsolator(descriptor: TransferServiceDescriptor, config: CodegenConfig): string` | `methods` → исходник `isolator.ts` | нет |
| `emitService` | `emitService(descriptor: TransferServiceDescriptor, config: CodegenConfig): EmittedService` | Генерация одного сервиса: `schemas.ts?` + `isolator.ts` | нет |
| `serviceDirName` | `serviceDirName(name: string): string` | `GoodsService` → `goods-service` | нет |
| `CodegenConfig` | `{ transferImport: string; transferExportName?: string }` | Откуда сгенерированный изолятор берёт настроенный транспорт | нет |
| `EmittedFile` | `{ path: string; source: string }` | Один сгенерированный файл | нет |
| `EmittedService` | `{ name: string; hash: string; files: EmittedFile[] }` | Результат генерации сервиса | нет |
| `TransferServiceDescriptor` | `export type { TransferServiceDescriptor } from "@aom-js/transfer"` | Реэкспорт типа дескриптора | нет |
| `aom-codegen` | `aom-codegen collect\|generate\|check --flag value …` | CLI (`bin`, не экспортируется из `index.ts`) | нет |

Evidence: `packages/codegen/src/defines/types.ts:4-29`, `packages/codegen/src/defines/collect.ts:5-28`, `packages/codegen/src/defines/inverse.ts:24-81`, `packages/codegen/src/defines/emit-schemas.ts:9-22`, `packages/codegen/src/defines/emit-isolator.ts:22-63`, `packages/codegen/src/defines/emit.ts:9-23`, `packages/codegen/package.src.json:15-17`.

## Внутренние модули

| Файл | Ответственность | Ключевые символы |
|---|---|---|
| `packages/codegen/src/index.ts` | Реэкспорт `defines/*`; `cli.ts` не включён | — |
| `packages/codegen/src/defines/types.ts` | Типы конфигурации и результата; реэкспорт типа дескриптора | `CodegenConfig`; `EmittedFile`; `EmittedService` |
| `packages/codegen/src/defines/collect.ts` | Снапшот реестра шины по таймауту | `CollectSource`; `collect` |
| `packages/codegen/src/defines/inverse.ts` | Обратные правила JSON Schema → `PropertySchema` | `inverseSchema`; `scalarNameOf`; `refName`; `withPassthrough`; `PASSTHROUGH_KEYS`; `CONSUMED_KEYS`; `SCALAR_FACTORIES` |
| `packages/codegen/src/defines/emit-schemas.ts` | `components` → текст `schemas.ts` | `emitSchemas`; `emitComponent`; `paramsSource` |
| `packages/codegen/src/defines/emit-isolator.ts` | `methods` → текст `isolator.ts`, импорты и сигнатуры | `emitIsolator`; `emitMethod`; `typeSource`; `tsOf`; `collectRefs`; `SCALAR_TS`; `SCHEMAS_MODULE` |
| `packages/codegen/src/defines/emit.ts` | Сборка файлов сервиса; имя каталога | `emitService`; `serviceDirName` |
| `packages/codegen/src/cli.ts` | CLI: разбор флагов, чтение/запись файлов, `manifest.json`, коды выхода | `flags`; `required`; `collectCommand`; `generateCommand`; `checkCommand`; `manifestPath`; `USAGE` |
| `packages/codegen/test/collect.test.ts` | 2 теста `collect` (LWW, сортировка, поздний ответ) | — |
| `packages/codegen/test/emit.test.ts` | 5 тестов `emitService` на рукописном дескрипторе `GoodsService` | — |
| `packages/codegen/package.src.json` | Исходный `package.json` (`bin`, зависимости); итоговый генерирует `scripts/prebuild.js` | `bin.aom-codegen` |

## Ключевые механизмы

### Снапшот реестра (collect)

`collect` подписывает свой обработчик через `source.collectDistributions(...)`, складывает пришедшие дескрипторы в `Map` по `name` (последний ответ побеждает) и по истечении `timeoutMs` резолвит массив, отсортированный `localeCompare`. Завершения у опроса нет — узлы отвечают кто когда успел, поэтому граница ставится по времени; значение, не являющееся массивом, игнорируется.

`packages/codegen/src/defines/collect.ts:19-28`

```ts
return new Promise((resolve) => {
  const byName = new Map<string, TransferServiceDescriptor>();
  source.collectDistributions((data) => {
    const descriptors: TransferServiceDescriptor[] = Array.isArray(data.value) ? data.value : [];
    descriptors.forEach((descriptor) => byName.set(descriptor.name, descriptor));
  });
  setTimeout(() => {
    resolve([...byName.values()].sort((a, b) => a.name.localeCompare(b.name)));
  }, timeoutMs);
});
```

Со стороны транспорта `collectDistributions` запоминает **один** `structureCollector` и публикует запрос в топик реестра (`packages/transfer/src/defines/main.ts:189-200`); ответы приходят в `acceptRegistry` и дополнительно кэшируются в `registryMap` узла. Поэтому повторный `collect` на том же `Transfer` перезаписывает обработчик предыдущего, а после резолва подписка не снимается.

Evidence: `packages/codegen/src/defines/collect.ts:15-28`; `packages/transfer/src/defines/main.ts:189-200, 220-241`; `packages/codegen/test/collect.test.ts:12-41`.

### Обратные правила JSON Schema → PropertySchema (inverseSchema)

`inverseSchema` разбирает схему одного свойства: `$ref` → фабрика `Type` со ссылкой, `array` + `items` → рекурсия с `isArray: true`, иначе — поиск скаляра по **точному** совпадению пары `{type, format}` со словарём `SCALAR_TYPE_SCHEMAS` схемера (`packages/schemer/src/defines/collector.ts:12-18`). Всё, что не опознано, приводит к `throw` (`packages/codegen/src/defines/inverse.ts:80`). Сквозные ключи переносятся в параметры фабрики, остальные — в `dropped` и далее в комментарий `TODO(codegen)` сгенерированного кода (`packages/codegen/src/defines/emit-schemas.ts:39-41`).

| Вход | Фабрика | params | dropped |
|---|---|---|---|
| `{$ref: ".../GoodDto"}` | `Type` | `value: () => GoodDto` (фрагмент) | — |
| `{type: "array", items: X}` | фабрика `X` | `isArray: true` (фрагмент) | вложенный массив → `items (nested array)` |
| `{type: "string"}` | `String` | — | — |
| `{type: "number"}` / `{type: "integer"}` | `Number` | — | `integer` теряется |
| `{type: "boolean"}` | `Boolean` | — | — |
| `{type: "string", format: "date-time"}` | `Date` | — | — |
| `description` / `deprecated` / `nullable` / `default` / `examples` | — | переносятся как есть | — |
| свойство вне `required` | — | `isOptional: true` | — |
| `minLength`, `pattern`, `enum`, `maximum`, … | — | — | в `TODO(codegen)` |
| `{type: "string", format: "uuid"}`, `{oneOf: [...]}`, объект без `$ref` | — | — | `throw` |

Evidence: `packages/codegen/src/defines/inverse.ts:9-21, 57-92`; `packages/codegen/src/defines/emit-schemas.ts:24-51`; `packages/schemer/src/defines/collector.ts:12-18`.

### Восстановление изолятора (emitIsolator)

`emitMethod` разворачивает поля дескриптора обратно в декораторы: `waitForResponse` выбирает `@ResponseTopic`/`@CustomTopic`, `singleton` становится их аргументом `true`, `queue` даёт `@IsQueue()`. Наличие поля `args` (а не его длина) отличает описанный метод от неописанного: с `args` восстанавливаются `@TopicSchema` и именованная сигнатура, без `args` — `(...args: unknown[])` без декоратора схемы. Тип возврата: `Promise<T>` по `returns`, иначе `Promise<unknown>` при `waitForResponse` и `Promise<void>` без него; тело — `return undefined as never`.

`packages/codegen/src/defines/emit-isolator.ts:93-100`

```ts
const returns = method.returns
  ? `Promise<${tsOf(method.returns)}>`
  : method.waitForResponse
    ? "Promise<unknown>"
    : "Promise<void>";

lines.push(`  static async ${method.name}(${params}): ${returns} {`);
lines.push(`    return undefined as never;`);
```

Набор импортов из `@aom-js/transfer` вычисляется по фактически нужным декораторам, импорт транспорта — `default` либо именованный по `config.transferExportName`, импорт DTO добавляется только при наличии `$ref`-ов. `@IsDistributed` не генерируется сознательно: потребитель собрал бы дескриптор с собственным `origin` и отравил реестр. `hash` дескриптора зашивается константой `<Name>Hash`, имя класса переносится дословно — из него транспорт выводит топики.

Evidence: `packages/codegen/src/defines/emit-isolator.ts:22-63, 65-103, 106-126`; `packages/codegen/test/emit.test.ts:92-111`.

### CLI и manifest

`aom-codegen` принимает команду и пары `--key value`; булевых флагов нет, нечётное число аргументов — ошибка с текстом справки (`packages/codegen/src/cli.ts:21-30`). `collect` динамически импортирует модуль с настроенным транспортом, снимает снапшот и завершает процесс `process.exit(0)` — живые подписки шины иначе удерживают event loop. `generate` пишет `<out>/<kebab-имя>/{schemas.ts,isolator.ts}` и `<out>/manifest.json` вида `{имя: hash}`. `check` сравнивает снапшот с манифестом и при расхождении (`drift`) или отсутствии записи (`not generated`) печатает в stderr и выходит с кодом 1.

```bash
aom-codegen collect  --transfer-module <путь к модулю с Transfer> --out descriptors.json
aom-codegen generate --from descriptors.json --out <каталог> --transfer "<module specifier>"
aom-codegen check    --from descriptors.json --out <каталог>
```

Evidence: `packages/codegen/src/cli.ts:10-19, 47-60, 62-79, 81-94`.

## Инварианты и подводные камни

- Имя класса изолятора и имена компонент переносятся дословно: топики выводятся из имени (`${Class}.${method}`), а `$ref`-имена — из `target.name`; переименование ломает адресацию (`packages/codegen/src/defines/emit-isolator.ts:55-58`; формула топика — `packages/transfer/src/defines/decorators.ts:192-193`; `$ref` по `target.name` — `packages/schemer/src/defines/collector.ts:62,70`).
- Различие «метод не описан» (`args` отсутствует) и «аргументов нет» (`args: []`) обязано сохраняться: на нём построены две разные ветки генерации (`packages/transfer/src/defines/types.ts:144-149`; `packages/codegen/src/defines/emit-isolator.ts:71-91`).
- Эмиттеры не касаются файловой системы; запись, создание каталогов и коды выхода — только в `cli.ts`.
- Спецификатор `'./schemas'` в сгенерированном коде собран из двух литералов (`"./" + "schemas"`) — защитная мера, объявленная комментарием `packages/codegen/src/defines/emit-isolator.ts:4-5`. Регексп `SPEC` в post-build ловит спецификатор только сразу после `from`/`import(`/`require(` (`scripts/post-build.js:33`), поэтому одиночная константа под него не попадала бы; риск реален лишь для литерала, вписанного прямо в шаблон строки импорта. На неразрешимом спецификаторе post-build не переписывает путь, а валит сборку (`scripts/post-build.js:55-58, 67-71`).
- `collect` требует живой шины и одного `structureCollector` на транспорт; для тестов достаточно подставить объект с одним методом (`CollectSource`).
- Сгенерированный код зависит на стороне потребителя от `@aom-js/transfer`, `@aom-js/schemer` и модуля `config.transferImport`; сам пакет эти зависимости не проверяет.

### Известные дефекты

> ⚠️ Дефект: `inverseSchema` бросает на любой схеме свойства, чья пара `{type, format}` не совпала со словарём скаляров, поэтому генерация сервиса падает целиком вместо пометки `TODO`.
> Evidence: `packages/codegen/src/defines/inverse.ts:75-80`; словарь — `packages/schemer/src/defines/collector.ts:12-18`; те же исключения бросают `typeSource` и `tsOf` на схемах аргументов и возврата: `packages/codegen/src/defines/emit-isolator.ts:111, 120`. Проверено: свойство `@PropertySchema.Date({})` рендерится схемером как `{oneOf: [{type:"string",format:"date"},{type:"string",format:"date-time"}]}` (конвертер `IS_DATE` в `class-validator-jsonschema`), то есть реальный компонент с датой в `inverseSchema` не проходит; в тестах используется рукописный дескриптор с `{type:"string",format:"date-time"}`.
> Последствия: `format: "uuid"`, `oneOf` и объект без `$ref` дают исключение, и генерация сервиса падает целиком. Смежная, противоположная по политике потеря: `integer` восстанавливается как `PropertySchema.Number` (тип теряется), а `enum`-свойство (рендер `{enum:[...], type:"string"}`) молча деградирует до `.String({})` с комментарием `TODO(codegen): не перенесено: enum` — фабрики `Enum` в `SCALAR_FACTORIES` нет. Заявленный в `docs/isolators.md:274` критерий `render ∘ restore = identity` не выполняется и не проверяется ни одним тестом.
> Как обходить: описывать изолированные методы через `@TopicSchema` скалярами и компонент-классами простой формы; перед генерацией проверять `components` дескриптора на `oneOf`/`format`. Первопричина случая с датой — рассинхрон: словарь `SCALAR_TYPE_SCHEMAS` объявляет `date` как `{type: "string", format: "date-time"}` (`packages/schemer/src/defines/collector.ts:17`), а `Schemer.render` отдаёт `IsDate` через конвертер по умолчанию `class-validator-jsonschema`, то есть `oneOf` (`packages/schemer/src/defines/module.ts:37-42`). См. `KI-CODEGEN-01` и `KI-SCHEMER-08` в `test/docs/known-issues.md`, а также `packages/schemer/readme.md`.

> ⚠️ Дефект: CLI не доведён до запускаемого состояния и не замечает исчезнувшие сервисы.
> Evidence: `bin` объявлен как `./dist/cjs/cli.js` (`packages/codegen/package.src.json:15-17`), но симлинка `node_modules/.bin/aom-codegen` нет ни в ядре, ни в приложении, а у собранного `dist/cjs/cli.js` нет бита `+x` при сохранённом shebang (`packages/codegen/src/cli.ts:1`); `checkCommand` строит `drifted`/`missing` только по элементам снапшота (`packages/codegen/src/cli.ts:88-92`), лишние записи манифеста не проверяются; `serviceDirName` вставляет дефис только между `[a-z0-9]` и `[A-Z]`, поэтому `HTTPService → httpservice` (`packages/codegen/src/defines/emit.ts:21-23`).
> Последствия: запуск возможен только явной командой (`bun packages/codegen/src/cli.ts …` или `node packages/codegen/dist/cjs/cli.js …`); `collect` с TypeScript-модулем транспорта работает только под bun — `import()` в node потребует скомпилированный модуль (`packages/codegen/src/cli.ts:18, 50`); удалённый из реестра сервис остаётся в `manifest.json` и `check` его не замечает.
> Как обходить: вызывать CLI по явному пути; после удаления сервиса чистить `manifest.json` вручную. См. `KI-CODEGEN-02` в `test/docs/known-issues.md`.

### Легаси и мёртвый код

Закомментированного и отвергнутого кода в пакете нет: все файлы `src/` участвуют в сборке, все экспорты `index.ts` достижимы. Единственный «недостижимый» элемент — сам пакет: его не импортирует ни ядро, ни приложение.

## Как использует приложение

Не использует. В `test/node_modules/@aom-js/` есть симлинки на `core`, `schemer`, `router`, `transfer`, `api`, `holder`, но не на `codegen`; импортов `@aom-js/codegen` в `test/src/**` нет, в `dependencies` приложения пакет не объявлен.

Материала для генерации в приложении тоже нет: изоляторы модулей (`test/src/modules/{files,notifications,tickets}/isolators/`) объявлены без `@TopicSchema` и без `@IsDistributed`, то есть их контракты в реестр шины не попадают и дескрипторов не порождают.

`test/src/modules/files/isolators/files.ts:9-15`

```ts
@Isolator(transfer)
export class FilesIsolator {
  @ResponseTopic(true)
  static async MakePreview(fileId: string): Promise<FileType> {
    return <any>void 0;
    //
  }
```

Чтобы пакет стал применим, изоляторам приложения нужны `@TopicSchema` на методах и `@IsDistributed` на классе — паттерн изоляторов приложения описан в `test/docs/principles.md` §«Изоляторы и исполнители», механика дескрипторов — в `packages/transfer/readme.md`.

## Сборка и потребление

Сборка стандартная для монорепо: `bun run build:codegen` (он же `bun --filter @aom-js/codegen build`, `package.json:24`) — три прохода `tsc` (cjs → mjs → types) и `scripts/post-build.js`, который дописывает `.js` к относительным импортам в `dist` и кладёт `dist/cjs/package.json` с `{"type":"commonjs"}`. Итоговый `package.json` и `tsconfig.build*.json` генерирует `scripts/prebuild.js` из `package.src.json`; редактировать нужно `package.src.json`, а не `package.json`. Полная схема — в `main/docs/architecture.md` §«Сборка, тесты…».

Приложение исполняет `dist` пакетов через симлинки, поэтому правки `src` не видны приложению без `bun run build`. Для codegen это пока умозрительно: симлинка на пакет в приложении нет. На диске `dist/` датирован 25 августа и новее исходников (12 августа, коммит `2b6f132`) — то есть собран после последней правки `src`.

Незакоммиченных правок в пакете нет, состояние на диске = HEAD ядра (в `git status` по `packages/codegen` числится только этот `readme.md` как новый файл; последний коммит пакета — `2b6f132`). Список незакоммиченных файлов других пакетов — в `main/docs/architecture.md` §«Состояние рабочего дерева».

## Тесты

### Что покрыто

- `packages/codegen/test/collect.test.ts:12-41` — снапшот реестра: три ответа от разных узлов, LWW по имени, сортировка результата; ответ после таймаута в снапшот не попадает.
- `packages/codegen/test/emit.test.ts:66-120` — `emitService` на рукописном дескрипторе `GoodsService`: состав файлов и перенос `hash`, `serviceDirName`; в `schemas.ts` — `@ComponentSchema`, `.String/.Type/.Date`, `isOptional` и `?`, сквозной `description`, комментарий `TODO(codegen)` для `minLength`; в `isolator.ts` — импорты, `<Name>Hash`, `@TopicSchema` с именованными аргументами, `@ResponseTopic(true)`, `@IsQueue()`, массивы `[T]`/`T[]`, отсутствие `IsDistributed`; три состояния метода (описан, `args: []`, не описан) и сервис без компонент.

### Expected-fail

`it.fails`-тестов в пакете нет.

### Пробелы

- CLI не покрыт вовсе: `flags`, `generate`, `check`, `manifest.json`, коды выхода.
- `inverseSchema` не тестируется напрямую: ветки `throw`, вложенный массив, сквозные `nullable`/`default`/`examples`/`deprecated`, `integer`.
- Не покрыты ветка `transferExportName` в импорте транспорта, `throw` в `emitComponent` на не-object-схеме, `collect` с не-массивом в `value`.
- Нет identity-харнеса `render ∘ restore` (объявлен критерием приёмки в `docs/isolators.md:274`): тесты сверяют подстроки исходника, а не результат повторного рендера сгенерированного класса через `SchemasCollector`.
- Ни один тест не грузит `dist` — vitest ходит по `src` через алиас `@aom-js/codegen` (`vitest.config.ts:24`).

### Как запускать

```bash
bun run test -- packages/codegen
```

На 2026-09-02: 2 файла, 7 тестов, все проходят.

## Расхождения с историческими заметками

| Заметка | Утверждение | Фактически | Evidence |
|---|---|---|---|
| `docs/isolators.md:272` | Ключевые слова без параметра в `PropertySchema` (`pattern` и т. п.) сохраняются фолбэком `@JSONSchema({...})` | Фолбэка нет: такие ключи попадают в `dropped` и выводятся комментарием `TODO(codegen)`; тот же документ строками 264 и 298 признаёт это нереализованным | `packages/codegen/src/defines/inverse.ts:84-93`; `packages/codegen/src/defines/emit-schemas.ts:39-41` |
| `docs/isolators.md:274` | Критерий приёмки: прогон сгенерированного класса через `SchemasCollector` даёт те же `components` (`render ∘ restore = identity`) | Харнеса нет; `integer → Number`, потеря ограничений и `throw` на `oneOf`-схеме реального `Date`-свойства заведомо нарушают identity | `packages/codegen/src/defines/inverse.ts:15-21, 75-80`; `packages/codegen/test/emit.test.ts:78-90` |
| `docs/isolators.md:270` | Массив с `items.$ref` → `.Type({ value: () => X, isArray: true })` | Верно, но правило шире: массив скаляров даёт `.String({ isArray: true })` и т. п., а вложенный массив уплощается с пометкой `items (nested array)` в `dropped` | `packages/codegen/src/defines/inverse.ts:67-74`; `packages/codegen/src/defines/emit-schemas.ts:36-42` |
| `docs/codegen.md:3` | Кодогенерация должна уметь работать и с API — «карты методов» для стандартных процедур | Реализованы только схемы и дескрипторы шины; маршрутов и OpenAPI пакет не касается | `packages/codegen/src/index.ts:1-6` |
| `docs/isolators.md:256` | Скелет заложен 2026-08-12, `collect` под bun, CLI из трёх команд | Соответствует коду; расхождений нет, кроме перечисленных выше пунктов «не реализовано» | `packages/codegen/src/cli.ts:96-103`; коммит `2b6f132` |

Отдельного старого `readme.md` у пакета не было — файл создан этим документом.

## Открытые вопросы

> ❓ Открытый вопрос: генератор должен падать на неизвестной схеме (`format: uuid`, `oneOf`, `enum` без типа) или помечать свойство `TODO` и продолжать? Сейчас `inverseSchema` бросает, а `enum` со `type: "string"` молча теряется — две разные политики для похожих случаев.

> ❓ Открытый вопрос: когда планируются `@JSONSchema`-фолбэк для непереносимых ключей и identity-харнес `render ∘ restore`, оба объявленные в `docs/isolators.md:272,274`?

> ❓ Открытый вопрос: где предполагается запускать CLI у потребителя — `bin` не слинкован ни в ядре, ни в приложении; нужна ли команда-обёртка в `test/package.json`?

> ❓ Открытый вопрос: должен ли `check` сообщать о лишних записях `manifest.json` (сервис исчез из снапшота), или молчание здесь намеренное?
