import {
  FoldedComponent,
  FoldedParent,
  FoldedProperty,
  FoldedValue,
  PropertySchema,
  SchemaTypes,
  isFoldedValidatorName,
} from "@aom-js/schemer";

import { TransferServiceDescriptor } from "./types";
import { assertIdentifier, assertDeclarableName, propertyKey } from "./safe";

/**
 * Reconstructs `schemas.ts` source from `descriptor.schemas` (a `FoldedSchemas`, produced by
 * `@aom-js/schemer`'s `foldSchemas`): `\@ComponentSchema`/`\@PropertySchema.*` classes, `enum`s, and a
 * `type Ref<T> = T` alias for lazy references to other components. Declares enums first (by name),
 * then classes in topological order by `extends` (a parent, direct or through a mapped-type chain,
 * is always declared before its child) — `Type` references stay lazy (`() => X`) regardless of
 * declaration order, which is what lets two components reference each other.
 *
 * **`descriptor` comes from the shared bus and is untrusted input.** Every name that becomes part of
 * the generated identifier space (service/component/enum names) is checked with `assertDeclarableName`
 * before anything is emitted; every reference (`extends`, `$ref`, `$enum`) is checked against the
 * component/enum names actually present in this same descriptor (`assertKnownName`); every
 * `$validator` name is checked against `isFoldedValidatorName`; every `$date`/`$regexp` value is
 * validated (and, for `$regexp`, actually compiled) before being spliced into `new Date(...)` /
 * `new RegExp(...)` calls. See `safe.ts` for the underlying primitives. `$regexp` sources are checked
 * for valid form and successful compilation, but not for catastrophic backtracking (ReDoS) — see
 * `docs` / issue https://github.com/aom-js/main/issues/1.
 *
 * @param descriptor - a service descriptor collected from the bus (e.g. via `collect`)
 * @returns TypeScript source for `schemas.ts`, or `undefined` if the service has no components
 * @throws {Error} if `descriptor.schemas` is missing while `descriptor.components` is not empty (a
 * pre-format-1 descriptor from a stale cache), if `schemas.format` is not `1`, or if any name/reference
 * in `schemas` fails the checks above
 *
 * @example
 * ```ts
 * import { emitSchemas } from "@aom-js/codegen";
 * import type { TransferServiceDescriptor } from "@aom-js/transfer";
 *
 * declare const descriptor: TransferServiceDescriptor;
 *
 * const source = emitSchemas(descriptor);
 * // source is TypeScript, e.g.:
 * // \@ComponentSchema()
 * // export class GoodDto {
 * //   \@PropertySchema.String({})
 * //   title!: string;
 * // }
 * ```
 */
export function emitSchemas(descriptor: TransferServiceDescriptor): string | undefined {
  const { schemas } = descriptor;
  if (!schemas) {
    if (Object.keys(descriptor.components).length) {
      throw new Error("codegen: дескриптор до формата 1 — пересоберите collect");
    }
    return undefined;
  }
  if (schemas.format !== 1) {
    throw new Error(`codegen: неизвестный формат схем (format: ${schemas.format})`);
  }
  if (!Object.keys(schemas.components).length) return undefined;

  // the descriptor is data from the bus (untrusted): the service/component/enum name becomes the
  // name of a class/enum in the generated code (or ends up in a comment) — check it up front,
  // not at each use site; a component/enum name also must not collide with a built-in/reserved
  // name (HIGH-b) — otherwise "export class Date extends Function {}" would shadow the real Date
  assertDeclarableName(descriptor.name, "имя сервиса");
  Object.keys(schemas.components).forEach((name) => assertDeclarableName(name, "имя компонента"));
  Object.keys(schemas.enums).forEach((name) => assertDeclarableName(name, "имя enum"));

  const ctx: RenderContext = {
    validators: new Set(),
    mapped: new Set(),
    usesRef: false,
    componentNames: new Set(Object.keys(schemas.components)),
    enumNames: new Set(Object.keys(schemas.enums)),
  };
  const classes = topoOrder(schemas.components).map((name) =>
    emitComponent(name, schemas.components[name], ctx),
  );
  const enums = Object.keys(schemas.enums)
    .sort()
    .map((name) => emitEnum(name, schemas.enums[name]));

  const schemerExports = ["ComponentSchema", "PropertySchema", ...[...ctx.mapped].sort()];
  const lines = [
    `// сгенерировано @aom-js/codegen из дескриптора ${descriptor.name} — не редактировать вручную`,
    `import { ${schemerExports.join(", ")} } from "@aom-js/schemer";`,
  ];
  if (ctx.validators.size) {
    lines.push(`import { ${[...ctx.validators].sort().join(", ")} } from "class-validator";`);
  }
  if (ctx.usesRef) lines.push("", "type Ref<T> = T;");
  lines.push("");
  if (enums.length) lines.push(enums.join("\n\n"), "");
  lines.push(classes.join("\n\n"), "");

  return lines.join("\n");
}

interface RenderContext {
  // class-validator exports used by a $validator marker — go into their own import
  validators: Set<string>;
  // mapped-type helpers (PickType/OmitType/PartialType/IntersectionType) used in extends
  mapped: Set<string>;
  // at least one Type property — needs the `type Ref<T> = T` alias
  usesRef: boolean;
  // component/enum names of THIS descriptor — extends/$ref/$enum must point to one of them,
  // not to an arbitrary identifier like "Function"/"Date" (HIGH-a)
  componentNames: ReadonlySet<string>;
  enumNames: ReadonlySet<string>;
}

// $ref/$enum/extends — data from the bus: not only must it be a valid identifier, it must also be
// a real component/enum of this descriptor — otherwise "extends Function" or "$ref: Date"
// would reach into the global scope for a class/function instead of a schema component
/**
 * Guards `extends`/`$ref`/`$enum` values against scope-escape: `value` must be a valid identifier
 * (`assertIdentifier`) *and* a name that actually exists among `known` (the components/enums of this
 * same descriptor). Without the second check, a descriptor could set `extends: "process"` or
 * `$ref: "globalThis"` and have the generated class inherit from — or reference — an arbitrary value
 * from the consumer's module scope instead of a real schema component.
 */
function assertKnownName(value: unknown, known: ReadonlySet<string>, what: string): string {
  const name = assertIdentifier(value, what);
  if (!known.has(name)) {
    throw new Error(`codegen: ${what} не найден среди компонентов/enum дескриптора: ${name}`);
  }
  return name;
}

// class declaration order: a parent (direct, or the sources of a mapped-type) comes before its
// child, otherwise by name; extends is resolved eagerly (unlike Type, whose reference is lazy)
function topoOrder(components: Record<string, FoldedComponent>): string[] {
  const order: string[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();

  function visit(name: string): void {
    if (visited.has(name)) return;
    // extends comes from an untrusted descriptor, so a cycle (A extends B extends A) is a real
    // possibility, not just a theoretical one — without this check it would recurse until the stack overflows
    if (visiting.has(name)) throw new Error(`codegen: цикл extends на "${name}"`);
    visiting.add(name);
    const extendsValue = components[name]?.extends;
    if (extendsValue !== undefined) {
      leafNames(extendsValue).forEach((dep) => components[dep] && visit(dep));
    }
    visiting.delete(name);
    visited.add(name);
    order.push(name);
  }

  Object.keys(components).sort().forEach(visit);
  return order;
}

// names of the source components anywhere inside the extends/mapped chain
function leafNames(parent: FoldedParent): string[] {
  if (typeof parent === "string") return [parent];
  if (parent.$mapped === "Intersection") return parent.of.flatMap(leafNames);
  return leafNames(parent.of);
}

// the parent expression in "extends ...": either a class name or a PickType/OmitType/PartialType/IntersectionType call
function parentExpr(parent: FoldedParent, ctx: RenderContext): string {
  if (typeof parent === "string")
    return assertKnownName(parent, ctx.componentNames, "родитель extends");
  if (parent.$mapped === "Partial") {
    ctx.mapped.add("PartialType");
    return `PartialType(${parentExpr(parent.of, ctx)})`;
  }
  if (parent.$mapped === "Intersection") {
    ctx.mapped.add("IntersectionType");
    return `IntersectionType(${parent.of.map((one) => parentExpr(one, ctx)).join(", ")})`;
  }
  ctx.mapped.add(`${parent.$mapped}Type`);
  return `${parent.$mapped}Type(${parentExpr(parent.of, ctx)}, ${JSON.stringify(parent.keys)})`;
}

function isPlainObject(value: unknown): value is Record<string, FoldedValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// a factory param value → source code: {$date,$regexp,$ref,$enum,$validator} markers are
// unfolded into a constructor/reference/call, everything else is emitted as a JSON literal
function renderValue(value: FoldedValue, ctx: RenderContext): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return `[${value.map((item) => renderValue(item, ctx)).join(", ")}]`;
  if (isPlainObject(value)) {
    if ("$date" in value) {
      const raw = value.$date;
      // the date string is also validated at generation time: beyond its shape (JSON.stringify
      // prevents escaping the string literal), the value must actually parse as a date — otherwise
      // it isn't a $date, it's foreign data that has no business inside new Date(...)
      if (typeof raw !== "string" || Number.isNaN(Date.parse(raw))) {
        throw new Error(`codegen: недопустимая дата $date: ${JSON.stringify(raw)}`);
      }
      return `new Date(${JSON.stringify(raw)})`;
    }
    if ("$regexp" in value) {
      const label = value.$regexp;
      // the marker is data from the bus: check the [string, string] shape field by field (don't
      // rely on "as"), otherwise "new RegExp(source, flags)" in the generated code would throw a
      // SyntaxError/TypeError at the consumer's end instead of failing here, at generation time
      if (
        !Array.isArray(label) ||
        label.length !== 2 ||
        typeof label[0] !== "string" ||
        typeof label[1] !== "string"
      ) {
        throw new Error(`codegen: недопустимая метка $regexp: ${JSON.stringify(label)}`);
      }
      const [source, flags] = label;
      // valid RegExp flags — without ReDoS heuristics: there's no reliable way to tell a malicious
      // pattern apart from a safe one; this only checks shape and that it compiles
      if (!/^[dgimsuvy]*$/.test(flags) || new Set(flags).size !== flags.length) {
        throw new Error(`codegen: недопустимые флаги regexp: ${JSON.stringify(flags)}`);
      }
      try {
        new RegExp(source, flags);
      } catch (error) {
        throw new Error(
          `codegen: невалидный regexp ${JSON.stringify(source)} / ${JSON.stringify(flags)}: ${(error as Error).message}`,
          { cause: error },
        );
      }
      return `new RegExp(${JSON.stringify(source)}, ${JSON.stringify(flags)})`;
    }
    if ("$ref" in value)
      return `() => ${assertKnownName(value.$ref, ctx.componentNames, "цель $ref")}`;
    if ("$enum" in value) return assertKnownName(value.$enum, ctx.enumNames, "цель $enum");
    if ("$validator" in value) {
      const validatorName = value.$validator;
      // a whitelist — exactly what the fold could ever produce (packages/schemer/src/defines/
      // folding.ts). class-validator exports unrelated to property decorators (useContainer,
      // registerDecorator, validateSync, ...) are functions too — a plain "typeof === function"
      // check would let them through, and the call would execute at the consumer's end on class import
      if (typeof validatorName !== "string" || !isFoldedValidatorName(validatorName)) {
        throw new Error(
          `codegen: неизвестный экспорт class-validator: ${JSON.stringify(validatorName)}`,
        );
      }
      ctx.validators.add(validatorName);
      const args = (value.args as FoldedValue[]).map((arg) => renderValue(arg, ctx));
      return `${validatorName}(${args.join(", ")})`;
    }
    const pairs = Object.entries(value).map(
      ([key, item]) => `${propertyKey(key)}: ${renderValue(item, ctx)}`,
    );
    return pairs.length ? `{ ${pairs.join(", ")} }` : "{}";
  }
  return JSON.stringify(value);
}

// TS type of a property: a scalar stays as-is, Enum → the name from folded.enums, Type → Ref<X>
// (lazily, which avoids a failure when referencing a class declared further down the file),
// isArray/nullable are appended as suffixes
function tsType(property: FoldedProperty, ctx: RenderContext): string {
  const { factory, params } = property;
  let base: string;
  switch (factory) {
    case SchemaTypes.STRING:
      base = "string";
      break;
    case SchemaTypes.NUMBER:
      base = "number";
      break;
    case SchemaTypes.BOOLEAN:
      base = "boolean";
      break;
    case SchemaTypes.DATE:
      base = "Date";
      break;
    case SchemaTypes.ANY:
      base = "any";
      break;
    case SchemaTypes.ENUM:
      base = assertKnownName(
        (params.value as { $enum: unknown })?.$enum,
        ctx.enumNames,
        "цель $enum",
      );
      break;
    case SchemaTypes.TYPE:
      ctx.usesRef = true;
      base = `Ref<${assertKnownName((params.value as { $ref: unknown })?.$ref, ctx.componentNames, "цель $ref")}>`;
      break;
    default:
      throw new Error(`codegen: неизвестная фабрика свойства "${factory}"`);
  }
  if (params.isArray) base += "[]";
  if (params.nullable) base += " | null";
  return base;
}

function emitProperty(name: string, property: FoldedProperty, ctx: RenderContext): string {
  // "constructor" as a declared class field name breaks the build at the consumer's end — don't risk it
  if (name === "constructor") {
    throw new Error(`codegen: недопустимое имя свойства: ${JSON.stringify(name)}`);
  }
  // factory becomes a call to the PropertySchema.<factory>(...) method — only real keys allowed
  if (!Object.prototype.hasOwnProperty.call(PropertySchema, property.factory)) {
    throw new Error(`codegen: неизвестная фабрика свойства: ${JSON.stringify(property.factory)}`);
  }
  const optional = Boolean(property.params.isOptional);
  return [
    `  @PropertySchema.${property.factory}(${renderValue(property.params, ctx)})`,
    `  ${propertyKey(name)}${optional ? "?" : "!"}: ${tsType(property, ctx)};`,
  ].join("\n");
}

function emitComponent(name: string, component: FoldedComponent, ctx: RenderContext): string {
  const decorator = component.params
    ? `@ComponentSchema(${renderValue(component.params as Record<string, FoldedValue>, ctx)})`
    : `@ComponentSchema()`;
  const signature =
    component.extends !== undefined
      ? `export class ${name} extends ${parentExpr(component.extends, ctx)}`
      : `export class ${name}`;

  const properties = Object.entries(component.properties).map(([property, schema]) =>
    emitProperty(property, schema, ctx),
  );
  if (!properties.length) return `${decorator}\n${signature} {}`;
  return [decorator, `${signature} {`, properties.join("\n\n"), `}`].join("\n");
}

function emitEnum(name: string, values: Record<string, string | number>): string {
  const members = Object.entries(values).map(([key, value]) => {
    // an enum member compiles down to an assignment (E["k"] = v), not an object literal — even the
    // computed form ["__proto__"] doesn't help here: the Object.prototype.__proto__ setter silently
    // does nothing for a primitive value, and the enum member is simply lost without an error
    if (key === "__proto__") {
      throw new Error(`codegen: недопустимый ключ enum "${name}.__proto__"`);
    }
    // the value comes from the descriptor: a string goes through JSON.stringify, a finite number is
    // emitted as a literal, otherwise it isn't a valid enum value — foreign data, don't splice it in as-is
    if (typeof value === "string") return `  ${propertyKey(key)} = ${JSON.stringify(value)},`;
    if (typeof value === "number" && Number.isFinite(value))
      return `  ${propertyKey(key)} = ${value},`;
    throw new Error(
      `codegen: недопустимое значение enum "${name}.${key}": ${JSON.stringify(value)}`,
    );
  });
  return [`export enum ${name} {`, members.join("\n"), `}`].join("\n");
}
