import { CodegenConfig, EmittedService, TransferServiceDescriptor } from "./types";
import { emitSchemas } from "./emit-schemas";
import { emitIsolator } from "./emit-isolator";

/**
 * Генерация одного сервиса: дескриптор → файлы schemas.ts (если есть компоненты)
 * и isolator.ts. Чистая функция — файловой системой занимается вызывающий (CLI).
 */
export function emitService(
  descriptor: TransferServiceDescriptor,
  config: CodegenConfig,
): EmittedService {
  const files: EmittedService["files"] = [];
  const schemas = emitSchemas(descriptor);
  if (schemas) files.push({ path: "schemas.ts", source: schemas });
  files.push({ path: "isolator.ts", source: emitIsolator(descriptor, config) });
  return { name: descriptor.name, hash: descriptor.hash, files };
}

/** Каталог сервиса в generated-выводе: GoodsService → goods-service */
export function serviceDirName(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
}
