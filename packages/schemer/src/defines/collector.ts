import { ClassType } from "@aom-js/core";
import { Schemer, AomSchemas } from "./module";

/**
 * Scalar type names → JSON Schema, keyed by string (`"string"`, `"number"`, `"integer"`,
 * `"boolean"`, `"date"`) rather than by constructor — the dictionary `\@TopicSchema` (`@aom-js/transfer`)
 * and `@aom-js/codegen` use to describe/recognize scalars. `date` matches the exact shape rendered by
 * `PropertySchema.Date` (`oneOf` of `date`/`date-time` string formats); the constructor-keyed
 * `SCALAR_SCHEMAS` below reuses these entries, so `extract(Date)` and `extract("date")` agree.
 */
export const SCALAR_TYPE_SCHEMAS: Record<string, Record<string, any>> = {
  string: { type: "string" },
  number: { type: "number" },
  integer: { type: "integer" },
  boolean: { type: "boolean" },
  // the shape class-validator-jsonschema produces for IsDate (KI-SCHEMER-08) — otherwise
  // PropertySchema.Date renders differently and codegen won't recognize it as the "date" scalar
  date: {
    oneOf: [
      { format: "date", type: "string" },
      { format: "date-time", type: "string" },
    ],
  },
};

// native scalar constructors → JSON Schema: the same dictionary used by design:type and @Type();
// entries are those of SCALAR_TYPE_SCHEMAS, so Date renders like PropertySchema.Date (KI-SCHEMER-08)
const SCALAR_SCHEMAS = new Map<unknown, Record<string, any>>([
  [String, SCALAR_TYPE_SCHEMAS.string],
  [Number, SCALAR_TYPE_SCHEMAS.number],
  [Boolean, SCALAR_TYPE_SCHEMAS.boolean],
  [Date, SCALAR_TYPE_SCHEMAS.date],
]);

/**
 * Turns `\@ComponentSchema` classes into `$ref` links, recursively collecting the whole cascade of
 * related schemas (via `AomSchemas.connections`, i.e. `PropertySchema.Type`) into a flat
 * `components` map. Scalars are accepted by name (`"string"`) or by constructor (`String`), `[T]`
 * unwraps into a JSON Schema array (`{type: "array", items: ...}`), and already-built JSON Schema
 * objects pass through unchanged. Used by OpenAPI generation (`@aom-js/router`) and isolator
 * distribution (`@aom-js/transfer`).
 */
export class SchemasCollector {
  /** `$ref`-eligible schemas collected so far, keyed by component class name. */
  readonly components = new Map<string, any>();

  // component classes behind the names in components — needed by foldSchemas (codegen takes the classes from here)
  /** Component classes behind each entry in `components`, keyed the same way — the input `foldSchemas` needs. */
  readonly classes = new Map<string, ClassType>();

  private schemer: Schemer;

  /** @param schemer - renderer used to turn each newly discovered component into a JSON Schema */
  constructor(schemer: Schemer) {
    this.schemer = schemer;
  }

  /**
   * Extracts `schema` into its `$ref`/JSON-Schema-literal form, registering any component classes it
   * touches (and everything they reference through `PropertySchema.Type`) into `components`/`classes`.
   *
   * Dispatches on the runtime shape of `schema`, in order: a string looks up `SCALAR_TYPE_SCHEMAS`;
   * an array must hold exactly one element type (`["string"]`) and becomes `{type: "array", items}`;
   * a scalar constructor (`String`/`Number`/`Boolean`/`Date`) looks up the internal `SCALAR_SCHEMAS`;
   * a `\@ComponentSchema` class is registered (schema fixed *before* walking its connections, so a
   * self-referencing component like `Orgs.parentOrg → Orgs` cannot recurse forever) and returned as
   * `{$ref}`; any other function is an error; anything else (an already-built JSON Schema object) is
   * returned unchanged. Registration is idempotent — extracting the same component twice renders it
   * only once.
   *
   * @param schema - a scalar name/constructor, `[T]`, a `\@ComponentSchema` class, or a JSON Schema object
   * @returns the `$ref`/array/scalar/literal form of `schema`
   * @throws {Error} for an unknown scalar name, a malformed `[T]` array, or a function that is
   * neither a scalar constructor nor a `\@ComponentSchema` class
   *
   * @example
   * ```ts
   * import { ComponentSchema, PropertySchema, Schemer, SchemasCollector } from "@aom-js/schemer";
   *
   * \@ComponentSchema()
   * class Toy {
   *   \@PropertySchema.String({})
   *   label!: string;
   * }
   *
   * \@ComponentSchema()
   * class Pet {
   *   \@PropertySchema.Type({ value: () => Toy })
   *   toy!: Toy;
   * }
   *
   * const collector = new SchemasCollector(new Schemer("#/components/schemas/"));
   * collector.extract(Pet); // { $ref: "#/components/schemas/Pet" }
   * // collector.components now also has an entry for "Toy"
   * ```
   */
  extract(schema: any): any {
    if (typeof schema === "string") {
      const named = SCALAR_TYPE_SCHEMAS[schema];
      if (!named) {
        throw new Error(
          `SchemasCollector.extract: unknown scalar type name "${schema}" (allowed: ${Object.keys(SCALAR_TYPE_SCHEMAS).join(", ")})`,
        );
      }
      // deep copy: "date" carries a nested oneOf — mutating the result must not corrupt the dictionary
      return structuredClone(named);
    }
    // [T] — an array of values of type T: exactly one element, giving the element type
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
      return structuredClone(scalar);
    }

    const saved = AomSchemas.checkExists(schema);
    if (saved && saved.isComponentSchema) {
      const { name } = saved._.target;
      if (!this.components.has(name)) {
        // fix the render first (guards against cycles), then walk the connections
        this.components.set(name, this.schemer.render(schema));
        this.classes.set(name, schema as ClassType);
        saved.connections.forEach((connection) => {
          this.extract(Reflect.apply(connection, null, []));
        });
      }
      return { $ref: `${this.schemer.refPointerPrefix}${name}` };
    }
    // a class without @ComponentSchema is never a valid schema for any consumer:
    // it would silently pass through as a constructor and get lost on JSON serialization — fail fast instead
    if (typeof schema === "function") {
      throw new Error(
        `SchemasCollector.extract: "${schema.name || schema}" is not a ComponentSchema class or scalar constructor`,
      );
    }
    return schema;
  }
}
