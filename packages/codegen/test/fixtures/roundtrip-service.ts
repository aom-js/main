// Фикстура сквозного теста codegen (../roundtrip.test.ts), см.
// docs/superpowers/plans/2026-09-14-codegen-folding-design.md (подзадача #5, раздел 11).
// По образцу приложения: IsUUID в decorators, Date nullable, Enum (isArray + enumName),
// Type (isArray + цикл ссылок A→B→A), Pick/Partial/IntersectionType (включая вложенный mapped),
// параметры @ComponentSchema, наследование компонент→компонент и один декоратор, который
// молча теряется при свёртке (Transform — не class-validator).
import { IsUUID } from "class-validator";
import { Transform } from "class-transformer";
import {
  ComponentSchema,
  PropertySchema,
  PickType,
  PartialType,
  IntersectionType,
} from "@aom-js/schemer";
import { Transfer, Isolator, ResponseTopic, TopicSchema } from "@aom-js/transfer";

export const transfer = new Transfer({
  instanceName: "codegen-roundtrip",
  instanceKey: "r1",
  publisher: () => {},
  subscriber: () => {},
});

// наследование компонент → компонент; IsUUID среди decorators; Date nullable
@ComponentSchema({ description: "Базовая сущность", deprecated: true })
export class BaseEntity {
  @PropertySchema.String({ description: "ID", decorators: [IsUUID()] })
  id!: string;

  @PropertySchema.Date({ description: "Дата удаления", nullable: true })
  deletedAt!: Date | null;
}

@ComponentSchema()
export class ChildEntity extends BaseEntity {
  // Transform — декоратор class-transformer, не class-validator: foldSchemas молча его теряет
  @PropertySchema.String({ decorators: [Transform(({ value }) => value)] })
  note!: string;
}

enum Priority {
  Low = "low",
  High = "high",
}

@ComponentSchema()
export class TaskDto {
  // enumName не задан → имя по умолчанию "TaskDtoPriorities"
  @PropertySchema.Enum({ value: Priority, isArray: true })
  priorities!: Priority[];

  @PropertySchema.Enum({ value: { OPEN: "open", CLOSED: "closed" }, enumName: "TaskStatus" })
  status!: string;
}

// цикл ссылок A→B→A через Type; isArray на связи
@ComponentSchema()
export class NodeA {
  @PropertySchema.String({})
  label!: string;

  @PropertySchema.Type({ value: () => NodeB, isArray: true })
  children!: NodeB[];
}

@ComponentSchema()
export class NodeB {
  @PropertySchema.String({})
  label!: string;

  @PropertySchema.Type({ value: () => NodeA })
  parent!: NodeA;
}

// mapped-types, включая вложенный (PartialType внутри IntersectionType)
@ComponentSchema({ description: "База для mapped-types" })
export class MixBase {
  @PropertySchema.String({})
  name!: string;

  @PropertySchema.Number({})
  age!: number;
}

@ComponentSchema()
export class MixExtra {
  @PropertySchema.Boolean({})
  active!: boolean;
}

@ComponentSchema()
export class PickedDto extends PickType(MixBase, ["name"]) {
  @PropertySchema.String({})
  suffix!: string;
}

@ComponentSchema()
export class PartialDto extends PartialType(MixBase) {}

@ComponentSchema()
export class IntersectedDto extends IntersectionType(MixExtra, PartialType(MixBase)) {}

@Isolator(transfer, { distributed: true })
export class RoundtripService {
  @ResponseTopic()
  @TopicSchema({ args: [{ entity: ChildEntity }], returns: ChildEntity })
  static async saveEntity(_entity: ChildEntity): Promise<ChildEntity> {
    return undefined as never;
  }

  @ResponseTopic()
  @TopicSchema({ args: [{ task: TaskDto }], returns: TaskDto })
  static async saveTask(_task: TaskDto): Promise<TaskDto> {
    return undefined as never;
  }

  @ResponseTopic()
  @TopicSchema({ args: [{ node: NodeA }], returns: NodeA })
  static async saveNode(_node: NodeA): Promise<NodeA> {
    return undefined as never;
  }

  @ResponseTopic()
  @TopicSchema({ args: [{ mix: IntersectedDto }, { picked: PickedDto }, { partial: PartialDto }] })
  static async saveMix(
    _mix: IntersectedDto,
    _picked: PickedDto,
    _partial: PartialDto,
  ): Promise<void> {
    return undefined as never;
  }
}
