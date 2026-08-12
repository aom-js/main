import { Schemer, AomSchemas } from "./module";

// нативные конструкторы скаляров → JSON Schema: тот же словарь, что у design:type и @Type()
const SCALAR_SCHEMAS = new Map<unknown, Record<string, any>>([
  [String, { type: "string" }],
  [Number, { type: "number" }],
  [Boolean, { type: "boolean" }],
  [Date, { type: "string", format: "date-time" }],
]);

/** Строковые имена скалярных типов → JSON Schema; словарь для @TopicSchema и подобных описаний */
export const SCALAR_TYPE_SCHEMAS: Record<string, Record<string, any>> = {
  string: { type: "string" },
  number: { type: "number" },
  integer: { type: "integer" },
  boolean: { type: "boolean" },
  date: { type: "string", format: "date-time" },
};

/**
 * Сборщик компонентных схем: превращает ComponentSchema-классы в $ref-ссылки,
 * рекурсивно собирая каскад связанных схем (connections) в словарь components.
 * Скаляры принимаются именем ("string") или конструктором (String), `[T]` разворачивается
 * в массив (`{type: "array", items: ...}`), готовые JSON Schema объекты идут как есть.
 * Используется генерацией OpenAPI (router) и дистрибуцией изоляторов (transfer).
 */
export class SchemasCollector {
  readonly components = new Map<string, any>();

  private schemer: Schemer;

  constructor(schemer: Schemer) {
    this.schemer = schemer;
  }

  extract(schema: any): any {
    if (typeof schema === "string") {
      const named = SCALAR_TYPE_SCHEMAS[schema];
      if (!named) {
        throw new Error(
          `SchemasCollector.extract: unknown scalar type name "${schema}" (allowed: ${Object.keys(SCALAR_TYPE_SCHEMAS).join(", ")})`,
        );
      }
      return { ...named };
    }
    // [T] — массив значений типа T: ровно один элемент, задающий тип элементов
    if (Array.isArray(schema)) {
      if (schema.length !== 1) {
        throw new Error(
          `SchemasCollector.extract: array type must hold exactly one element type, e.g. ["string"]`,
        );
      }
      return { type: "array", items: this.extract(schema[0]) };
    }
    const scalar = SCALAR_SCHEMAS.get(schema);
    if (scalar) {
      return { ...scalar };
    }
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
    // класс без @ComponentSchema не бывает валидной схемой ни для одного потребителя:
    // молча уехал бы конструктором и потерялся при JSON-сериализации — падаем сразу
    if (typeof schema === "function") {
      throw new Error(
        `SchemasCollector.extract: "${schema.name || schema}" is not a ComponentSchema class or scalar constructor`,
      );
    }
    return schema;
  }
}
