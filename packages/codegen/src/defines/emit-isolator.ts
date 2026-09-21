import { SCALAR_TYPE_SCHEMAS } from "@aom-js/schemer";

import { CodegenConfig, TransferServiceDescriptor } from "./types";
import { assertIdentifier, assertDeclarableName, commentText } from "./safe";

// specifier for the GENERATED code; assembled from parts so post-build
// doesn't mistake it for a relative import of this package itself
const SCHEMAS_MODULE = "./" + "schemas";

// names that isolator.ts itself imports or declares (decorators from @aom-js/transfer and the
// local transfer variable) — the service name becomes both the class name and the
// "${name}Hash" prefix, so it can't collide with any of them (LOW: "export class Isolator {}"
// next to "import { Isolator }" wouldn't compile; "transfer"/"Promise" would shadow the import/global)
const ISOLATOR_OWN_NAMES = [
  "Isolator",
  "ResponseTopic",
  "CustomTopic",
  "IsQueue",
  "TopicSchema",
  "transfer",
];

// names forbidden for isolator static methods (LOW): these are Function.prototype's own
// properties — "name" would silently shadow the isolator class's own name, the rest either
// don't survive the class decorator or behave differently than the client expects
const FORBIDDEN_METHOD_NAMES = new Set([
  "name",
  "length",
  "prototype",
  "constructor",
  "caller",
  "arguments",
]);

/**
 * Extracts a component name from a `$ref` string (the tail after the last `"/"`). `ref` comes from
 * the bus (untrusted): the extracted name must be a valid identifier **and** must actually be one of
 * `knownComponents` from this same descriptor — otherwise a `$ref` could point outside the schema
 * (e.g. at a global) and the generated method signature would reference an arbitrary class instead of
 * a real DTO.
 *
 * @param ref - a `$ref` string, e.g. `"#/components/schemas/GoodDto"`
 * @param knownComponents - component names declared in this descriptor's `schemas`
 * @returns the component name (e.g. `"GoodDto"`)
 * @throws {Error} if the extracted name is not a valid identifier, or is not in `knownComponents`
 */
export function refName(ref: string, knownComponents: ReadonlySet<string>): string {
  const name = assertIdentifier(ref.slice(ref.lastIndexOf("/") + 1), `цель $ref "${ref}"`);
  if (!knownComponents.has(name)) {
    throw new Error(`codegen: цель $ref "${ref}" не найдена среди компонентов дескриптора`);
  }
  return name;
}

// deep comparison of JSON-compatible values — schema and the SCALAR_TYPE_SCHEMAS dictionary
// are flat, but some shapes (date's oneOf, for example) are nested
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((key) => deepEqual((a as any)[key], (b as any)[key]));
}

/**
 * Recognizes a scalar type by its JSON Schema shape — an exact deep match against
 * `SCALAR_TYPE_SCHEMAS` from `@aom-js/schemer`, including nested forms like `date`'s `oneOf`.
 *
 * @param schema - a JSON Schema object, e.g. a `@TopicSchema` argument type
 * @returns the scalar name (`"string"`, `"number"`, `"integer"`, `"boolean"`, `"date"`), or
 * `undefined` if `schema` does not match any known scalar exactly
 */
export function scalarNameOf(schema: Record<string, any>): string | undefined {
  return Object.keys(SCALAR_TYPE_SCHEMAS).find((name) =>
    deepEqual(schema, SCALAR_TYPE_SCHEMAS[name]),
  );
}

/** TS type for each scalar name used in `@TopicSchema`. */
const SCALAR_TS: Record<string, string> = {
  string: "string",
  number: "number",
  integer: "number",
  boolean: "boolean",
  date: "Date",
};

/**
 * Reconstructs `isolator.ts` source from `descriptor.methods`: a class named after the service,
 * decorated with `@Isolator(transfer)`, one static method per entry with the original
 * `@ResponseTopic`/`@CustomTopic`/`@IsQueue`/`@TopicSchema` decorators and a matching TS signature.
 * Method bodies are always a stub (`return undefined as never`) — this is a typed client shape, not a
 * working implementation. The `{ distributed: true }` option of `@Isolator` is intentionally not
 * carried over: the generated isolator only *calls* the service, it must not also register itself as
 * a distributor of it.
 *
 * **`descriptor` comes from the shared bus and is untrusted input** — see `safe.ts` and
 * `emit-schemas.ts` for the checks applied to names and `$ref`s here.
 *
 * @param descriptor - a service descriptor collected from the bus (e.g. via `collect`)
 * @param config - where the generated file imports its configured `Transfer` from
 * @returns TypeScript source for `isolator.ts`
 * @throws {Error} if the service/method/argument names are not valid declarable identifiers, if a
 * `$ref` does not resolve to a component of `descriptor.schemas`, or if the service name would
 * produce a `<Name>Hash` constant colliding with an imported component name
 *
 * @example
 * ```ts
 * import { emitIsolator } from "@aom-js/codegen";
 * import type { TransferServiceDescriptor } from "@aom-js/transfer";
 *
 * declare const descriptor: TransferServiceDescriptor;
 *
 * const source = emitIsolator(descriptor, { transferImport: "@/config/aom/transfer" });
 * // source declares, e.g.:
 * // @Isolator(transfer)
 * // export class GoodsService {
 * //   @ResponseTopic(true)
 * //   static async save(good: GoodDto): Promise<GoodDto> { return undefined as never; }
 * // }
 * ```
 */
export function emitIsolator(descriptor: TransferServiceDescriptor, config: CodegenConfig): string {
  assertDeclarableName(descriptor.name, "имя сервиса", ISOLATOR_OWN_NAMES);
  // the isolator's $ref must point to a component actually declared in THIS descriptor's
  // schemas.ts — with no schemas there are no components at all, so any $ref in args/returns is an error
  const knownComponents = new Set(Object.keys(descriptor.schemas?.components ?? {}));
  const methods = descriptor.methods.map((method) => emitMethod(method, knownComponents));

  const refs = new Set<string>();
  descriptor.methods.forEach((method) => {
    (method.args || []).forEach((entry) =>
      collectRefs(Object.values(entry)[0], refs, knownComponents),
    );
    if (method.returns) collectRefs(method.returns, refs, knownComponents);
  });

  // "${name}Hash" is also a declaration in this file: if a component with the same name is also
  // imported from schemas.ts (via $ref), the same identifier would end up declared twice
  const hashName = `${descriptor.name}Hash`;
  if (refs.has(hashName)) {
    throw new Error(
      `codegen: имя сервиса даёт константу ${JSON.stringify(hashName)}, совпадающую с импортируемым компонентом схемы`,
    );
  }

  const decorators = ["Isolator"];
  if (descriptor.methods.some((m) => m.waitForResponse)) decorators.push("ResponseTopic");
  if (descriptor.methods.some((m) => !m.waitForResponse)) decorators.push("CustomTopic");
  if (descriptor.methods.some((m) => m.queue)) decorators.push("IsQueue");
  if (descriptor.methods.some((m) => m.args)) decorators.push("TopicSchema");

  const transferImport = config.transferExportName
    ? `import { ${config.transferExportName} as transfer } from "${config.transferImport}";`
    : `import transfer from "${config.transferImport}";`;

  const header = [
    `// сгенерировано @aom-js/codegen из дескриптора ${descriptor.name}`,
    // origin is an arbitrary string from the descriptor (untrusted data): strip line breaks from
    // it, otherwise the comment would end early and the next line would become live code
    `// origin: ${commentText(descriptor.origin.instanceName)}/${commentText(descriptor.origin.instanceKey)} — не редактировать вручную`,
    `import { ${decorators.join(", ")} } from "@aom-js/transfer";`,
    transferImport,
  ];
  if (refs.size) {
    header.push(`import { ${[...refs].sort().join(", ")} } from "${SCHEMAS_MODULE}";`);
  }

  return [
    header.join("\n"),
    "",
    `/** sha256 контракта на момент генерации — для сверки дрейфа с живым реестром */`,
    `export const ${descriptor.name}Hash = ${JSON.stringify(descriptor.hash)};`,
    "",
    `@Isolator(transfer)`,
    `export class ${descriptor.name} {`,
    methods.join("\n\n"),
    `}`,
    "",
  ].join("\n");
}

function emitMethod(
  method: TransferServiceDescriptor["methods"][number],
  knownComponents: ReadonlySet<string>,
): string {
  assertIdentifier(method.name, "имя метода");
  if (FORBIDDEN_METHOD_NAMES.has(method.name)) {
    throw new Error(`codegen: недопустимое имя метода: ${JSON.stringify(method.name)}`);
  }

  const lines: string[] = [];
  const topicArg = method.singleton ? "true" : "";
  lines.push(`  @${method.waitForResponse ? "ResponseTopic" : "CustomTopic"}(${topicArg})`);
  if (method.queue) lines.push(`  @IsQueue()`);

  let params = "...args: unknown[]";
  if (method.args) {
    // the method is described: reconstruct @TopicSchema and a named signature. The argument name
    // becomes the function parameter name — it can't be quoted, so it must be a bare identifier
    const argPairs = method.args.map((entry) => {
      const [name, schema] = Object.entries(entry)[0];
      return { name: assertIdentifier(name, `имя аргумента метода "${method.name}"`), schema };
    });

    const schemaParts: string[] = [];
    if (argPairs.length) {
      const entries = argPairs.map(
        ({ name, schema }) => `{ ${name}: ${typeSource(schema, knownComponents)} }`,
      );
      schemaParts.push(`args: [${entries.join(", ")}]`);
    }
    if (method.returns) schemaParts.push(`returns: ${typeSource(method.returns, knownComponents)}`);
    lines.push(`  @TopicSchema(${schemaParts.length ? `{ ${schemaParts.join(", ")} }` : "{}"})`);

    params = argPairs
      .map(({ name, schema }) => `${name}: ${tsOf(schema, knownComponents)}`)
      .join(", ");
  }

  const returns = method.returns
    ? `Promise<${tsOf(method.returns, knownComponents)}>`
    : method.waitForResponse
      ? "Promise<unknown>"
      : "Promise<void>";

  lines.push(`  static async ${method.name}(${params}): ${returns} {`);
  lines.push(`    return undefined as never;`);
  lines.push(`  }`);
  return lines.join("\n");
}

/** Argument schema → `@TopicSchema` type value: `$ref` → class reference, scalar → name string, array → `[T]`. */
function typeSource(schema: Record<string, any>, knownComponents: ReadonlySet<string>): string {
  if (schema.$ref) return refName(schema.$ref, knownComponents);
  if (schema.type === "array" && schema.items)
    return `[${typeSource(schema.items, knownComponents)}]`;
  const scalar = scalarNameOf(schema);
  if (scalar) return JSON.stringify(scalar);
  throw new Error(`codegen: cannot restore @TopicSchema type from ${JSON.stringify(schema)}`);
}

/** Argument schema → TS type used in the generated method signature. */
function tsOf(schema: Record<string, any>, knownComponents: ReadonlySet<string>): string {
  if (schema.$ref) return refName(schema.$ref, knownComponents);
  if (schema.type === "array" && schema.items) return `${tsOf(schema.items, knownComponents)}[]`;
  const scalar = scalarNameOf(schema);
  if (scalar) return SCALAR_TS[scalar];
  throw new Error(`codegen: cannot restore TS type from ${JSON.stringify(schema)}`);
}

function collectRefs(
  schema: Record<string, any>,
  refs: Set<string>,
  knownComponents: ReadonlySet<string>,
): void {
  if (schema.$ref) refs.add(refName(schema.$ref, knownComponents));
  else if (schema.type === "array" && schema.items)
    collectRefs(schema.items, refs, knownComponents);
}
