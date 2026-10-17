# Пластичный рендер схем

> **Черновик автора — исторический документ:** мысли на момент проектирования, а не описание текущего кода. Актуально — [`packages/schemer/readme.md`](../packages/schemer/readme.md); расхождения заметок с кодом — [`architecture.md`](architecture.md#расхождения-с-историческими-заметками).

Итак, наметилась супер-проблема, которая требует вдумчивого решения. А именно то, что механика указавания в декораторе `@ComponentSchema` конкретного схемера оказывается в корне некорректной. Так как не позволяет делать процедуры, использование одних и тех же схем внутри, например, процедур связанных с OpenAI запросами (так как там надо, чтобы связи были через атрибут `$def`), и затем их же помещать в OpenAPI-схему (так как там связи через `components/schemas`).

И требуется её как-то решить.

Начнём с того, что в целом процедура типового рендеринга должна так или иначе прилагаться к тому классу, который надо схемизировать. Хотя бы потому, что могут существовать разные подходы тех самых классов, которые хранят соответствующие данные.

Рассмотрим оба ключевых варианта:

## 1. Описание схемы через `class-validator`+`class-transformer`+``class-validator-jsonschema`

Типичное представление класса выглядит так

```ts
@Entity()
@ComponentSchema()
@JSONSchema({ description: "Адресные точки" })
export class Points extends EnabledEntity {
  @IsString()
  @Sanitize()
  @IsOptional()
  @Property({ type: t.text, nullable: true })
  @JSONSchema({ description: "Код точки", nullable: true })
  code?: string;

  @IsString()
  @IsOptional()
  @Sanitize()
  @Property({ type: t.text, nullable: true })
  @JSONSchema({ description: "Исходный адрес", nullable: true })
  rawAddress?: string;

  @ValidateComponentConnect(() => Addresses)
  @IsOptional()
  @JSONSchema({ description: "Адрес" })
  @ManyToOne({ entity: () => Addresses, eager: true })
  address?: Addresses;

  @Property({ type: t.boolean, default: false })
  @IsBoolean()
  @IsOptional()
  @JSONSchema({ description: "Признак ошибочного адреса", default: false })
  isInvalidAddress: boolean;

  @Exclude()
  @ValidateComponentConnect(() => Orgs)
  @JSONSchema({ description: "Организация" })
  @ManyToOne({ entity: () => Orgs, hidden: true })
  org: Orgs;

  @Exclude()
  @ValidateComponentConnect(() => UsersOrgs)
  @JSONSchema({ description: "Пользователь создавший запись" })
  @ManyToOne({ entity: () => UsersOrgs, hidden: true })
  createdByOrgUser: UsersOrgs;
}
```

Преобразование происходит за счет инструкции вида

```ts
Schemer.config({
  render: (target: ClassConstructor) => {
    //
    return targetConstructorToSchema(target, {
      classTransformerMetadataStorage: defaultMetadataStorage,
      refPointerPrefix: OpenApi.refPointerPrefix,
    });
  },
});
```

Что наглухо фиксирует значение `refPointerPrefix`, и не позволяет скомбинировать результат, например, с другой структурой аналогичного вида

```ts
const refPointerPrefix = "#/$defs/";

export const openAiSchemer = new Schemer({
  render: (target: ClassConstructor) => {
    //
    return targetConstructorToSchema(target, {
      classTransformerMetadataStorage: defaultMetadataStorage,
      refPointerPrefix,
    });
  },
});

@ComponentSchema(openAiSchemer)
export class DreamValue {
  @IsString()
  @JSONSchema({ description: "Смысл сна" })
  meaning: string;

  @IsString()
  @JSONSchema({ description: "Сигнал бессознательного" })
  signal: string;

  @IsString()
  @JSONSchema({ description: "Рекомендация" })
  advice: string;

  @IsBoolean()
  @JSONSchema({ description: "Ошибка данных" })
  error: boolean;
}
```

Так как её перевод внутрь OpenAPI схем не позволит корректно разрулить связи.

Это означает, что такого типа атрибуцию следует делать используя конкретные значения `refPointerPrefix` в моменте, и в целом привести логику к тому, чтобы используя конкретно взятый настроенный рендерер, работающий от входящего параметра, собирать полноценные схемы.

Но прежде чем это делать, следует рассмотреть второй пример того, чем могут быть такого типа схемы, и как они могут быть разрулены.

## 2. Использование чистых JSON-schema значений

Для начала рассмотрим условное целевое значение JSONSchema, которое получается в результате сведения ряда исходных значений:

```ts
{
  "properties": {
    "summary": {
      "$ref": "#/$defs/BookTestSummary",
      "description": "Сводка по книге"
    },
    "chapters_data": {
      "items": {
        "$ref": "#/$defs/BookChaptersDetails"
      },
      "type": "array",
      "description": "Содержание указанных глав (если указаны их номера или названия)"
    },
    "comparsion": {
      "items": {
        "$ref": "#/$defs/BookTestComparsion"
      },
      "type": "array",
      "description": "Сравнение с другими книгами (если указаны авторы)"
    },
    "error": {
      "type": "boolean",
      "description": "Ошибка данных"
    }
  },
  "type": "object",
  "required": [
    "summary",
    "chapters_data",
    "comparsion",
    "error"
  ],
  "$defs": {
    "BookTestSummary": {
      "properties": {
        "title": {
          "type": "string",
          "description": "Название"
        },
        "author": {
          "type": "string",
          "description": "Автор"
        },
        "synopsis": {
          "type": "string",
          "description": "Синопсис произведения"
        },
        "structure": {
          "items": {
            "type": "string"
          },
          "type": "array",
          "description": "Список глав и частей произведения"
        }
      },
      "type": "object",
      "required": [
        "title",
        "author",
        "synopsis",
        "structure"
      ],
      "additionalProperties": false
    },
    "BookTestComparsion": {
      "properties": {
        "title": {
          "type": "string",
          "description": "Название"
        },
        "author": {
          "type": "string",
          "description": "Автор"
        },
        "synopsis": {
          "type": "string",
          "description": "Синопсис произведения"
        },
        "difference": {
          "type": "string",
          "description": "Смысловая разница"
        },
        "error": {
          "type": "boolean",
          "description": "Ошибка данных (автор или книга неизвестны)"
        }
      },
      "type": "object",
      "required": [
        "title",
        "author",
        "synopsis",
        "difference",
        "error"
      ],
      "additionalProperties": false
    },
    "BookChaptersDetails": {
      "properties": {
        "name": {
          "type": "string",
          "description": "Название главы"
        },
        "synopsis": {
          "type": "string",
          "description": "Синопсис главы"
        },
        "error": {
          "type": "boolean",
          "description": "Ошибка данных (глава не найдена)"
        }
      },
      "type": "object",
      "required": [
        "name",
        "synopsis",
        "error"
      ],
      "additionalProperties": false
    }
  },
  "additionalProperties": false
}
```

Какие тут наблюдаются закономерности, которые одновременно являются проблемой?

Во-первых, это отсылки на смежные структуры, которые определяются через `$defs`, и в случае переноса соответствующих значений в OpenAPI-схему они станут нерелевантны. И хотя чисто технически используя тот же `quicktype` можно будет извлечь интерфейсы, раскиданные по собственным значениям, то это всё-равно не позволит восстановить классы таким образом, чтобы впоследствии типовым способом переместить их в указанный сегмент связей. Можно, конечно, для этого написать свою собственную механику генерации-перегенерации. Но лучше к этому прийти в самый последний момент.

Чуть более живое решение возможно сделать, используя сочетание `quicktype`+`zod`, которое возвращает структуры вида:

```ts
import * as z from "zod";

export const ChaptersDatumElementSchema = z.object({
  error: z.boolean(),
  name: z.string(),
  synopsis: z.string(),
});
export type ChaptersDatumElement = z.infer<typeof ChaptersDatumElementSchema>;

export const ComparsionElementSchema = z.object({
  author: z.string(),
  difference: z.string(),
  error: z.boolean(),
  synopsis: z.string(),
  title: z.string(),
});
export type ComparsionElement = z.infer<typeof ComparsionElementSchema>;

export const SummarySchema = z.object({
  author: z.string(),
  structure: z.array(z.string()),
  synopsis: z.string(),
  title: z.string(),
});
export type Summary = z.infer<typeof SummarySchema>;

export const BooksSchema = z.object({
  chapters_data: z.array(ChaptersDatumElementSchema),
  comparsion: z.array(ComparsionElementSchema),
  error: z.boolean(),
  summary: SummarySchema,
});
export type Books = z.infer<typeof BooksSchema>;
```

И которые чисто технически можно обернуть в свои собственные контейнеры и как-то связать с механикой вида:

```ts
export const registry = z.registry();

registry.add(BooksSchema, { id: "Books" });
registry.add(SummarySchema, { id: "Summary" });
registry.add(ComparsionElementSchema, { id: "Comparsion" });
registry.add(ChaptersDatumElementSchema, { id: "ChaptersData" });

z.toJSONSchema(registry, {
  uri: (id) => `#/components/schemas/${id}`,
});
```

Что как-бы позволит приблизить целевое действие, которое требуется достигнуть требуемого результата. Но, опять же, не слишком полностью. Но, по крайней мере, с этим уже можно будет работать.

Также здесь, вероятно, будут использовать классы как контейнеры для схем, для которых будут действовать соответствующие правила сборки в регистры, у которых будут какие-то свои правила рендеринга.

## Предварительные выводы

Чисто технически напрашивается решение следующего вида.

Для класса schemer становится важным то, какой аргумент прокидывается в качестве этого самого значения `refPrefix`. И это уже используется в релевантных структурах, требующих соответствующей сборки.

То есть, для сборки OpenAPI схемы будет подставляться значение `/components/schemas`, для сборки OpenAI запроса будет подставляться `/$defs`.

То есть получается следующая механика

Ранее конфигурацией было значение вида

```ts
Schemer.config({
  render: (target: ClassConstructor) => {
    //
    return targetConstructorToSchema(target, {
      classTransformerMetadataStorage: defaultMetadataStorage,
      refPointerPrefix: OpenApi.refPointerPrefix,
    });
  },
});
```

Теперь оно должно стать вида

```ts
Schemer.config({
  render: (target: ClassConstructor, refPointerPrefix: string) => {
    //
    return targetConstructorToSchema(target, {
      classTransformerMetadataStorage: defaultMetadataStorage,
      refPointerPrefix,
    });
  },
});
```

Что для конструкций других нотаций также должно применяться по аналогичному принципу.

Также напрашивается и то, чтобы сделать что-то типа функции контейнерного рендеринга. Когда подаётся на вход `ClassConstructor` и структура, куда следует поместить соответствующий результат.

Также кажется, что как-будто механику внедрения `Schemer` в декоратор можно поменять. То есть помещать туда не инстанс, а класс, в котором настраивается рендерер, а конкретно взятый `refPointer` передаётся в конструктор при использовании конкретного рендеринга в моменте.

То есть процедура извлечения будет следующей

```ts

const { Schemer } = AomSchemer.instance(class);

const schemer = new Schemer(`/$defs`);

schemer.render(target);

schemer.structure(target, {});
```

Это выглядит как-будто наиболее логично, и вообще как-будто создание в моменте такого значения может являться тем самым контейнером для наполнения результатом.

## Альтернативная версия

Немного неочевидно, но вполне себе реалистично смотрится следующая версия, по которой можно достичь вполне себе универсального правила применения всех требуемых задач. И ответ состоит в том, чтобы создать свои собственные декораторы, которые будут хранить скалярные значения, экспортируемые в собственный JSON, на основании которых будут вызываться декораторы class-validator/class-transformer/class-validator-jsonschema.

То есть чисто технически я всё-равно замыкаюсь на то, чтобы использовать комплекс class-validator, однако в текущей ситуации это уже смотрится как выход из ситуации, потому что:

1. позволяет уйти от механики создания специфического рендеринга, и свести его исключительно к тому, чтобы передавать `refPrefix`, и тем самым достигать требумого результата.
2. позволяет создавать конструкции, которые чисто технически способны генерировать код классов, в которых будут восстановлены все требуемые декораторы. При этом допускается возможность использования собственных префиксов, чтобы создавать типы со своими именами (для исключения вероятного пересечения в пространстве имён).
3. не противоречит механике добавления своих собственных декораторов того же семейства в тех случаях, где они необходимы.
4. вполне вероятно также позволят делать типичную валидацию, потому что так или иначе все схемы будут декорироваться по тому же принципу, и валидацию можно выполнять как базовую операцию.
5. не надо использовать костыли с альтернативными вариантами jsonschema-генераторов, потому что будет свой собственный костыль

Таким образом следует локализовать то пространство вариантов, в котором будет существовать данное решение, и определить формат, как оно будет выглядеть.

Видится следующий вариант: это декораторы типа `Schema.String`, `Schema.Date`, `Schema.Number`, `Schema.Type`, `Schema.Boolean`, каждый из которых содержит свои дополнительные атрибуты, специфичные для каждого типа, а также поддерживает дополнительные декораторы (хотя может быть этого и не надо).

### Как это может выглядеть?

```ts
@Entity()
@ComponentSchema()
@JSONSchema({ description: "Адресные точки" })
export class Points extends EnabledEntity {
  @Schema.String({ isOptional: true, description: "Код точки", nullable: true })
  @Sanitize()
  @Property({ type: t.text, nullable: true })
  code?: string;

  @Schema.String({ isOptional: true, description: "Исходный адрес", nullable: true })
  @Sanitize()
  @Property({ type: t.text, nullable: true })
  rawAddress?: string;

  @Schema.Type({ type: () => Address, isOptional: true, description: "Адрес" })
  @ManyToOne({ entity: () => Addresses, eager: true })
  address?: Addresses;

  @Schema.Boolean({ isOptional: true, description: "Признак ошибочного адреса", default: false })
  @Property({ type: t.boolean, default: false })
  isInvalidAddress: boolean;

  @Schema.Type({ type: () => Orgs, exclude: true, description: "Организация" })
  @ManyToOne({ entity: () => Orgs, hidden: true })
  org: Orgs;

  @Schema.Type({
    type: () => UsersOrgs,
    exclude: true,
    description: "Пользователь создавший запись",
  })
  @ManyToOne({ entity: () => UsersOrgs, hidden: true })
  createdByOrgUser: UsersOrgs;
}
```

Соответственно, рассмотрим вариант где в том числе используются массивы.

```ts
@ComponentSchema(openAiSchemer)
export class BookTest {
  @Schema.Type({ type: () => BookTestSummary, description: "Сводка по книге" })
  summary: BookTestSummary;

  @Schema.Type({
    type: () => BookChaptersDetails,
    isArray: true,
    description: "Содержание указанных глав (если указаны их номера или названия)",
  })
  chapters_data: BookChaptersDetails[];

  @Schema.Type({
    type: () => BookTestComparsion,
    isArray: true,
    description: "Сравнение с другими книгами (если указаны авторы)",
  })
  comparsion: BookTestComparsion[];

  @Schema.Boolean({ description: "Ошибка данных" })
  error: boolean;
}

@ComponentSchema(openAiSchemer)
export class BookChaptersDetails {
  @Schema.String({ description: "Название", required: true })
  name: string;

  @Schema.String({ description: "Синопсис главы", required: true })
  synopsis: string;

  @Schema.Boolean({ description: "Ошибка данных (глава не найдена)" })
  error: boolean;
}

@ComponentSchema(openAiSchemer)
export class BookTestComparsion {
  @Schema.String({ description: "Название" })
  title: string;

  @Schema.String({ description: "Автор" })
  author: string;

  @Schema.String({ description: "Синопсис произведения" })
  synopsis: string;

  @Schema.String({ description: "Смысловая разница" })
  difference: string;

  @Schema.Boolean({ description: "Ошибка данных (автор или книга неизвестны)" })
  error: boolean;
}

@ComponentSchema(openAiSchemer)
export class BookTestSummary {
  @Schema.String({ description: "Название" })
  title: string;

  @Schema.String({ description: "Автор" })
  author: string;

  @Schema.String({ description: "Синопсис произведения" })
  synopsis: string;

  @Schema.String({ description: "Список глав и частей произведения", isArray: true })
  structure: string[];
}
```

То есть из динамических значений в данном случае используется отсылка на связаные типы, которые в общем случае являются точно такими же описанными конструктами, которые можно собирать по тем же правилам. И при этом к ним возможно применение префиксов для их собственного именования при регенерации структуры.

Возможно также следует подобрать более корректное название для этого конструкта, чтобы оно не так слишком перекликалось с другими популярными логическими конструктами. Однако, полагаю, я смогу это сделать по ходу дела. Сейчас главное в принципе начать и проработать базовую механику.

Итого, к чему в результате сводится продуктивная работа?

1. Избавляемся от того, что в Schemer описываем конкретную механику рендера. Вместо этого используется стандартная процедура через указание класса и refPrefix-значения.
2. Необходимо также сделать механику наследований через декоратор `ComponentSchema`, чтобы можно было переносить на потомков соответствующие установки и повторять декораторы.
3. Дополнительно переносим механику mapped-types внутрь, прикручивая их исключительно к тем декораторам и их значениям, которые хранятся в сыром виде, и могут быть использованы повторно.

Таким образом получается "вещь в себе", которой уже можно пользоваться, и которую можно соответствующим образом развить.

Следом за этим надо добавить следующее:

1. Генерация чистого ts для конкретно взятого `ComponentSchema` класса
2. Генерация "сырой" структуры, которая позволяет получить ts код
3. Интеграция этого функционала в transfer
