/**
 * Public entry point of `@aom-js/codegen`: re-exports every symbol from `defines/*` except
 * `safe.ts`, which is an internal boundary and not part of the public API (see `defines/safe.ts`
 * for why). `cli.ts` (the `aom-codegen` binary) is also not re-exported here — it is a separate
 * entry point, reached via `bin`, not `import`.
 */
export * from "./defines/types";
export * from "./defines/emit-schemas";
export * from "./defines/emit-isolator";
export * from "./defines/emit";
export * from "./defines/collect";
export * from "./defines/check";
