/**
 * Public entry point of `@aom-js/schemer`. Registers `reflect-metadata` (required by the
 * class-validator/class-transformer decorators this package builds on) and re-exports the
 * package's public API: `ComponentSchema`, `PropertySchema`, `Schemer`, `SchemasCollector`,
 * `foldSchemas` and the four mapped-type helpers.
 */
import "reflect-metadata";

export * from "./defines/decorators";
export * from "./defines/types";
export * from "./defines/module";
export * from "./defines/collector";
export * from "./defines/folding";
export { PropertySchema } from "./defines/properties";

export * from "./defines/mapped-types";
export * from "./defines/helpers";
