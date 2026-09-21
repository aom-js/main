import { CodegenConfig, EmittedService, TransferServiceDescriptor } from "./types";
import { emitSchemas } from "./emit-schemas";
import { emitIsolator } from "./emit-isolator";

/**
 * Generates one service: descriptor → `schemas.ts` (only when the service has components) and
 * `isolator.ts`. A pure function — the file system is the caller's responsibility (the CLI's
 * `generateCommand`).
 *
 * @param descriptor - a service descriptor collected from the bus (e.g. via `collect`)
 * @param config - where the generated isolator imports its configured `Transfer` from
 * @returns the service name, its contract hash (for drift checks), and the generated files
 * @throws {Error} anything `emitSchemas`/`emitIsolator` throw — an untrusted or malformed descriptor
 *
 * @example
 * ```ts
 * import { emitService } from "@aom-js/codegen";
 * import type { TransferServiceDescriptor } from "@aom-js/transfer";
 *
 * declare const descriptor: TransferServiceDescriptor;
 *
 * const service = emitService(descriptor, { transferImport: "@/config/aom/transfer" });
 * // service.files: [{ path: "schemas.ts", source }, { path: "isolator.ts", source }]
 * ```
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

/**
 * Derives the output directory name for a service: `GoodsService` → `goods-service`,
 * `HTTPService` → `http-service` (an abbreviation boundary still gets its own dash).
 *
 * `name` comes from the bus (untrusted): the result must not be able to escape the output directory,
 * so a name containing `/`, `\`, `..` as a path segment, or that reduces to an empty string, is
 * rejected rather than silently sanitized.
 *
 * @param name - a service name, i.e. the isolator class name
 * @returns a filesystem-safe, kebab-case directory name
 * @throws {Error} if `name` would produce an empty, absolute, or traversal-capable path segment
 *
 * @example
 * ```ts
 * import { serviceDirName } from "@aom-js/codegen";
 *
 * serviceDirName("HTTPService"); // "http-service"
 * ```
 */
export function serviceDirName(name: string): string {
  const dir = name
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2") // abbreviation boundary before the next word: HTTPService → HTTP-Service
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase();
  if (!dir || /[/\\]/.test(dir) || dir.split(/[/\\]/).includes("..")) {
    throw new Error(`codegen: недопустимое имя сервиса для каталога: ${JSON.stringify(name)}`);
  }
  return dir;
}

/** One successfully generated service plus the directory to write it to (relative — `--out` is the CLI's job). */
export interface PlannedService {
  service: EmittedService;
  dir: string;
}

/** Result of planning generation for a whole snapshot: what to write, and what went wrong. */
export interface GenerationPlan {
  succeeded: PlannedService[];
  errors: string[];
}

/**
 * Pure planning step for generating a whole snapshot of descriptors — no file system access, no
 * `process.exit` (both are the CLI's `generateCommand`'s job). One broken descriptor must not stop
 * generation of the rest, so each service is generated inside its own `try`/`catch`. A directory
 * collision (`serviceDirName` is case-insensitive: `"Foo"` and `"foo"` both map to `"foo"`) is also
 * an error rather than a silent overwrite — reported only after both names individually pass
 * `serviceDirName`, and naming both conflicting services in the message.
 *
 * @param descriptors - a snapshot of service descriptors, e.g. from `collect` (or read back from disk)
 * @param config - where generated isolators import their configured `Transfer` from
 * @returns services that generated successfully (`succeeded`) and human-readable messages for the
 * ones that did not or that collided (`errors`)
 *
 * @example
 * ```ts
 * import { planGeneration } from "@aom-js/codegen";
 * import type { TransferServiceDescriptor } from "@aom-js/transfer";
 *
 * declare const descriptors: TransferServiceDescriptor[];
 *
 * const { succeeded, errors } = planGeneration(descriptors, {
 *   transferImport: "@/config/aom/transfer",
 * });
 * errors.forEach((message) => console.error(message));
 * ```
 */
export function planGeneration(
  descriptors: TransferServiceDescriptor[],
  config: CodegenConfig,
): GenerationPlan {
  const errors: string[] = [];
  const emitted: PlannedService[] = [];

  descriptors.forEach((descriptor) => {
    try {
      const service = emitService(descriptor, config);
      emitted.push({ service, dir: serviceDirName(service.name) });
    } catch (error) {
      // the snapshot is a file read from disk, not a guaranteed TransferServiceDescriptor[]: one bad
      // entry (e.g. null) shouldn't break building the error message for the neighboring services;
      // the service name goes through JSON.stringify, otherwise control characters in it could forge CI log lines
      errors.push(`${JSON.stringify(descriptor?.name ?? null)}: ${(error as Error).message}`);
    }
  });

  const byDir = new Map<string, EmittedService[]>();
  emitted.forEach(({ service, dir }) => byDir.set(dir, [...(byDir.get(dir) ?? []), service]));

  const succeeded: PlannedService[] = [];
  byDir.forEach((services, dir) => {
    if (services.length > 1) {
      errors.push(
        `каталог "${dir}" собрали бы сразу сервисы ${services.map((s) => JSON.stringify(s.name)).join(", ")} — переименуйте один из них`,
      );
      return;
    }
    succeeded.push({ service: services[0], dir });
  });

  return { succeeded, errors };
}
