import { SCALAR_TYPE_SCHEMAS } from "@aom-js/schemer";

/**
 * Обратные правила docs/isolators.md §6: JSON Schema из дескриптора → материал
 * для восстановления исходных aom-классов (фабрика PropertySchema, TS-тип, параметры).
 */

/** Пер-свойству ключи схемы, переносимые в параметры PropertySchema.* без изменений */
const PASSTHROUGH_KEYS = ["description", "deprecated", "nullable", "default", "examples"];

/** Ключи, которые потребляет сам разбор типа */
const CONSUMED_KEYS = ["type", "format", "items", "$ref"];

/** имя скаляра → [фабрика PropertySchema, TS-тип] */
const SCALAR_FACTORIES: Record<string, [InversedSchema["factory"], string]> = {
  string: ["String", "string"],
  number: ["Number", "number"],
  integer: ["Number", "number"],
  boolean: ["Boolean", "boolean"],
  date: ["Date", "Date"],
};

/** Разобранное свойство: чем декорировать и какой TS-тип писать в сигнатуру */
export interface InversedSchema {
  /** фабрика PropertySchema.* */
  factory: "String" | "Number" | "Boolean" | "Date" | "Type";

  /** имя компонента для Type-связи ($ref) */
  ref?: string;

  isArray?: boolean;

  /** TS-тип значения (без учёта isArray) */
  tsType: string;

  /** параметры, переносимые в вызов фабрики */
  params: Record<string, unknown>;

  /** ключи исходной схемы, которые скелет пока не переносит (minLength, pattern, enum, ...) */
  dropped: string[];
}

/** Имя компонента из $ref-ссылки: берется хвост после последнего "/" */
export function refName(ref: string): string {
  return ref.slice(ref.lastIndexOf("/") + 1);
}

/** Имя скаляра по его JSON Schema ({type, format} — точное совпадение со словарём schemer) */
export function scalarNameOf(schema: Record<string, any>): string | undefined {
  return Object.keys(SCALAR_TYPE_SCHEMAS).find((name) => {
    const scalar = SCALAR_TYPE_SCHEMAS[name];
    return schema.type === scalar.type && schema.format === scalar.format;
  });
}

/** Разбор схемы свойства компонента в описание PropertySchema-декоратора */
export function inverseSchema(schema: Record<string, any>): InversedSchema {
  if (schema.$ref) {
    return withPassthrough(schema, {
      factory: "Type",
      ref: refName(schema.$ref),
      tsType: refName(schema.$ref),
      params: {},
      dropped: [],
    });
  }
  if (schema.type === "array" && schema.items) {
    const inner = inverseSchema(schema.items);
    if (inner.isArray) {
      // ponytail: вложенные массивы не восстанавливаем — отметим потерю, оставим плоский
      inner.dropped.push("items (nested array)");
    }
    return withPassthrough(schema, { ...inner, isArray: true });
  }
  const scalar = scalarNameOf(schema);
  if (scalar) {
    const [factory, tsType] = SCALAR_FACTORIES[scalar];
    return withPassthrough(schema, { factory, tsType, params: {}, dropped: [] });
  }
  throw new Error(`codegen: cannot inverse schema ${JSON.stringify(schema)}`);
}

/** Переносит сквозные параметры и фиксирует непереносимые ключи */
function withPassthrough(schema: Record<string, any>, result: InversedSchema): InversedSchema {
  Object.keys(schema).forEach((key) => {
    if (PASSTHROUGH_KEYS.includes(key)) {
      result.params[key] = schema[key];
    } else if (!CONSUMED_KEYS.includes(key) && !result.dropped.includes(key)) {
      result.dropped.push(key);
    }
  });
  return result;
}
