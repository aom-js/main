import { CodegenConfig, TransferServiceDescriptor } from "./types";
import { refName, scalarNameOf } from "./inverse";

// спецификатор для СГЕНЕРИРОВАННОГО кода; собран из частей, чтобы post-build
// не принял его за относительный импорт самого пакета
const SCHEMAS_MODULE = "./" + "schemas";

/** TS-тип по имени скаляра из словаря @TopicSchema */
const SCALAR_TS: Record<string, string> = {
  string: "string",
  number: "number",
  integer: "number",
  boolean: "boolean",
  date: "Date",
};

/**
 * Восстановление изолятора: methods дескриптора → исходник isolator.ts с исходными
 * декораторами (правила docs/isolators.md §6). @IsDistributed сознательно не переносится —
 * иначе потребитель собрал бы дескриптор с чужим origin и отравил реестр.
 */
export function emitIsolator(descriptor: TransferServiceDescriptor, config: CodegenConfig): string {
  const methods = descriptor.methods.map((method) => emitMethod(method));

  const refs = new Set<string>();
  descriptor.methods.forEach((method) => {
    (method.args || []).forEach((entry) => collectRefs(Object.values(entry)[0], refs));
    if (method.returns) collectRefs(method.returns, refs);
  });

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
    `// origin: ${descriptor.origin.instanceName}/${descriptor.origin.instanceKey} — не редактировать вручную`,
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

function emitMethod(method: TransferServiceDescriptor["methods"][number]): string {
  const lines: string[] = [];
  const topicArg = method.singleton ? "true" : "";
  lines.push(`  @${method.waitForResponse ? "ResponseTopic" : "CustomTopic"}(${topicArg})`);
  if (method.queue) lines.push(`  @IsQueue()`);

  let params = "...args: unknown[]";
  if (method.args) {
    // метод описан: восстанавливаем @TopicSchema и именованную сигнатуру
    const schemaParts: string[] = [];
    if (method.args.length) {
      const entries = method.args.map((entry) => {
        const [name, schema] = Object.entries(entry)[0];
        return `{ ${name}: ${typeSource(schema)} }`;
      });
      schemaParts.push(`args: [${entries.join(", ")}]`);
    }
    if (method.returns) schemaParts.push(`returns: ${typeSource(method.returns)}`);
    lines.push(`  @TopicSchema(${schemaParts.length ? `{ ${schemaParts.join(", ")} }` : "{}"})`);

    params = method.args
      .map((entry) => {
        const [name, schema] = Object.entries(entry)[0];
        return `${name}: ${tsOf(schema)}`;
      })
      .join(", ");
  }

  const returns = method.returns
    ? `Promise<${tsOf(method.returns)}>`
    : method.waitForResponse
      ? "Promise<unknown>"
      : "Promise<void>";

  lines.push(`  static async ${method.name}(${params}): ${returns} {`);
  lines.push(`    return undefined as never;`);
  lines.push(`  }`);
  return lines.join("\n");
}

/** Схема аргумента → значение типа в @TopicSchema: $ref → класс, скаляр → имя, массив → [T] */
function typeSource(schema: Record<string, any>): string {
  if (schema.$ref) return refName(schema.$ref);
  if (schema.type === "array" && schema.items) return `[${typeSource(schema.items)}]`;
  const scalar = scalarNameOf(schema);
  if (scalar) return JSON.stringify(scalar);
  throw new Error(`codegen: cannot restore @TopicSchema type from ${JSON.stringify(schema)}`);
}

/** Схема аргумента → TS-тип в сигнатуре метода */
function tsOf(schema: Record<string, any>): string {
  if (schema.$ref) return refName(schema.$ref);
  if (schema.type === "array" && schema.items) return `${tsOf(schema.items)}[]`;
  const scalar = scalarNameOf(schema);
  if (scalar) return SCALAR_TS[scalar];
  throw new Error(`codegen: cannot restore TS type from ${JSON.stringify(schema)}`);
}

function collectRefs(schema: Record<string, any>, refs: Set<string>): void {
  if (schema.$ref) refs.add(refName(schema.$ref));
  else if (schema.type === "array" && schema.items) collectRefs(schema.items, refs);
}
