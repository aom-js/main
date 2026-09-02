# @aom-js/schemer

Пакет описания DTO: компонент-схемы (`@ComponentSchema`), описания свойств (`PropertySchema.*`), mapped-types, рендер JSON Schema и сборщик `$ref`-каскада. Единственное место комплекта, где перечислены параметры фабрик свойств и набор библиотечных декораторов, который каждая фабрика навешивает.
Читать до: `packages/core/readme.md` (мета-класс, фазы, наследование метаданных). Читать после: `packages/router/readme.md` (сборка OpenAPI), `packages/api/readme.md` (билдеры и `SafeData`).
Состояние на 2026-09-02. Термины — `test/docs/README.md#словарь`. Реестр дефектов — `test/docs/known-issues.md`.

## Назначение и место в стеке

Пакет строит DTO-слой поверх трёх библиотек: `class-validator` (валидация), `class-transformer` (приведение и исключение полей), `class-validator-jsonschema` (рендер JSON Schema). Собственного рендерера у пакета нет; его вклад — декларативный слой над этими библиотеками на базе мета-класса `AomSchemas extends AomCore`. Класс помечается `@ComponentSchema(params?)`, свойства — фабриками `PropertySchema.String/Number/Boolean/Date/Enum/Any/Type({...})`. Каждая фабрика сохраняет «сырые параметры» (`$.schemaName`, `$.schemaParams`) в узле свойства и в фазе LAST навешивает набор библиотечных декораторов. Сырые параметры — то, ради чего слой существует: они позволяют пересобрать класс (mapped-types) и прочитать описание свойства извне (`ParamsBuilder` в `@aom-js/api`).

Зависимости: `@aom-js/core` (реестр метаданных и фабрики декораторов) + три перечисленные библиотеки. Потребители внутри ядра: `@aom-js/router` — `SchemasCollector` наполняет `components.schemas` документа OpenAPI (`packages/router/src/classes/openapi.ts:33-35, 199, 214-219`); `@aom-js/api` — `Schemer.validate` внутри `SafeData` и `Schemer.render` внутри `plainJsonSchema` (`packages/api/src/decorators/safe-data.ts:18-28`, `packages/api/src/functions/json-schema.ts:6-30`); `@aom-js/transfer` — сбор компонент в дескриптор изолятора (`packages/transfer/src/defines/decorators.ts:105-108`); `@aom-js/codegen` — обратное восстановление классов из JSON Schema, использует `SCALAR_TYPE_SCHEMAS` (`packages/codegen/src/defines/inverse.ts:1, 50-80`). Приложение использует только `ComponentSchema`, `PropertySchema` и четыре mapped-types; `Schemer`, `SchemasCollector`, `AomSchemas`, `SchemaTypes`, `SCALAR_TYPE_SCHEMAS` в `test/src` не встречаются ни разу.

Полный граф пакетов и схема сборки монорепо — `docs/architecture.md`.

## Публичный API

### Декораторы и фабрики

| Экспорт | Сигнатура | Назначение | Используется приложением |
|---|---|---|---|
| `ComponentSchema` | `ComponentSchema(params?: ClassDescriptionsProperties): ClassDecorator` | Помечает класс компонент-схемой: наследует метаданные родителя, вешает `JSONSchema({...params})` на класс, применяет отложенные `PropertySchema`, затем `params.decorators` | да (149 применений, 228 вхождений с импортами; напр. `test/src/modules/orgs/entities/postgres/Orgs/Orgs.ts:13`) |
| `PropertySchema` | `{ String(p: StringDescriptionsProperties): PropertyDecorator; Number(p); Boolean(p); Date(p); Enum<T>(p); Any(p); Type(p) }` | Семь фабрик описания свойства; ключи объекта — значения `SchemaTypes` | да (271 применение, 349 вхождений с импортами) |

### Классы

| Экспорт | Сигнатура | Назначение | Используется приложением |
|---|---|---|---|
| `Schemer` | `new Schemer(refPointerPrefix: string)`; `render(target): SchemaObject`; `validate<T>(ctor: T, data: object): { values, errors }` | Рендер JSON Schema класса с заданным префиксом `$ref` и валидация plain-данных | нет (через `@aom-js/api`) |
| `SchemasCollector` | `new SchemasCollector(schemer: Schemer)`; `readonly components: Map<string, any>`; `extract(schema: any): any` | Превращает компонент-класс в `{$ref}` и рекурсивно складывает рендеры связанных схем в `components` | нет |
| `AomSchemas` | `class AomSchemas extends AomCore { properties: Set<Property>; connections: Map<Property, ConnectionSchema>; isComponentSchema: boolean; schemaName?; schemaParams?; schemer: Schemer }` | Мета-класс схем; `AomSchemas.checkExists(Class)` — способ узнать, компонент ли класс, и прочитать сырые параметры | нет |

### Mapped-types

| Экспорт | Сигнатура | Назначение | Используется приложением |
|---|---|---|---|
| `PartialType` | `PartialType<T>(classRef: Type<T>): MappedType<RemoveFieldsWithType<Partial<T>, Function>>` | Новый компонент, все свойства исходного с `isOptional: true` | да (17 применений, напр. `test/src/modules/references/api/routes/currencies/init/schemas.ts:19-21`) |
| `PickType` | `PickType<T, K extends keyof T>(classRef: Type<T>, keys: readonly K[])` | Новый компонент только с выбранными свойствами | да (23 применения, напр. `test/src/modules/user/api/routes/profile/init.ts:8`) |
| `OmitType` | `OmitType<T, K extends keyof T>(classRef: Type<T>, keys: readonly K[])` | Новый компонент без указанных свойств | да (3 применения) |
| `IntersectionType` | `IntersectionType<T extends Type[]>(...classRefs: T)` | Объединение свойств нескольких компонент | да (5 применений, напр. `test/src/modules/tickets/api/routes/tickets/init/schemas.ts:26`) |
| `MappedType<T>` | `interface MappedType<T> extends Type<T> { new (): T }` | Тип результата mapped-types | нет |

### Типы и словари

| Экспорт | Сигнатура | Назначение | Используется приложением |
|---|---|---|---|
| `SchemaTypes` | `enum { STRING='String', DATE='Date', NUMBER='Number', BOOLEAN='Boolean', ENUM='Enum', ANY='Any', TYPE='Type' }` | Идентификаторы фабрик; они же ключи `PropertySchema` и значение `$.schemaName` | нет |
| `SCALAR_TYPE_SCHEMAS` | `Record<string, Record<string, any>>` — `string / number / integer / boolean / date` | Словарь скаляров по имени для `@TopicSchema` (transfer) и codegen | нет |
| `CommonDescriptionsProperties`, `ClassDescriptionsProperties`, `BaseDescriptionsProperties`, `ConnectionSchema` | `packages/schemer/src/defines/types.ts:4-27` | Типы параметров декораторов; `ConnectionSchema = () => ClassConstructor` | нет |

Не экспортируются, но важны: `IsNullable(opts)` и `decorateProperty(decorators, target, property)` из `packages/schemer/src/defines/helpers/` — `src/index.ts:1-9` их не реэкспортирует, поэтому `@aom-js/api` держит собственную дословную копию `IsNullable` (`packages/api/src/decorators/is-nullable.ts:3-11`). Интерфейсы параметров фабрик (`StringDescriptionsProperties` и остальные шесть) объявлены через `declare interface` внутри `properties.ts` и наружу тоже не выходят. `Type<T>` (`packages/schemer/src/defines/mapped-types/type.interface.ts:1`) и `RemoveFieldsWithType` (`packages/schemer/src/defines/mapped-types/types/remove-fields-with-type.type.ts:5`) наружу не выходят: `mapped-types/index.ts:1-5` реэкспортирует только `mapped-type.interface` и четыре helper'а, поэтому в сигнатурах mapped-types эти типы видны, а импортировать их из `@aom-js/schemer` нельзя.

## Внутренние модули

| Файл | Ответственность | Ключевые символы |
|---|---|---|
| `src/index.ts` | Точка входа: `import "reflect-metadata"` и реэкспорт `decorators`, `types`, `module`, `collector`, `PropertySchema`, `mapped-types`; helpers не реэкспортируются | — |
| `src/defines/module.ts` | Мета-класс `AomSchemas` и класс `Schemer` (`render`/`validate`) | `AomSchemas`, `Schemer` |
| `src/defines/decorators.ts` | `ComponentSchema` — классовый декоратор фазы INSTANT: `inherit` → `JSONSchema` → `apply()` → `params.decorators`; в конце файла закомментирован `ComponentConnect` | `ComponentSchema` |
| `src/defines/properties.ts` | Семь фабрик `PropertySchema.*`, их интерфейсы параметров и `checkExistsSchemaParams` (защита от двойного описания + регистрация свойства в `root.properties`) | `PropertySchema`, `_String`, `_Number`, `_Boolean`, `_Any`, `_Enum`, `_Date`, `_Type` |
| `src/defines/types.ts` | Типы параметров и `enum SchemaTypes` | `SchemaTypes`, `CommonDescriptionsProperties`, `ClassDescriptionsProperties` |
| `src/defines/collector.ts` | `SchemasCollector.extract` и словари скаляров `SCALAR_SCHEMAS` (по конструктору, приватный) / `SCALAR_TYPE_SCHEMAS` (по имени, публичный) | `SchemasCollector`, `SCALAR_TYPE_SCHEMAS` |
| `src/defines/helpers/` | `IsNullable` (обёртка над `ValidateIf(value !== null)`) и `decorateProperty` (`Reflect.decorate` с фильтрацией `undefined`); `readme.md` описывает `IsNullable` | `IsNullable`, `decorateProperty` |
| `src/defines/mapped-types/` | Четыре helper-функции пересборки схемы плюс интерфейсы `Type`, `MappedType`, `RemoveFieldsWithType` | `PartialType`, `PickType`, `OmitType`, `IntersectionType` |
| `src/defines/class-transformer-cjs-storage.d.ts` | Ambient-объявление подпути `class-transformer/cjs/storage.js` (у библиотеки нет `.d.ts` для него) | `defaultMetadataStorage` |
| `test/` | Четыре vitest-файла: `render`, `runtime`, `mapped-types`, `collector`; запускаются из корня ядра по алиасу на `src` | — |
| `package.json`, `package.src.json`, `tsconfig.build*.json` | Манифесты и три конфигурации сборки (cjs/mjs/types) | — |

## Ключевые механизмы

### Двухфазное декорирование (LAST внутри INSTANT)

Фабрики свойств возвращают `AomSchemas.propertyDecorator(handler, ExecutionPhase.LAST)`. Для фазы LAST очередь узла отложенная (`packages/core/src/defines/core.ts:80`), поэтому в момент декорирования свойства не выполняется ничего: вызов только кладётся в очередь (`core.ts:99-112`, фабрика — `core.ts:576-589`). `ComponentSchema` — классовый декоратор фазы INSTANT (`core.ts:521-534`), и именно он разбирает очереди: сначала `$._.inherit(Object.getPrototypeOf(target))`, затем `JSONSchema({...params})` на класс, затем `$._.apply()` (обход `properties`/`statics`/`origins` с прогоном их callstack — `core.ts:282-301`), и только после этого `params.decorators`.

`packages/schemer/src/defines/decorators.ts:16-45`:

```ts
return AomSchemas.classDecorator(($: AomSchemas) => {
  $.isComponentSchema = true;
  // ...
  const errors: Error[] = [];
  // ...
  const inheritDecorators = (parent: ClassType) => {
    $._.inherit(parent);
  };
  inheritDecorators(Object.getPrototypeOf($._.target));

  if (params) {
    const decorators = [JSONSchema({ ...params })];
    Reflect.decorate(decorators, $._.target);
  }

  $._.apply(); // применим остальные декораторы

  Reflect.decorate(params?.decorators || [], $._.target);
  // ...
}, ExecutionPhase.INSTANT);
```

Следствие: класс с `PropertySchema`, но без `@ComponentSchema`, — полный no-op. Проба на текущем `src`: `schemer.render(NoComp)` даёт `{}`, а `validateSync(plainToInstance(NoComp, {x: "a"}))` — единственную ошибку `unknownValue`, потому что на прототип не попал ни один валидатор.

Evidence: `packages/schemer/src/defines/properties.ts:30-64`, `packages/schemer/src/defines/properties.ts:332-340`, `packages/schemer/src/defines/decorators.ts:14-46`, `packages/core/src/defines/core.ts:80`, `packages/core/src/defines/core.ts:99-112`, `packages/core/src/defines/core.ts:282-301`.

### Сырые параметры в узле AomSchemas

Handler каждой фабрики выполняет одну и ту же преамбулу: `checkExistsSchemaParams($)` (бросает `<Class>.<prop> already has defined schema params`, если параметры уже заданы, иначе добавляет свойство в `$._.root.properties`), затем `$.schemaName = SchemaTypes.X` и `$.schemaParams = params`. `PropertySchema.Type` дополнительно кладёт ленивую ссылку в `$._.root.connections`.

`packages/schemer/src/defines/properties.ts:14-21`:

```ts
function checkExistsSchemaParams($: AomSchemas) {
  if ($.schemaParams) {
    throw new Error(`${$._.target.name}.${String($._.property)} already has defined schema params`);
  }
  // если ошибок не было, то внесём его в набор
  // property здесь всегда задано: вызов идёт только из AomSchemas.propertyDecorator
  $._.root.properties.add($._.property!);
}
```

`properties` содержит все свойства с `PropertySchema`, включая `hidden`; `connections` — только свойства с `Type`. Эти два поля плюс `schemaName`/`schemaParams` — единственный источник для mapped-types, для каскада `SchemasCollector` и для `ParamsBuilder`, который требует ровно одно свойство: `packages/api/src/builders/params.ts:66-76`.

Evidence: `packages/schemer/src/defines/properties.ts:14-21, 33-35, 300-307`, `packages/schemer/src/defines/module.ts:13-23`, `packages/api/src/builders/params.ts:63-76`.

### Набор библиотечных декораторов по типу

Каждая фабрика собирает массив декораторов (с `undefined` на месте невыполненных условий) и передаёт его в `decorateProperty`, который фильтрует пустые значения через `.filter(Boolean)` (`packages/schemer/src/defines/helpers/decorate-property.ts:15-21`). Все условия — truthy-проверки вида `params.maxLength ? MaxLength(...) : undefined`.

| Фабрика | class-validator | class-transformer | JSONSchema-ключи | Особые параметры |
|---|---|---|---|---|
| `String` | `IsString(each/message/groups/always)`; `IsOptional?`; `MaxLength?`; `MinLength?`; `IsNullable?` | `Exclude?` (`hidden`) | `description`; `deprecated`; `nullable`; `default`; `examples`; `readOnly` | `minLength`; `maxLength`; `pattern` (объявлен, не используется); `default`; `decorators` применяются |
| `Number` | `IsNumber({maxDecimalPlaces}, {each/message/groups/always})`; `IsOptional?`; `Max?`; `Min?` — **`IsNullable` отсутствует** | `Exclude?`; `Transform(value → null при nullable, иначе Number(value))` | те же шесть | `minValue`; `maxValue`; `maxDecimalPlaces`; `default`; `decorators` применяются |
| `Boolean` | `IsBoolean(...)`; `IsOptional?`; `IsNullable?` | `Exclude?`; `Transform('true'→true, 'false'→false, boolean как есть, иначе Boolean(+value))` | те же шесть | `default`; `decorators` применяются |
| `Any` | `Allow(...)`; `IsOptional?`; `IsNullable?` | `Exclude?` | те же шесть | `default`; `decorators` применяются |
| `Enum` | `IsEnum(params.value, ...)`; `IsOptional?`; `IsNullable?` | `Exclude?` | `description`; `deprecated`; `nullable`; `default`; `examples` — **без `readOnly`** | `value` (объект enum); `default`; `decorators` применяются |
| `Date` | `IsDate(...)`; `MaxDate?`; `MinDate?`; `IsOptional?`; `IsNullable?` | `Exclude?`; `Transform(value → null при nullable, иначе new Date(value))` | `description`; `deprecated`; `nullable`; `default`; `examples` — **без `readOnly`** | `minDate`; `maxDate`; `default`; **`decorators` игнорируются** |
| `Type` | `ValidateNested({each: isArray, ...})`; `IsOptional?`; `IsNullable?` | `Type(params.value)`; `Exclude?` | `description`; `deprecated`; `nullable` — **без `default`/`examples`/`readOnly`** | `value: () => Class`; **`decorators` игнорируются** |

Столбец «Особые параметры» перечисляет поля сверх `CommonDescriptionsProperties` (`nullable`, `examples`, `isOptional`, `hidden`, `readOnly`, `isArray`, `message`, `groups`, `always`, `decorators` — `packages/schemer/src/defines/types.ts:16-27`). Ограничения `MinLength/MaxLength/Min/Max/MinDate/MaxDate` создаются без `{each}` — параметр `isArray` доходит только до основного валидатора и до `ValidateNested`.

Evidence: `packages/schemer/src/defines/properties.ts:39-60` (String), `:83-110` (Number), `:130-158` (Boolean), `:178-197` (Any), `:223-241` (Enum), `:264-287` (Date), `:309-325` (Type).

### Наследование схем через inherit

`ComponentSchema` безусловно вызывает `$._.inherit(Object.getPrototypeOf(target))`. Ядро переносит callstack родителя на потомка и для каждого `origin` родителя, свойство которого потомок не объявил сам (двойная проверка: `Object.hasOwn` плюс реестр `AomSchemas`), создаёт узел свойства потомка и переносит туда LAST-очередь (`packages/core/src/defines/core.ts:330-361`). То есть `PropertySchema` родителя повторно навешивается на прототип потомка — у потомка собственные метаданные валидатора, а не заимствованные по цепочке прототипов. Благодаря этому работает и `class Ext extends Base`, и `class X extends PickType(...) {}`.

Свойство, переопределённое потомком собственным `PropertySchema`, родительский декоратор не получает — иначе сработала бы защита `checkExistsSchemaParams`. Проба: `class C1 extends B1` с `@PropertySchema.Number({minValue: 3})` поверх родительского `String({minLength: 5})` рендерится как `{"v":{"minimum":3,"type":"number"}}`.

Evidence: `packages/schemer/src/defines/decorators.ts:28-31`, `packages/core/src/defines/core.ts:303-364`, тест `packages/schemer/test/render.test.ts:89-106` («наследование: схема потомка включает свойства родителя»).

### Mapped-types: пересборка из origins

Все четыре helper'а работают одинаково: создают `abstract class` с фиксированным именем, проверяют `AomSchemas.checkExists(classRef)?.isComponentSchema` (иначе `throw <Name> parent class is not ComponentSchema constructor`), обходят `$classInstance._.origins`, берут `origin.self.{schemaName, schemaParams}` и вызывают `Reflect.decorate([PropertySchema[schemaName](schemaParams)], target, origin.property)`, где `target` — сам класс или его прототип в зависимости от `origin.target === origin._.target`. В конце — `Reflect.decorate([ComponentSchema()], NewClass)`, поэтому результат сам является компонент-схемой (и `connections` пересоздаются, т.к. `Type` вызывается заново).

`packages/schemer/src/defines/mapped-types/partial-type.helper.ts:22-38` — остальные три helper'а отличаются только фильтром и параметрами:

```ts
$classInstance._.origins.forEach((origin) => {
  // ...
  const { schemaName, schemaParams } = origin.self;
  if (schemaName && schemaParams) {
    const isClassOrigin = origin.target === origin._.target;
    const target = isClassOrigin ? PartialClassType : PartialClassType.prototype;
    // ...
    Reflect.decorate(
      [Reflect.apply(PropertySchema[schemaName], undefined, [{ ...schemaParams, isOptional: true }])],
      target,
      origin.property
    );
  }
});
```

Свойство без `schemaName`/`schemaParams` (описанное «голыми» декораторами class-validator) в новый класс не переносится — молча. `IntersectionType` копит свойства в двух `Map` (класс и прототип), поэтому при совпадении имён побеждает последний переданный класс: проба `IntersectionType(E1, E2)`, где `E1.x` — строка, а `E2.x` — число, даёт `{"x":{"type":"number"}}`. Составимость работает: `PartialType(PartialType(A))` и `PartialType(OmitType(...))` возвращают полный набор свойств.

Evidence: `packages/schemer/src/defines/mapped-types/partial-type.helper.ts:14-42`, `pick-type.helper.ts:10-41`, `omit-type.helper.ts:10-42`, `intersection-type.helper.ts:34-89`, тесты `packages/schemer/test/mapped-types.test.ts:28-72`.

### Рендер (`Schemer.render`)

`render` — один вызов `targetConstructorToSchema(target, {classTransformerMetadataStorage: defaultMetadataStorage, refPointerPrefix})`. Хранилище `class-transformer` (импортируется по подпути `class-transformer/cjs/storage.js`, для которого в пакете лежит ambient-объявление) нужно библиотеке, чтобы отбросить свойства с `Exclude()` и чтобы для `ValidateNested` найти тип из `@Type()` и подставить `{$ref: refPointerPrefix + Name}`; при `each: true` — `{type: "array", items: {$ref}}`.

`packages/schemer/src/defines/module.ts:37-42`:

```ts
render(target: ClassType): ReturnType<typeof targetConstructorToSchema> {
  return targetConstructorToSchema(target, {
    classTransformerMetadataStorage: defaultMetadataStorage,
    refPointerPrefix: this.refPointerPrefix,
  });
}
```

В `required` попадают свойства без `IsOptional` и без `ValidateIf`: библиотека считает условную валидацию признаком необязательности. Практическое следствие — асимметрия `nullable`: у `String/Boolean/Any/Enum/Date/Type` он ставит `IsNullable` (то есть `ValidateIf`) и свойство выпадает из `required`, у `Number` `IsNullable` нет и свойство остаётся обязательным. Проба на классе с `Number({nullable:true})` и `String({nullable:true})` даёт `"required":["n"]`.

`Date` рендерится не как скаляр из словарей коллектора, а как `{"oneOf":[{"format":"date","type":"string"},{"format":"date-time","type":"string"}]}` — это конвертер `IS_DATE` библиотеки. Префикс `$ref` задаётся на инстанс `Schemer`, а не на класс, поэтому одна и та же схема может рендериться с разными префиксами (router и api создают инстансы с `OpenApi.refPointerPrefix`, transfer — с `Transfer.refPointerPrefix`). Рендер не кэшируется; кэш появляется только на уровне `SchemasCollector.components`.

Evidence: `packages/schemer/src/defines/module.ts:36-42`, `packages/schemer/src/defines/class-transformer-cjs-storage.d.ts`, `packages/schemer/src/defines/decorators.ts:34-37`, тест `packages/schemer/test/render.test.ts:32-54`.

### Сборщик схем (`SchemasCollector.extract`)

`extract` разбирает вход по типу, в фиксированном порядке: строка → копия литерала из `SCALAR_TYPE_SCHEMAS` или ошибка с перечислением допустимых имён; массив → ровно один элемент, иначе ошибка, результат `{type: "array", items: extract(schema[0])}`; конструктор `String/Number/Boolean/Date` → копия литерала из приватного `SCALAR_SCHEMAS`; компонент-класс → регистрация в `components` и `{$ref}`; любая другая функция → ошибка `is not a ComponentSchema class or scalar constructor`; всё остальное (готовый объект JSON Schema) возвращается тем же инстансом.

`packages/schemer/src/defines/collector.ts:60-71`:

```ts
const saved = AomSchemas.checkExists(schema);
if (saved && saved.isComponentSchema) {
  const { name } = saved._.target;
  if (!this.components.has(name)) {
    // сначала фиксируем рендер (защита от циклов), затем обходим связи
    this.components.set(name, this.schemer.render(schema));
    saved.connections.forEach((connection) => {
      this.extract(Reflect.apply(connection, null, []));
    });
  }
  return { $ref: `${this.schemer.refPointerPrefix}${name}` };
}
```

Порядок «сначала `set`, потом обход `connections`» — защита от циклов: самоссылающийся компонент (`Orgs.parentOrg → Orgs`) не уводит рекурсию в бесконечность. Ключ словаря — `target.name`, поэтому имя класса и есть имя компонента.

Evidence: `packages/schemer/src/defines/collector.ts:36-80`, тесты `packages/schemer/test/collector.test.ts:28-103`.

### `Schemer.validate`

`validate` делает `plainToInstance(constructor, {...data}, {exposeDefaultValues: true, strategy: "exposeAll", exposeUnsetFields: false, enableCircularCheck: true})` и затем `validateSync(values, {whitelist: true})`, возвращая `{values, errors}`. `whitelist: true` удаляет из результата свойства, на которых нет ни одного валидатора, — так отсекаются лишние поля запроса. Единственный потребитель — `SafeData` в `@aom-js/api`, который на непустом `errors` бросает `WrongDataResponse` (`packages/api/src/decorators/safe-data.ts:18-28`).

Evidence: `packages/schemer/src/defines/module.ts:44-59`.

## Инварианты и подводные камни

- `PropertySchema` без `@ComponentSchema` на классе не делает ничего: фаза LAST разбирается только агрегатором. Наследование от компонента этого не заменяет — `class X extends PickType(...) {}` без собственного `@ComponentSchema()` рендерится (метаданные видны по цепочке прототипов), но `isComponentSchema` остаётся `undefined`, и `SchemasCollector.extract` бросает, а `ParamsBuilder` — `COMPONENT_SCHEMA_NOT_DEFINED`.
- Одно свойство — одна фабрика. Повторное описание бросает `already has defined schema params`, но стек указывает на строку `@ComponentSchema`, а не на свойство: ошибка возникает в момент `apply()`.
- Именование параметров: `hidden` (не `exclude`), `isOptional` (не `required`), `isArray` (не `each`), `value` (не `type`) — для `Enum` это объект enum, для `Type` — ленивая ссылка `() => Class`.
- `isOptional: true` в class-validator пропускает и `undefined`, и `null`, поэтому вместе с ним `nullable` влияет только на JSON Schema и на `Transform`.
- Порядок внутри `ComponentSchema` фиксирован: `inherit` → `JSONSchema(params)` → `apply()` свойств → `params.decorators`. Классовые декораторы из `params.decorators` видят уже полностью декорированный класс.
- Имя класса — это имя компонента в OpenAPI. `ClassDescriptionsProperties.name` его не меняет.
- Внешние скрипты и пробы должны импортировать `class-validator`/`class-transformer` из той же копии, что и schemer (`packages/schemer/node_modules`), иначе хранилища метаданных расходятся и валидация выглядит сломанной.
- `package.json` пакета содержит заглушку `"test": "echo \"Error: no test specified\" && exit 1"`; настоящие тесты запускаются из корня ядра.

### Известные дефекты

> ⚠️ Дефект: нулевые ограничения молча теряются — `params.minValue ? Min(...) : undefined` и три аналога проверяют значение на truthy, поэтому `0` эквивалентен «не задано».
> Evidence: `packages/schemer/src/defines/properties.ts:47-48` (`maxLength`/`minLength`), `packages/schemer/src/defines/properties.ts:94-95` (`maxValue`/`minValue`); тест `packages/schemer/test/render.test.ts:78-87` (`it.fails`).
> Последствия: свойство с `minValue: 0` не получает ни валидатора `Min(0)`, ни ключа `minimum: 0` в схеме. В приложении затронут `Pager.offset` (`test/src/common/controllers/query-string-data.ts:12`) — отрицательный `offset` проходит валидацию; проба с `-1` не даёт ошибок.
> Как обходить: задавать ненулевую границу либо добавлять `Min(0)` через `decorators`. См. `KI-SCHEMER-01` в `test/docs/known-issues.md`.

> ⚠️ Дефект: `PropertySchema.Number` — единственная фабрика без `IsNullable`, поэтому `nullable: true` без `isOptional: true` не пропускает `null`.
> Evidence: `packages/schemer/src/defines/properties.ts:83-110` (в списке декораторов есть `IsOptional?`, `Max?`, `Min?`, `Exclude?`, но нет `params.nullable ? IsNullable() : undefined`); ср. `properties.ts:138`, `:186`, `:231`, `:274`, `:318`.
> Последствия: `{n: null}` даёт ошибку `n: isNumber`; в JSON Schema при этом стоит `nullable: true`, а само свойство остаётся в `required` — декларация и поведение расходятся в обе стороны.
> Как обходить: `Number({nullable: true, isOptional: true})` либо `decorators: [IsNullable()]` из собственной копии. См. `KI-SCHEMER-02`.

> ⚠️ Дефект: `PropertySchema.Date` и `PropertySchema.Type` не применяют `params.decorators`, хотя параметр объявлен в общем интерфейсе.
> Evidence: `packages/schemer/src/defines/properties.ts:264-287` и `:309-325` — в отличие от остальных пяти фабрик, массив декораторов не заканчивается спредом `...(params.decorators || [])`; сам параметр — `packages/schemer/src/defines/types.ts:26`.
> Последствия: дополнительный валидатор исчезает молча (проба: `Date({decorators: [IsUUID()]})` не даёт ошибки на любой дате). В приложении `Date` вызывается с `decorators: []` (`test/src/common/schemas/postgres/base.ts:38-41, 45-49, 53-57`), то есть безвредно, но приглашает к ошибке.
> Как обходить: навешивать нужный декоратор отдельной строкой над свойством. См. `KI-SCHEMER-03`.

> ⚠️ Дефект: при `isArray: true` ограничения диапазона применяются к массиву, а не к его элементам — `each` передаётся только основному валидатору.
> Evidence: `packages/schemer/src/defines/properties.ts:41` и `:47-48` (в `IsString` есть `each: params.isArray`, у `MaxLength`/`MinLength` опций нет); те же пары — `properties.ts:87` и `:94-95`, `:266` и `:271-272`.
> Последствия: `String({isArray: true, minLength: 3})` со значением `["ab"]` даёт ошибку `arr: minLength` про длину массива, а не про длину строки; в JSON Schema `minLength` оказывается на уровне `{"type":"array"}`. Сочетаний `isArray` + ограничение в приложении нет.
> Как обходить: передавать `MinLength(3, {each: true})` через `decorators`. См. `KI-SCHEMER-04`.

> ⚠️ Дефект: часть общих параметров не доходит до `JSONSchema` — `readOnly` у `Enum`, `Date`, `Type`; `default`, `examples` и `readOnly` у `Type`; `pattern` у `String` объявлен, но не используется нигде.
> Evidence: `packages/schemer/src/defines/properties.ts:233-239` (Enum), `:276-282` (Date), `:320-324` (Type), `:26` (объявление `pattern`).
> Последствия: 12 из 14 вызовов с `readOnly: true` в приложении стоят на `PropertySchema.Type` (`test/src/modules/orgs/entities/postgres/Orgs/Orgs.ts:40, 57, 74`, `test/src/modules/orgs/entities/postgres/Permissions/Permissions.ts:48, 64, 78`, `test/src/modules/orgs/entities/postgres/Permissions/Orgs.ts:38, 54`, `test/src/modules/orgs/entities/postgres/Partnerships/Partnerships.ts:33, 48`, `test/src/modules/orgs/entities/postgres/Permissions/OrgsUsers.ts:28`, `test/src/modules/auth/entities/postgres/Users/Users.ts:45`) — флаг не попадает в OpenAPI. Для `Type` это вдобавок бессмысленно: свойство рендерится как `{$ref}`, и любые соседние ключи теряются.
> Как обходить: добавлять `JSONSchema({readOnly: true})` вручную (для `String`/`Number`/`Boolean`/`Any` параметр работает). См. `KI-SCHEMER-05`.

> ⚠️ Дефект: `ComponentSchema(params)` спредит все параметры в `JSONSchema` класса, включая служебные.
> Evidence: `packages/schemer/src/defines/decorators.ts:34-37` (`JSONSchema({ ...params })`); тип параметров — `packages/schemer/src/defines/types.ts:11-14`.
> Последствия: `@ComponentSchema({name: "Renamed"})` даёт в схеме посторонний ключ `"name":"Renamed"`, а `decorators` сериализуются как `"decorators":[null]`. При этом `name` компонент не переименовывает: `SchemasCollector` ключует по `target.name` (`collector.ts:62`), проба даёт ключ `R`.
> Как обходить: передавать в `ComponentSchema` только `description`/`deprecated`; переименование делать именем класса. См. `KI-SCHEMER-06`.

> ⚠️ Дефект: mapped-types возвращают классы с фиксированными именами `PartialClassType`, `PickTypeClass`, `OmitTypeClass`, `IntersectionClassType`, а `SchemasCollector` при совпадении имени молча оставляет первый компонент.
> Evidence: `packages/schemer/src/defines/mapped-types/partial-type.helper.ts:15`, `pick-type.helper.ts:11`, `omit-type.helper.ts:11`, `intersection-type.helper.ts:35`; `packages/schemer/src/defines/collector.ts:62-69`.
> Последствия: проба с двумя разными `PartialType(...)`, переданными в один коллектор, даёт один ключ `PartialClassType` и оба `$ref` на него — второй компонент теряется вместе со своими свойствами. Сюда же примыкает `class X extends PickType(...) {}` без `@ComponentSchema()`: рендер работает, но `extract` бросает `"X" is not a ComponentSchema class`.
> Как обходить: единственный безопасный паттерн — оборачивать результат в именованный класс с `@ComponentSchema()`, как это делает приложение. См. `KI-SCHEMER-07`.

> ⚠️ Дефект: `Date` рендерится как `oneOf` из двух форматов, тогда как словари коллектора описывают дату как `{type: "string", format: "date-time"}`. В реестре запись классифицирована как расхождение, а не дефект (`test/docs/known-issues.md`, `KI-SCHEMER-08`).
> Evidence: `packages/schemer/src/defines/collector.ts:8` и `:17` против фактического рендера (проба: `{"oneOf":[{"format":"date","type":"string"},{"format":"date-time","type":"string"}]}`); разбор в codegen — `packages/codegen/src/defines/inverse.ts:57-80`.
> Последствия: `inverseSchema` не знает `oneOf` и бросает `codegen: cannot inverse schema` — компонент с любым `Date`-свойством не восстанавливается кодогенерацией.
> Как обходить: со стороны schemer обхода нет; codegen применяется только к дескрипторам изоляторов, а приложение их не использует. См. `KI-SCHEMER-08`.

### Легаси и мёртвый код

> 🧱 Легаси: поле `AomSchemas.schemer` объявлено, но нигде не присваивается и не читается; в `ComponentSchema` объявлен массив `errors`, который никогда не наполняется, а его проверка приводит к недостижимому `console.error`.
> Где: `packages/schemer/src/defines/module.ts:14`; `packages/schemer/src/defines/decorators.ts:20, 42-44` (плюс закомментированная строка `$.schemer = schemer` на `decorators.ts:17`).
> Почему не используется: следы схемы «схемер задаётся в декораторе класса» из `docs/schemer-flexible-render.md`; заменено на конструктор `new Schemer(refPointerPrefix)` у потребителя.
> Там же `decorators.ts:48-56` — закомментированный `ComponentConnect`, замещённый `PropertySchema.Type` (он же наполняет `connections`).
> См. `KI-SCHEMER-09` в `test/docs/known-issues.md`.

> 🧱 Легаси: `ComponentSchema` на классе без компонент-родителя вызывает `inherit(Function.prototype)` и регистрирует в реестре `AomSchemas` узел для `Function.prototype`.
> Где: `packages/schemer/src/defines/decorators.ts:28-31`.
> Почему так: `inherit` вызывается безусловно, отдельной ветки для корня иерархии нет. Проба подтверждает: `AomSchemas.checkExists(Function.prototype)` истинно. На поведение не влияет — узел пустой; замены нет, это мусор в реестре.
> `IsNullable` при этом не экспортируется из `src/index.ts:1-9`, поэтому `@aom-js/api` держит дословную копию (`packages/api/src/decorators/is-nullable.ts:3-11`) — дублирование, а не отдельный API. См. `KI-SCHEMER-09`.

## Как использует приложение

**Сущность = компонент-схема (двойное декорирование).** Каждое поле сущности описывается парой декораторов: `@PropertySchema.*` для OpenAPI/валидации и `@Property/@ManyToOne/@OneToMany` для MikroORM. `test/src/modules/orgs/entities/postgres/Orgs/Orgs.ts:13-34`:

```ts
@ComponentSchema({ description: "Организации" })
@Entity()
export class Orgs extends DefaultEntity {
  @PropertySchema.String({ maxLength: 128, nullable: true, description: "Название" })
  @Property({ type: t.string, length: 128, nullable: true })
  name: string | null;
  ...
  @PropertySchema.Type({ value: () => Orgs, hidden: true, description: "Родительская организация" })
  @ManyToOne({ entity: () => Orgs, index: true, hidden: true, nullable: true })
  parentOrg: Rel<Orgs> | null;
}
```

Базовые поля (`id`, `createdAt`, `updatedAt`, `deletedAt`) приходят от `DefaultEntity`, который сам помечен `@ComponentSchema` — потомок получает их копии через `inherit` (`test/src/common/schemas/postgres/base.ts:29-58`). Правило двойного декорирования — `test/docs/principles.md#двойное-декорирование-сущностей`; каталог сущностей — `test/docs/data-model.md`.

**DTO — только через mapped-types.** Тело запроса собирается из сущности, а не переписывается вручную: `test/src/modules/user/api/routes/profile/init.ts:7-8`:

```ts
@ComponentSchema({ description: "Обновление профиля" })
export class ProfileUpdateDTO extends PickType(entities.Users, ["name", "surname", "birthDate"]) {}
```

Обёртка в именованный класс с собственным `@ComponentSchema()` обязательна — она даёт компоненту осмысленное имя и обходит коллизию `PickTypeClass` (`KI-SCHEMER-07`).

**Композиция DTO через `IntersectionType`.** `test/src/modules/tickets/api/routes/tickets/init/schemas.ts:16-26` собирает тело из двух частей — идентификатора организации и полей тикета:

```ts
@ComponentSchema()
export class TicketBodyDTO extends PickType(entities.Tickets, [
  ticketAttrs.title,
  ticketAttrs.text,
]) {}

// ...

@ComponentSchema()
export class OrgTicketDTO extends IntersectionType(OrgIdDTO, TicketBodyDTO) {}
```

Исключение из правила обёртки — `test/src/modules/tickets/api/routes/tickets/init/filters.ts:16`: `QueryStringBuilder(PartialType(TicketType))` получает mapped-type напрямую. Это безопасно, потому что query-билдеры разворачивают схему в плоский список параметров через `plainJsonSchema` (`packages/api/src/functions/json-schema.ts:9-30`), а не через коллектор компонент.

Правила раскладки DTO по `init/schemas.ts` — `test/docs/principles.md`; конкретные модули — `test/docs/modules/*.md`.

## Сборка и потребление

Сборка стандартная для монорепо: `bun run build:schemer` из корня ядра (эквивалент `bun --filter @aom-js/schemer build`) выполняет `tsc` трижды — `tsconfig.build.json` (CommonJS → `dist/cjs`), `tsconfig.build.mjs.json` (ESM → `dist/mjs`), `tsconfig.build.types.json` (только декларации → `dist/types`) — и затем `node ../../scripts/post-build.js`, который дописывает расширения относительным импортам и кладёт `dist/cjs/package.json` с `{"type": "commonjs"}` (сам пакет — `"type": "module"`). Манифест `package.json` генерируется из `package.src.json` скриптом `scripts/prebuild.js`, поэтому править надо `package.src.json`. Приложение видит пакет через симлинк `test/node_modules/@aom-js/schemer → main/packages/schemer` и потребляет `dist`, а не `src`: **правки `src` не видны приложению без `bun run build`**. Тесты монорепо, наоборот, идут по алиасу на `src` (`vitest.config.ts:20-25`), поэтому зелёные тесты не гарантируют, что `dist` пересобран. Полная схема сборки и dist-потребления — `docs/architecture.md`.

Состояние на 2026-09-02: `dist` (25 августа 23:31) новее `src/defines/collector.ts` (23:21), то есть приложение видит текущий код коллектора.

> ✏️ Не закоммичено: единственное отличие рабочего дерева пакета от HEAD — пустая строка, добавленная в `packages/schemer/src/defines/collector.ts:59` между блоком скаляров и `AomSchemas.checkExists`. Поведение не меняется; `dist` собран после этой правки. Общий список незакоммиченных правок ядра — `docs/architecture.md` §«Состояние рабочего дерева».

## Тесты

### Что покрыто

| Файл | Что проверяет |
|---|---|
| `packages/schemer/test/render.test.ts` | Регистрация `isComponentSchema`; типы и ограничения (`minLength`, `maxLength`, `minimum`, `default`, `enum`); состав `required`; `description` класса; `connections` и `$ref` от `PropertySchema.Type`; наследование свойств родителя |
| `packages/schemer/test/runtime.test.ts` | `Transform` для `Number`/`Boolean`/`Date`; `nullable` пропускает `null`; `hidden` исключает свойство из `instanceToPlain`; `validateSync` на обязательное поле, `minLength` и валидный объект; ошибка двойного описания свойства |
| `packages/schemer/test/mapped-types.test.ts` | `PickType`/`OmitType`/`PartialType` (пустой `required`)/`IntersectionType`; производный класс сам компонент; `PickType` от не-компонента бросает |
| `packages/schemer/test/collector.test.ts` | `$ref` и наполнение `components`; каскад `Owner → Pet → Toy`; сквозной объект; идемпотентность; скаляры по конструктору и по имени; неизвестное имя; `[T]`; независимость копий литералов; класс без `@ComponentSchema` бросает |

### Expected-fail

`render.test.ts:78-87` — `it.fails("minValue: 0 должен попадать в схему как minimum: 0 (дефект: truthy-проверка)")`, комментарий `// FINDING` над тестом. Соответствует записи №1 в `docs/superpowers/plans/2026-07-20-test-coverage-findings.md:7` и `KI-SCHEMER-01`.

### Пробелы

- Нет теста «`PropertySchema` без `@ComponentSchema` — no-op».
- Нет тестов `Any`/`Enum` с `isArray`, `Type` с `isArray` (`items.$ref`), рендера `nullable`, `hidden` в `render` (проверен только `instanceToPlain`).
- Нет тестов `Schemer.validate` (`whitelist`, `exposeDefaultValues`) — метод покрыт только косвенно через `@aom-js/api`.
- Нет тестов `params.decorators`, в том числе того, что `Date`/`Type` их игнорируют, и утечки `name`/`decorators` в схему класса.
- Нет тестов `Number` с `nullable` без `isOptional`, ограничений при `isArray`, `readOnly` у `Enum`/`Date`/`Type`.
- Нет тестов коллизии имён mapped-types в `SchemasCollector` и `IntersectionType` с одноимёнными свойствами.
- Нет теста, что дочерний класс, переопределяющий свойство, не получает родительский декоратор.

### Как запускать

```bash
bun run test packages/schemer   # из корня ядра
```

Проверено 2026-09-02: 4 файла, 31 passed | 1 expected fail. Скрипт `test` в `packages/schemer/package.json:53` — заглушка и падает; запускать только из корня.

## Расхождения с историческими заметками

| Заметка | Утверждение | Фактически | Evidence |
|---|---|---|---|
| `docs/schemer-flexible-render.md:63, 79-89, 319, 333, 352-361` | Декоратор принимает инстанс схемера (`@ComponentSchema(openAiSchemer)`); конфигурация через `Schemer.config({render})`; извлечение через `AomSchemer.instance(class)` и `schemer.structure(target, {})` | `ComponentSchema(params?: ClassDescriptionsProperties)` принимает только описание класса; `Schemer` — обычный класс с конструктором `(refPointerPrefix)` и двумя методами; ни `config`, ни `structure` не существует; рендер жёстко через `targetConstructorToSchema` | `packages/schemer/src/defines/decorators.ts:14`; `packages/schemer/src/defines/module.ts:25-59` |
| `docs/schemer-flexible-render.md:379, 388-416, 448-451` | Декораторы называются `Schema.String/Date/Number/Type/Boolean` с параметрами `type: () => X`, `exclude: true`, `required: true` | Объект называется `PropertySchema` и содержит семь фабрик (добавлены `Enum` и `Any`); ссылка задаётся как `value: () => X`, скрытие — `hidden: true`; параметра `required` нет, обязательность = отсутствие `isOptional` | `packages/schemer/src/defines/properties.ts:294-296, 332-340`; `packages/schemer/src/defines/types.ts:16-27` |
| `docs/schemer-flexible-render.md:504-508` | «Следом надо добавить»: генерацию чистого TS для `ComponentSchema`-класса, «сырую» структуру и интеграцию в transfer | Интеграция в transfer сделана (`IsDistributed` собирает компоненты через `SchemasCollector`), генерация TS живёт в `@aom-js/codegen`; но идёт она от JSON Schema, а не от сырых `schemaName`/`schemaParams`, и теряет часть ограничений | `packages/transfer/src/defines/decorators.ts:105-108`; `packages/codegen/src/defines/inverse.ts:8-14, 57-80` |
| `packages/schemer/src/defines/helpers/readme.md:3` | «`@IsNullable` применяется, если в свойствах указано `{nullable: true}`, позволяет подавать null на вход» | Верно для шести фабрик из семи; `PropertySchema.Number` `IsNullable` не навешивает, `null` проходит только за счёт `IsOptional`. Кроме того, `IsNullable` не экспортируется из пакета | `packages/schemer/src/defines/properties.ts:83-110`; `packages/schemer/src/index.ts:1-9` |
| `packages/schemer/readme.md` (прежняя версия, 3 строки) | «Schemas controls processing» | Описания API не было; настоящий документ его заменяет | — |
| `docs/openapi.md:3-5` | «Механика генерации OpenAPI схем в целом и общем должна происходить на базе рутового контроллера, в котором из кусочков… собирается вся схема» | Черновик обрывается на полуслове; фактическая механика — `OpenApi` в router плюс `SchemasCollector` здесь | `packages/router/src/classes/openapi.ts:33-35, 199, 214-219` |
| `docs/superpowers/plans/2026-07-20-test-coverage.md:18, 31, 99` | Команды `yarn test`, `yarn workspace @aom-js/router build`, «Node ≥ 20, yarn 1» | Монорепо на bun: `bun run test`, `bun --filter @aom-js/schemer build`; `vitest.config.ts` дополнен `oxc: false` и алиасом для codegen | `package.json:20-31`; `vitest.config.ts:7, 24` |

## Открытые вопросы

> ❓ Открытый вопрос: `PropertySchema.Number` лишён `IsNullable` намеренно (например, из-за `Transform`, который уже приводит `null`) или это пропуск при копировании шаблона фабрики? (`properties.ts:83-110`)

> ❓ Открытый вопрос: должны ли `Date` и `Type` принимать `params.decorators` — общий интерфейс `CommonDescriptionsProperties` это обещает — и должны ли `Enum`/`Date`/`Type` передавать `readOnly`, `examples`, `default` в `JSONSchema`?

> ❓ Открытый вопрос: какая семантика задумана для `ClassDescriptionsProperties.name` — переименование компонента в `components` (тогда ключевать словарь коллектора надо по нему) или произвольное поле схемы?

> ❓ Открытый вопрос: нужно ли унифицировать рендер `Date` (`oneOf`) со словарём `SCALAR_TYPE_SCHEMAS` (`date-time`), чтобы codegen мог инвертировать `Date`-свойства?

> ❓ Открытый вопрос: должен ли `SchemasCollector` падать или предупреждать при коллизии имён компонентов — сейчас второй компонент теряется молча?

> ❓ Открытый вопрос: планируется ли экспорт `IsNullable` из schemer, чтобы убрать дословный дубликат в `@aom-js/api`?

> ❓ Открытый вопрос: мёртвые `AomSchemas.schemer` и `errors` в `ComponentSchema` — удалить или это задел под «пластичный рендер» из `docs/schemer-flexible-render.md`?
