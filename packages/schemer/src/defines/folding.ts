// schemer's own schema-folding format for codegen (KI-CODEGEN-01) — see
// docs/superpowers/plans/2026-09-14-codegen-folding-design.md
import { ClassType, ClassConstructor } from "@aom-js/core";
import * as classValidator from "class-validator";
import { getMetadataStorage } from "class-validator";

import { AomSchemas, isComponentAncestor } from "./module";
import { ConnectionSchema, SchemaTypes } from "./types";

/**
 * A single JSON-serializable value inside a folded property's `params`. Plain JS values pass through
 * as-is; values that class-validator/class-transformer decorators would otherwise need a live
 * reference or a function for get a marker object instead, so the whole structure survives
 * `JSON.stringify`/`JSON.parse` round-trips over the transport bus:
 * - `{ $date }` — a `Date`, as `toISOString()`;
 * - `{ $regexp }` — a `RegExp`, as `[source, flags]`;
 * - `{ $ref }` — a `PropertySchema.Type` target, by component name;
 * - `{ $enum }` — a `PropertySchema.Enum` value, by key into `FoldedSchemas.enums`;
 * - `{ $validator, args }` — one decorator from `decorators`, by class-validator export name.
 *
 * `@aom-js/codegen` treats every one of these markers as untrusted input from the wire and validates
 * it again before turning it into source code — see that package's `safe.ts`.
 */
export type FoldedValue =
  | null
  | boolean
  | number
  | string
  | FoldedValue[]
  | { [key: string]: FoldedValue }
  | { $date: string } // Date → toISOString()
  | { $regexp: [source: string, flags: string] }
  | { $ref: string } // Type.value → component name
  | { $enum: string } // Enum.value → key into FoldedSchemas.enums
  | { $validator: string; args: FoldedValue[] }; // a decorators element; a class-validator export

/** One folded property: which `PropertySchema.*` factory decorated it, and its raw params, folded. */
export interface FoldedProperty {
  factory: SchemaTypes;
  params: Record<string, FoldedValue>;
}

/**
 * A folded component's parent along its `extends` chain: either the name of another component, or,
 * for an anonymous class produced by a mapped-type helper, a structural description of that helper
 * call (recursive — composed mapped-types like `IntersectionType(A, PartialType(B))` unfold fully).
 */
export type FoldedParent =
  | string
  | { $mapped: "Pick" | "Omit"; of: FoldedParent; keys: string[] }
  | { $mapped: "Partial"; of: FoldedParent }
  | { $mapped: "Intersection"; of: FoldedParent[] };

/** One folded `@ComponentSchema` class: its own (not inherited) properties, plus parent/params. */
export interface FoldedComponent {
  params?: { description?: string; deprecated?: boolean }; // only when an argument was actually given
  extends?: FoldedParent;
  properties: Record<string, FoldedProperty>; // own properties only, in declaration order
}

/**
 * Result of `foldSchemas`: a self-contained, JSON-serializable snapshot of a set of `@ComponentSchema`
 * classes, sufficient to reconstruct them without access to the original source (this is what
 * `@aom-js/transfer` puts on the wire and `@aom-js/codegen`'s `emitSchemas` turns back into TS).
 */
export interface FoldedSchemas {
  format: 1;
  components: Record<string, FoldedComponent>; // keys are sorted
  enums: Record<string, Record<string, string | number>>;
}

type EnumLike = Record<string, string | number>;

// mask for comparing validation metadata: RegExp/functions can't be compared by reference — coerce to a string
function mask(value: unknown): string {
  return JSON.stringify(value, (_key, v) =>
    v instanceof RegExp ? `/${v.source}/${v.flags}` : typeof v === "function" ? "<fn>" : v,
  );
}

interface CvMeta {
  type: string;
  name?: string;
  constraints: unknown[];
  each?: boolean;
  message?: unknown;
  groups?: string[];
  always?: boolean;
  context?: unknown;
}

// class-validator metadata that a decorator produces when applied to an empty property
function collectMetadata(decorator: PropertyDecorator): CvMeta[] {
  class Probe {}
  Reflect.decorate([decorator], Probe.prototype, "value");
  return getMetadataStorage()
    .getTargetValidationMetadatas(Probe, "", true, false)
    .map((m) => ({
      type: m.type,
      name: m.name,
      constraints: m.constraints ?? [],
      each: m.each,
      message: m.message,
      groups: m.groups,
      always: m.always,
      context: m.context,
    }));
}

// class-validator metadata name (e.g. "isUuid") → exported decorator name ("IsUUID");
// built from the module's flat ALL_CAPS constants — the only exception is isLength → Length
function buildValidatorByName(): Record<string, string> {
  const cv = classValidator as unknown as Record<string, unknown>;
  const decoratorNames = Object.keys(cv).filter(
    (k) => /^[A-Z]/.test(k) && typeof cv[k] === "function",
  );
  const byName: Record<string, string> = { isLength: "Length" };
  Object.keys(cv)
    .filter((k) => /^[A-Z_]+$/.test(k) && typeof cv[k] === "string")
    .forEach((constKey) => {
      const metaName = cv[constKey] as string;
      const fn = decoratorNames.find((name) => name.toUpperCase() === constKey.replace(/_/g, ""));
      if (fn) byName[metaName] = fn;
    });
  return byName;
}

const validatorByName = buildValidatorByName();

// the set of export names the fold could ever produce (the values of validatorByName) —
// codegen checks $validator against it when unfolding: this set bounds the whole range of
// functions decorateProperty can invoke on import; the fold never puts other class-validator
// exports (useContainer, registerDecorator, validateSync, ...) into $validator
const foldedValidatorNames = new Set(Object.values(validatorByName));

/**
 * True if `name` is an export name `foldSchemas` could actually place into a `{ $validator }` marker
 * — i.e. a class-validator decorator factory it knows how to fold, not just any function exported by
 * `class-validator`. `@aom-js/codegen` uses this as a whitelist when restoring `$validator` markers
 * from an untrusted descriptor, rejecting exports like `useContainer`/`registerDecorator`/`validateSync`
 * that are real class-validator exports but not property-decorator factories.
 *
 * @param name - a candidate export name from a `{ $validator }` marker
 * @returns whether `foldSchemas` could have produced this name
 */
export function isFoldedValidatorName(name: string): boolean {
  return foldedValidatorNames.has(name);
}

// fold a single decorator into { $validator, args }, or skip it if it can't be reconstructed
// (not class-validator, a custom registerDecorator, multiple metadata entries at once, no
// matching arguments found) — appendix A of the project; an accepted loss, per the author's decision
function foldDecorator(
  decorator: PropertyDecorator,
): { $validator: string; args: FoldedValue[] } | undefined {
  const metas = collectMetadata(decorator);
  if (metas.length !== 1) return undefined;
  const [meta] = metas;
  const validatorName = meta.name ? validatorByName[meta.name] : undefined;
  if (!validatorName) return undefined;

  const factory = (
    classValidator as unknown as Record<string, (...args: unknown[]) => PropertyDecorator>
  )[validatorName];

  const options: Record<string, unknown> = {};
  if (meta.each) options.each = true;
  if (meta.groups?.length) options.groups = meta.groups;
  if (meta.always) options.always = true;
  if (typeof meta.message === "string") options.message = meta.message;
  if (meta.context !== undefined) options.context = meta.context;
  const hasOptions = Object.keys(options).length > 0;

  const expected = mask(metas);
  const constraints = meta.constraints;
  // try arities from full down to empty — the minimal arguments confirmed by re-applying the decorator
  for (let count = constraints.length; count >= 0; count--) {
    const args = constraints.slice(0, count);
    while (args.length && args[args.length - 1] === undefined) args.pop();
    if (hasOptions) {
      while (args.length < count) args.push(undefined);
      args.push(options);
    }
    try {
      if (mask(collectMetadata(factory(...args))) === expected) {
        return { $validator: validatorName, args: args.map((value) => foldValue(value) ?? null) };
      }
    } catch {
      // signature didn't match — try a shorter one
    }
  }
  return undefined; // no minimal arguments were found (equivalent to UNVERIFIED from the probe) — also a skip
}

function foldDecorators(
  decorators: PropertyDecorator[],
): Array<{ $validator: string; args: FoldedValue[] }> {
  const result: Array<{ $validator: string; args: FoldedValue[] }> = [];
  decorators.forEach((decorator) => {
    const folded = foldDecorator(decorator);
    if (folded) result.push(folded);
  });
  return result;
}

// generic recursive folding of a param value: markers for Date/RegExp, unmarked functions are dropped
// (message functions and the like — the author's decision, same logic as for decorators)
function foldValue(value: unknown): FoldedValue | undefined {
  if (value === null) return null;
  if (value instanceof Date) return { $date: value.toISOString() };
  if (value instanceof RegExp) return { $regexp: [value.source, value.flags] };
  if (Array.isArray(value)) {
    // an unmarked element (a function, etc.) is replaced with null instead of being dropped — otherwise
    // the indexes of the remaining elements would shift
    return value.map((item) => foldValue(item) ?? null);
  }
  if (typeof value === "function") return undefined;
  if (typeof value === "object") {
    const result: Record<string, FoldedValue> = {};
    Object.entries(value).forEach(([key, item]) => {
      const folded = foldValue(item);
      if (folded !== undefined) result[key] = folded;
    });
    return result;
  }
  return value as FoldedValue;
}

// forward enum pairs only (without the reverse keys TS adds to numeric enums)
function forwardEnumEntries(source: EnumLike): Record<string, string | number> {
  const result: Record<string, string | number> = {};
  Object.keys(source)
    .filter((key) => Number.isNaN(Number(key)))
    .forEach((key) => {
      result[key] = source[key];
    });
  return result;
}

function sameEnumValues(
  a: Record<string, string | number>,
  b: Record<string, string | number>,
): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  return aKeys.length === bKeys.length && aKeys.every((key) => a[key] === b[key]);
}

const capitalize = (value: string) => value[0].toUpperCase() + value.slice(1);

// human-readable form of a mapped class for error messages: the class itself only has a technical
// name (PickTypeClass etc.), but the user needs the call form — PickType(User, ["id"]); nested
// mapped classes (IntersectionType(A, PartialType(B))) are unfolded recursively
function describeMapped(mapped: NonNullable<AomSchemas["mapped"]>): string {
  const describeSource = (cls: ClassType): string => {
    const $ = AomSchemas.checkExists(cls as ClassConstructor);
    return $?.mapped ? describeMapped($.mapped) : (cls as Function).name;
  };
  switch (mapped.kind) {
    case "Pick":
      return `PickType(${describeSource(mapped.of[0])}, ${JSON.stringify(mapped.keys)})`;
    case "Omit":
      return `OmitType(${describeSource(mapped.of[0])}, ${JSON.stringify(mapped.keys)})`;
    case "Partial":
      return `PartialType(${describeSource(mapped.of[0])})`;
    case "Intersection":
      return `IntersectionType(${mapped.of.map(describeSource).join(", ")})`;
  }
}

/**
 * Schemer's own schema-folding format for distribution/codegen: each property is stored as
 * "`PropertySchema.*` factory + its params, as originally passed" rather than as JSON Schema —
 * lossless enough to reconstruct the exact original `@PropertySchema.*` calls on the other end
 * (`@aom-js/codegen`'s `emitSchemas`), which plain JSON Schema cannot round-trip.
 *
 * Walks `roots` plus everything they reach through `PropertySchema.Type` and `extends` (including
 * through mapped-types). A property whose `decorators` can't be folded unambiguously (not a
 * class-validator export, a custom `registerDecorator`, `Transform`/`ValidateIf`, a message function,
 * or more than one metadata entry) is silently dropped from the fold — this is an accepted, documented
 * loss, not a bug. Properties inherited unchanged from a parent component are omitted from the child's
 * `properties` (only the child's own properties are listed). The result is deterministic: the same
 * roots always fold to the same JSON, regardless of call order.
 *
 * @param roots - classes decorated with `@ComponentSchema()` to start the walk from; classes reached
 * through `Type`/`extends` are added automatically
 * @returns a self-contained, JSON-serializable snapshot of `roots` and everything they reference
 * @throws {Error} if a class reached through `Type` or `extends` is an anonymous mapped-type class
 * used directly (not wrapped in a named `@ComponentSchema` subclass), if two different classes end up
 * sharing a component name, or if an `enum` name is reused with different values
 *
 * @example
 * ```ts
 * import { ComponentSchema, PropertySchema, foldSchemas } from "@aom-js/schemer";
 *
 * @ComponentSchema()
 * class UserDto {
 *   @PropertySchema.String({ minLength: 1 })
 *   name!: string;
 * }
 *
 * const folded = foldSchemas([UserDto]);
 * // folded.format === 1
 * // folded.components.UserDto.properties.name === { factory: "String", params: { minLength: 1 } }
 * ```
 */
export function foldSchemas(roots: Iterable<ClassType>): FoldedSchemas {
  const components: Record<string, FoldedComponent> = {};
  const classesByName = new Map<string, ClassType>();
  const enums: Record<string, Record<string, string | number>> = {};
  const enumNameByValue = new Map<EnumLike, string>();

  // registers an enum in the shared dictionary; identical objects are merged by reference
  function registerEnum(
    value: EnumLike,
    enumName: string | undefined,
    componentName: string,
    propertyName: string,
  ): string {
    const existing = enumNameByValue.get(value);
    if (existing) return existing;

    const name = enumName || `${componentName}${capitalize(propertyName)}`;
    const folded = forwardEnumEntries(value);
    const current = enums[name];
    if (current && !sameEnumValues(current, folded)) {
      throw new Error(`foldSchemas: enum "${name}" уже зарегистрирован с другими значениями`);
    }
    enums[name] = folded;
    enumNameByValue.set(value, name);
    return name;
  }

  // Type.value() → {$ref}; the target can only be a named @ComponentSchema class
  function resolveRef(cls: ClassType): string {
    const $ = AomSchemas.checkExists(cls as ClassConstructor);
    if ($?.mapped) {
      const form = describeMapped($.mapped);
      throw new Error(
        `foldSchemas: ${form} использован как цель Type, а не компонент; объявите класс-наследник с @ComponentSchema и используйте его, например: class Named extends ${form} {}`,
      );
    }
    if (!$ || !$.isComponentSchema) {
      throw new Error(
        `foldSchemas: "${(cls as Function).name}" не является именованным @ComponentSchema классом — унаследуйте именованным классом`,
      );
    }
    foldComponent(cls);
    return (cls as Function).name;
  }

  // parent along the extends chain: a component → its name (added to the walk queue), a mapped class → its structure, recursively
  function resolveParent(cls: ClassType): FoldedParent {
    const $ = AomSchemas.checkExists(cls as ClassConstructor)!;
    if ($.mapped) {
      const { kind, of, keys } = $.mapped;
      if (kind === "Intersection") {
        return { $mapped: "Intersection", of: of.map((one) => resolveParent(one)) };
      }
      if (kind === "Partial") {
        return { $mapped: "Partial", of: resolveParent(of[0]) };
      }
      return { $mapped: kind, of: resolveParent(of[0]), keys: keys! };
    }
    foldComponent(cls);
    return (cls as Function).name;
  }

  // the nearest ancestor component (or mapped class) along the prototype chain: undecorated
  // intermediate classes don't inherit anything on their own (see ComponentSchema) — we skip them the same way
  function findNearestComponentAncestor(cls: ClassType): ClassType | undefined {
    let parent = Object.getPrototypeOf(cls) as ClassType | null;
    while (parent && parent !== Function.prototype) {
      if (isComponentAncestor(AomSchemas.checkExists(parent as ClassConstructor))) return parent;
      parent = Object.getPrototypeOf(parent) as ClassType | null;
    }
    return undefined;
  }

  // the parent isn't a component (e.g. AssignEntity), or there's no parent at all — no extends
  function foldExtends(cls: ClassType): FoldedParent | undefined {
    const parent = findNearestComponentAncestor(cls);
    return parent ? resolveParent(parent) : undefined;
  }

  function foldProperty(
    node: AomSchemas,
    componentName: string,
    propertyName: string,
  ): FoldedProperty {
    const { schemaName, schemaParams } = node;
    if (!schemaName || !schemaParams) {
      throw new Error(
        `foldSchemas: "${componentName}.${propertyName}" не содержит параметров схемы`,
      );
    }

    const params: Record<string, FoldedValue> = {};
    Object.entries(schemaParams).forEach(([key, raw]) => {
      if (raw === undefined) return;

      if (key === "decorators") {
        params.decorators = foldDecorators(raw as PropertyDecorator[]);
        return;
      }
      if (key === "value" && schemaName === SchemaTypes.TYPE) {
        params.value = { $ref: resolveRef((raw as ConnectionSchema)()) };
        return;
      }
      if (key === "value" && schemaName === SchemaTypes.ENUM) {
        const enumName = (schemaParams as Record<string, unknown>).enumName as string | undefined;
        params.value = {
          $enum: registerEnum(raw as EnumLike, enumName, componentName, propertyName),
        };
        return;
      }

      const folded = foldValue(raw);
      if (folded !== undefined) params[key] = folded;
    });

    return { factory: schemaName, params };
  }

  function foldComponent(cls: ClassType): void {
    const name = (cls as Function).name;
    const $ = AomSchemas.checkExists(cls as ClassConstructor);
    if (!$ || !$.isComponentSchema) {
      throw new Error(`foldSchemas: "${name}" не является @ComponentSchema классом`);
    }
    if ($.mapped) {
      const form = describeMapped($.mapped);
      throw new Error(
        `foldSchemas: ${form} — mapped-класс, а не компонент; объявите класс-наследник с @ComponentSchema и используйте его, например: class Named extends ${form} {}`,
      );
    }

    const existing = classesByName.get(name);
    if (existing) {
      if (existing !== cls) {
        throw new Error(`foldSchemas: имя "${name}" использовано у двух разных классов`);
      }
      return; // already handled — the cycle closed by name
    }
    classesByName.set(name, cls);

    // @PropertySchema on a static: SWC marks a static field's descriptor as enumerable before the
    // decorator even runs, so it never lands in origins — check statics separately
    $._.statics.forEach((node, property) => {
      if (node.schemaParams) {
        throw new Error(
          `foldSchemas: "${name}.${String(property)}" — @PropertySchema на статическом свойстве`,
        );
      }
    });

    const component: FoldedComponent = { properties: {} };
    if ($.componentParams) {
      const { description, deprecated } = $.componentParams;
      component.params = {
        ...(description !== undefined && { description }),
        ...(deprecated !== undefined && { deprecated }),
      };
    }

    const extendsValue = foldExtends(cls);
    if (extendsValue !== undefined) component.extends = extendsValue;

    // the baseline for the "own vs inherited" comparison — the same ancestor ComponentSchema actually inherits from
    const parent = findNearestComponentAncestor(cls);
    const $parent = parent ? AomSchemas.checkExists(parent as ClassConstructor) : undefined;
    const parentParams = new Map(
      ($parent?._.origins ?? []).map((origin) => [origin.property, origin.self.schemaParams]),
    );

    $._.origins.forEach((origin) => {
      // an inherited property carries the same params object as the parent's (reference equality)
      if (parentParams.get(origin.property) === origin.self.schemaParams) return;

      component.properties[String(origin.property)] = foldProperty(
        origin.self,
        name,
        String(origin.property),
      );
    });

    components[name] = component;
  }

  for (const root of roots) foldComponent(root);

  const sortedComponents: Record<string, FoldedComponent> = {};
  Object.keys(components)
    .sort()
    .forEach((key) => {
      sortedComponents[key] = components[key];
    });

  return { format: 1, components: sortedComponents, enums };
}
