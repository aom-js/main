# Холдер классов (отложенное применение декораторов)

Итак, я столкнулся с проблемой комбинирования декораторов разных компонент на классах, что приводит к конфликту их переноса при организации наследования, которая имеет тот же принцип, что и у меня.

То есть, когда я на стороне `aom` создаю свойство через `Reflect.defineProperty` это же действие повторяется на стороне того модуля, который пытается собрать своих потомков на основании данных в предках.

Например, эта ситуация точно повторяется с `mikro-orm`, и наверняка будет повторяться в других модулях подобного типа. Что требуется решать за счет того, что сами декораторы, которые финально переносятся на конечного потомка должны быть сконфигурированы на предках, но не применяться на них.

Как это будет выглядеть?

У меня есть некий набор классов, от которых идёт наследование, и которые сами по себе не создают сущностей в базе.

```ts
@ComponentSchema({ description: "Базовый состав сущностей÷" })
export class DefaultEntity extends WithJSONSchema {
  @PropertySchema.String({
    description: "ID",
    decorators: [IsUUID()],
  })
  @PrimaryKey({ type: "uuid", onCreate: () => uuidv7() })
  id: string = uuidv7();

  @PropertySchema.Date({
    description: "Дата создания",
    decorators: [],
  })
  @Property({ type: t.datetime })
  readonly createdAt: Date = new Date();

  @PropertySchema.Date({
    description: "Дата удаления",
    isOptional: true,
    nullable: true,
    decorators: [],
  })
  @Property({ nullable: true, type: t.datetime })
  deletedAt?: Date | null;

  @PropertySchema.Date({
    description: "Дата обновления",
    decorators: [],
  })
  @Property({ onUpdate: () => new Date(), type: t.datetime })
  readonly updatedAt: Date = new Date();

  assign<T extends Partial<this>>(values?: T) {
    Object.assign(this, values);
    return this;
  }
}

@ComponentSchema({ description: "Сущности с активацией" })
export class EnabledEntity extends DefaultEntity {
  @PropertySchema.Boolean({
    description: "Признак активности",
    decorators: [],
  })
  @Property({ type: t.boolean })
  enabled: boolean;
}
```

Однако те декораторы, которые установлены на их свойства следует перенести на конечного потомка, и только потом выполнить там. Во что превратится такой код?

Требуется создать декоратор, который будет принимать в себя другие декораторы, но не будет применять их до команды, которая сделав создание свойств в конечной сущности применит их на них.

```ts
@Delay(ComponentSchema({ description: "Базовый состав сущностей" }))
export class DefaultEntity extends WithJSONSchema {
  @Hold(
    PropertySchema.String({
      description: "ID",
      decorators: [IsUUID()],
    }),
    PrimaryKey({ type: "uuid", onCreate: () => uuidv7() }),
  )
  id: string = uuidv7();

  @Hold(
    PropertySchema.Date({
      description: "Дата создания",
      decorators: [],
    }),
    Property({ type: t.datetime }),
  )
  readonly createdAt: Date = new Date();

  @Hold(
    PropertySchema.Date({
      description: "Дата удаления",
      isOptional: true,
      nullable: true,
      decorators: [],
    }),
    Property({ nullable: true, type: t.datetime }),
  )
  deletedAt?: Date | null;

  @Hold(
    PropertySchema.Date({
      description: "Дата обновления",
      decorators: [],
    }),
    Property({ onUpdate: () => new Date(), type: t.datetime }),
  )
  readonly updatedAt: Date = new Date();

  assign<T extends Partial<this>>(values?: T) {
    Object.assign(this, values);
    return this;
  }
}

@Delay(ComponentSchema({ description: "Сущности с активацией" }))
export class EnabledEntity extends DefaultEntity {
  @Hold(
    PropertySchema.Boolean({
      description: "Признак активности",
      decorators: [],
    }),
    Property({ type: t.boolean }),
  )
  enabled: boolean;
}

@Apply(ComponentSchema({ description: "Контрагенты" }), Entity())
export class Contractors extends EnabledEntity {
  @PropertySchema.String({ maxLength: 128, description: "Название" })
  @Property({ type: t.string, length: 128 })
  name: string;

  @PropertySchema.Type({
    value: () => ContractorsPropertiesValues,
    nullable: true,
    isArray: true,
    description: "Свойства",
  })
  @Property({ type: "json", nullable: true })
  properties?: ContractorsPropertiesValues[] | null;

  @PropertySchema.Boolean({ description: "Собственный контрагент организации", nullable: true })
  @Property({ type: t.boolean, default: false, nullable: true })
  isInternal: boolean;

  @PropertySchema.Type({
    value: () => Countries,
    nullable: true,
    isOptional: true,
    description: "Страна",
  })
  @ManyToOne({ entity: () => Countries, eager: true, nullable: true })
  country?: Countries | null;

  @PropertySchema.Type({ value: () => Orgs, hidden: true, description: "Организация" })
  @ManyToOne({ entity: () => Orgs, hidden: true })
  org: Orgs;

  @PropertySchema.Type({ value: () => UsersOrgs, hidden: true, description: "Создан сотрудником" })
  @ManyToOne({ entity: () => UsersOrgs, hidden: true })
  createdByOrgUser: UsersOrgs;
}
```

При этом, что характерно, такой потомок не может являться сущностью, от которой можно будет повторно унаследовать аналогичную конструкцию, так что для такого типа действия следует будет создавать буферную сущность с "подвешенными" декораторами, от которой потом будет определен и первичный сущностный класс, и последующие потомки.

Что должно происходить внутри, и как должны различаться между собой вызовы декораторы на классах и на свойствах?

Внутри в первую очередь должно происходить накопление очереди, которая является свойством класса `AomMixer`, и перенос которой осуществляется при наследовании.

При этом декоратор для класса и для свойства должны иметь разные названия, так как они должны выполнять разные по своей функции действия.
