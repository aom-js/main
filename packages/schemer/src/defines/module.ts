/// <reference path="./class-transformer-cjs-storage.d.ts" />
// This directive is mandatory: monorepo packages resolve against each other through src
// (package.json → main: ./src/index.ts), and a neighboring package's `include` doesn't pick up
// this ambient file — without the reference, tsc for the other package fails on the import below with TS7016
import { AomCore, ClassType, Property } from "@aom-js/core";
import { defaultMetadataStorage } from "class-transformer/cjs/storage.js";
import { targetConstructorToSchema } from "class-validator-jsonschema";
import { type ClassConstructor, plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";

import {
  ConnectionSchema,
  CommonDescriptionsProperties,
  ClassDescriptionsProperties,
  SchemaTypes,
} from "./types";

/**
 * Per-class/per-property metadata node of the schemer meta-class (`AomCore` pattern from
 * `@aom-js/core`). `ComponentSchema.checkExists(Class)` is the way to read a class's raw
 * `PropertySchema` params from outside the decorator flow — `mapped-types`, `SchemasCollector`,
 * `foldSchemas` and `@aom-js/api`'s `ParamsBuilder` all go through it instead of re-deriving state
 * from the applied class-validator decorators.
 */
export class AomSchemas extends AomCore {
  /** Names of properties on this class that have a `PropertySchema.*` factory applied. */
  properties: Set<Property> = new Set();

  /** True once `\@ComponentSchema()` has decorated the class this node belongs to. */
  isComponentSchema: boolean;

  /**
   * Property name → lazy class reference, populated by `PropertySchema.Type`. Walked by
   * `SchemasCollector.extract` to follow the `$ref` graph without re-scanning every property.
   */
  connections: Map<Property, ConnectionSchema> = new Map();

  /** Which `PropertySchema.*` factory decorated this property. */
  schemaName?: SchemaTypes;

  /**
   * Raw params object passed to the `PropertySchema.*` factory, kept verbatim — the source that
   * mapped-types re-apply, `foldSchemas` serializes, and `@aom-js/api`'s `ParamsBuilder` reads
   * directly, independent of which class-validator decorators ended up being applied.
   */
  schemaParams?: CommonDescriptionsProperties;

  // params passed to @ComponentSchema(...) — only when an argument was actually given;
  // needed by foldSchemas (currently only part of them goes into the JSON Schema via JSONSchema())
  /**
   * Raw params passed to `\@ComponentSchema(params)`, present only when an argument was actually
   * given — read by `foldSchemas` to restore `\@ComponentSchema(params)` in generated code.
   */
  componentParams?: ClassDescriptionsProperties;

  // marks an anonymous class produced by a mapped-type helper (Pick/Omit/Partial/Intersection) —
  // foldSchemas unfolds it into extends instead of referencing it by name
  /**
   * Set by `PartialType`/`PickType`/`OmitType`/`IntersectionType` on the anonymous class they
   * return. Tells `foldSchemas` to unfold this class into an `extends: {$mapped: ...}` structure
   * instead of referencing it by name — the four helpers share fixed class names and would
   * otherwise collide.
   */
  mapped?: {
    kind: "Pick" | "Omit" | "Partial" | "Intersection";
    of: ClassType[];
    keys?: string[];
  };
}

// stopping point when walking up the prototype chain (ComponentSchema.inherit, foldSchemas.extends):
// mapped classes (Pick/Omit/Partial/Intersection) get their own @ComponentSchema(), so isComponentSchema
// is already true for them too — no separate $.mapped check is needed here
/**
 * True when `$` belongs to a class already decorated with `\@ComponentSchema()`. Shared stopping
 * condition for both `ComponentSchema`'s own prototype-chain walk (inherit undecorated intermediate
 * classes, stop at the nearest component ancestor) and `foldSchemas`'s `extends` resolution.
 *
 * @param $ - a metadata node, or `undefined` when the class has no `AomSchemas` node at all
 * @returns whether the node's class is a component schema
 */
export function isComponentAncestor($: AomSchemas | undefined): boolean {
  return !!$?.isComponentSchema;
}

/**
 * Renders `\@ComponentSchema` classes to JSON Schema and validates plain data against them. A thin
 * wrapper over `class-validator-jsonschema`/`class-validator`/`class-transformer` — schemer has no
 * renderer of its own. `refPointerPrefix` lives on the instance, not the class, so the same DTO can
 * render under different `$ref` roots for different consumers (`@aom-js/router`, `@aom-js/api` and
 * `@aom-js/transfer` each construct their own `Schemer`).
 */
export class Schemer {
  readonly refPointerPrefix: string;

  /**
   * @param refPointerPrefix - prefix prepended to every generated `$ref`, e.g. `"#/components/schemas/"`
   */
  constructor(refPointerPrefix: string) {
    this.refPointerPrefix = refPointerPrefix;
  }

  // function that renders the data
  /**
   * Renders `target` to a JSON Schema object.
   *
   * Not cached — call once per render and cache the result yourself if needed (`SchemasCollector`
   * does this for `$ref` graphs). `required` lists properties without `isOptional`/`ValidateIf`:
   * class-validator-jsonschema treats conditional validation as a sign of optionality.
   *
   * @param target - a class decorated with `\@ComponentSchema()`
   * @returns a JSON Schema object for `target`
   *
   * @example
   * ```ts
   * import { ComponentSchema, PropertySchema, Schemer } from "@aom-js/schemer";
   *
   * \@ComponentSchema({ description: "User" })
   * class UserDto {
   *   \@PropertySchema.String({ minLength: 2 })
   *   name!: string;
   * }
   *
   * const schemer = new Schemer("#/components/schemas/");
   * const schema = schemer.render(UserDto);
   * // schema.properties.name === { type: "string", minLength: 2 }
   * ```
   */
  render(target: ClassType): ReturnType<typeof targetConstructorToSchema> {
    return targetConstructorToSchema(target, {
      classTransformerMetadataStorage: defaultMetadataStorage,
      refPointerPrefix: this.refPointerPrefix,
    });
  }

  /**
   * Converts plain data to an instance of `constructor` and validates it.
   *
   * Runs `plainToInstance` (with `exposeDefaultValues`/`strategy: "exposeAll"`/`enableCircularCheck`)
   * and then `validateSync` with `whitelist: true` — properties without any validator are stripped
   * from `values`, so unknown/extra input fields are silently dropped rather than rejected.
   *
   * @param constructor - a class decorated with `\@ComponentSchema()`
   * @param data - plain object, e.g. a parsed request body
   * @returns `values` (the coerced instance, with unvalidated properties stripped) and `errors`
   * (empty when valid)
   *
   * @example
   * ```ts
   * import { ComponentSchema, PropertySchema, Schemer } from "@aom-js/schemer";
   *
   * \@ComponentSchema()
   * class LoginDto {
   *   \@PropertySchema.String({ minLength: 1 })
   *   login!: string;
   * }
   *
   * const schemer = new Schemer("#/components/schemas/");
   * const { values, errors } = schemer.validate(LoginDto, { login: "" });
   * // errors.length > 0 — minLength violated
   * ```
   */
  validate<T extends ClassConstructor<unknown>>(constructor: T, data: object) {
    const values = plainToInstance(
      constructor,
      { ...data },
      {
        exposeDefaultValues: true,
        strategy: "exposeAll",
        exposeUnsetFields: false,
        enableCircularCheck: true,
      },
    ) as T;

    const errors = validateSync(values, { whitelist: true });

    return { values, errors };
  }
}
