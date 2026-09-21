// The descriptor comes from the shared bus — untrusted data. These helpers are the boundary
// between the descriptor's JSON and the text of the generated TS: anything that fails the check
// never reaches the source file (otherwise it would turn into executable code, not just data).

import { isFoldedValidatorName } from "@aom-js/schemer";

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

// names the generator itself declares/imports in schemas.ts — a component or enum with the
// same name would either fail to build (redeclare) or silently shadow the imported
// class/function (HIGH: "export class Date extends Function {}" instead of the real Date)
const GENERATOR_OWN_NAMES = [
  "ComponentSchema",
  "PropertySchema",
  "Ref",
  "PickType",
  "OmitType",
  "PartialType",
  "IntersectionType",
];

// key global objects as an explicit list — in case the runtime where
// Object.getOwnPropertyNames(globalThis) is evaluated at generation time differs from the consumer's
const KEY_GLOBALS = [
  "Date",
  "RegExp",
  "Function",
  "Object",
  "Array",
  "Promise",
  "Symbol",
  "Error",
  "JSON",
  "Math",
  "Reflect",
  "Proxy",
  "globalThis",
  "process",
  "Buffer",
  "require",
  "module",
  "exports",
];

// JS/TS reserved words and TS built-in type names — as a class/enum name they either fail to
// parse or mean something other than whoever supplied them expected
const RESERVED_WORDS = [
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "debugger",
  "default",
  "delete",
  "do",
  "else",
  "enum",
  "export",
  "extends",
  "false",
  "finally",
  "for",
  "function",
  "if",
  "import",
  "in",
  "instanceof",
  "new",
  "null",
  "return",
  "super",
  "switch",
  "this",
  "throw",
  "true",
  "try",
  "typeof",
  "var",
  "void",
  "while",
  "with",
  "yield",
  "let",
  "static",
  "implements",
  "interface",
  "package",
  "private",
  "protected",
  "public",
  "await",
  "string",
  "number",
  "boolean",
  "any",
  "unknown",
  "never",
  "object",
  "symbol",
  "bigint",
  "undefined",
];

const FORBIDDEN_NAMES = new Set([
  ...Object.getOwnPropertyNames(globalThis),
  ...KEY_GLOBALS,
  ...RESERVED_WORDS,
  ...GENERATOR_OWN_NAMES,
]);

/**
 * Guards against arbitrary code injection through an identifier position: checks that `value` is a
 * string matching `/^[A-Za-z_$][A-Za-z0-9_$]*$/`, i.e. safe to splice literally into generated source
 * as a class/enum/function/parameter name. Identifiers cannot be quoted, so there is nothing to
 * escape — a descriptor field that fails this check (e.g. containing `` `${...}` `` or a closing
 * brace) is rejected outright rather than sanitized, since any sanitization would itself be a place
 * for an attacker-controlled string to smuggle code into the generated file.
 *
 * @param value - the untrusted value to check (normally a field straight off a wire descriptor)
 * @param what - human-readable description of the field, used in the thrown error
 * @returns `value`, narrowed to `string`
 * @throws {Error} if `value` is not a string or is not a valid identifier
 */
export function assertIdentifier(value: unknown, what: string): string {
  if (typeof value !== "string" || !IDENTIFIER.test(value)) {
    throw new Error(`codegen: недопустимое имя (${what}): ${JSON.stringify(value)}`);
  }
  return value;
}

/**
 * Guards against name-collision attacks for anything that becomes `export class <name>` /
 * `export enum <name>` in generated `schemas.ts` — a component, enum or service name. Beyond being a
 * valid identifier (`assertIdentifier`), the name must not collide with:
 * - a global object of the runtime that will load the generated code (`Object.getOwnPropertyNames(globalThis)`
 *   plus an explicit `KEY_GLOBALS` list, since `globalThis` at generation time may not match the
 *   consumer's runtime);
 * - a JS/TS reserved word or built-in type name;
 * - a name the generator itself imports or declares (`ComponentSchema`, `PropertySchema`, `Ref`,
 *   the mapped-type helpers);
 * - a class-validator decorator factory name (`isFoldedValidatorName`);
 * - anything in `extraForbidden` (callers pass their own local reserved names, e.g. the isolator's
 *   own imports).
 *
 * Without this check, a malicious or buggy descriptor could name a component `Date` and have the
 * generated file declare `export class Date extends Function {}` — silently shadowing the real
 * `Date` for every other symbol declared after it in the same module, entirely legally as far as
 * TypeScript is concerned.
 *
 * @param value - the untrusted name to check
 * @param what - human-readable description of the field, used in the thrown error
 * @param extraForbidden - additional names to reject, on top of the built-in list
 * @returns `value`, narrowed to `string`
 * @throws {Error} if `value` is not a valid identifier, or collides with a forbidden name
 */
export function assertDeclarableName(
  value: unknown,
  what: string,
  extraForbidden: Iterable<string> = [],
): string {
  const name = assertIdentifier(value, what);
  if (
    FORBIDDEN_NAMES.has(name) ||
    isFoldedValidatorName(name) ||
    new Set(extraForbidden).has(name)
  ) {
    throw new Error(
      `codegen: недопустимое имя (${what}) — совпадает со встроенным/зарезервированным: ${JSON.stringify(name)}`,
    );
  }
  return name;
}

/**
 * Renders a property/enum-member key for generated source: as a bare identifier when `value` already
 * is one, otherwise as a quoted (and therefore escaped) TS string literal via `JSON.stringify`.
 *
 * `"__proto__"` is special-cased to the computed form `["__proto__"]`: as an ordinary (non-computed)
 * key in an object literal, `__proto__` does not create an own property — it reassigns the object's
 * `[[Prototype]]` (a legacy Annex B behaviour). Emitting it as a plain key would silently rewrite the
 * generated object's prototype instead of adding a field named `__proto__`; the computed form behaves
 * like a normal key in both object literals and class/`enum` member declarations. Note that this
 * computed form does not help inside `enum` members specifically — see `emitEnum` in `emit-schemas.ts`,
 * which rejects `__proto__` there instead.
 *
 * @param value - the untrusted key (a property or enum member name from a descriptor)
 * @returns a safe key fragment to splice into generated source
 */
export function propertyKey(value: string): string {
  if (value === "__proto__") return '["__proto__"]';
  return IDENTIFIER.test(value) ? value : JSON.stringify(value);
}

/** Sanitizes free text for a `//`-comment in generated source: a line break would end the comment early and let the rest of `value` become live code, so newlines are collapsed to spaces. */
export function commentText(value: string): string {
  return String(value).replace(/[\r\n]+/g, " ");
}
