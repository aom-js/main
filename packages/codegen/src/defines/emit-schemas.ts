import { TransferServiceDescriptor } from "./types";
import { inverseSchema } from "./inverse";

/**
 * Восстановление DTO: components дескриптора → исходник schemas.ts с классами
 * @ComponentSchema/@PropertySchema.* (правила docs/isolators.md §6).
 * Возвращает undefined, если у сервиса нет компонент.
 */
export function emitSchemas(descriptor: TransferServiceDescriptor): string | undefined {
  const names = Object.keys(descriptor.components).sort();
  if (!names.length) return undefined;

  const classes = names.map((name) => emitComponent(name, descriptor.components[name]));

  return [
    `// сгенерировано @aom-js/codegen из дескриптора ${descriptor.name} — не редактировать вручную`,
    `import { ComponentSchema, PropertySchema } from "@aom-js/schemer";`,
    "",
    classes.join("\n\n"),
    "",
  ].join("\n");
}

function emitComponent(name: string, schema: Record<string, any>): string {
  if (schema.type !== "object" || !schema.properties) {
    throw new Error(`codegen: component "${name}" is not an object schema — cannot restore a class`);
  }
  const required: string[] = schema.required || [];
  const properties = Object.keys(schema.properties).map((property) => {
    const inversed = inverseSchema(schema.properties[property]);
    const optional = !required.includes(property);
    if (optional) inversed.params.isOptional = true;

    const fragments: string[] = [];
    // Type-связь — тонкая ленивая ссылка, порядок объявления классов не важен
    if (inversed.factory === "Type") fragments.push(`value: () => ${inversed.ref}`);
    if (inversed.isArray) fragments.push("isArray: true");

    const todo = inversed.dropped.length
      ? ` // TODO(codegen): не перенесено: ${inversed.dropped.join(", ")}`
      : "";
    const tsType = `${inversed.tsType}${inversed.isArray ? "[]" : ""}`;

    return [
      `  @PropertySchema.${inversed.factory}(${paramsSource(inversed.params, fragments)})${todo}`,
      `  ${property}${optional ? "?" : "!"}: ${tsType};`,
    ].join("\n");
  });

  return [`@ComponentSchema()`, `export class ${name} {`, properties.join("\n\n"), `}`].join("\n");
}

/** Собирает литерал параметров фабрики: готовые фрагменты + JSON-сериализуемые пары */
function paramsSource(params: Record<string, unknown>, fragments: string[]): string {
  const pairs = fragments.concat(
    Object.keys(params).map((key) => `${key}: ${JSON.stringify(params[key])}`),
  );
  return pairs.length ? `{ ${pairs.join(", ")} }` : "{}";
}
