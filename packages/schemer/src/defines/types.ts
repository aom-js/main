import { ClassConstructor } from "@aom-js/core";
import { ValidationArguments } from "class-validator";

/**
 * Lazy reference to a related component class, as passed to `PropertySchema.Type({ value })`.
 * Resolved by calling it with no arguments — laziness is what lets two components reference each
 * other regardless of declaration order (`A.b: () => B`, `B.a: () => A`).
 */
export declare type ConnectionSchema = () => ClassConstructor;

/** Fields shared by every `@ComponentSchema`/`PropertySchema.*` params object. */
export declare interface BaseDescriptionsProperties {
  description?: string;
  deprecated?: boolean;
}

/**
 * Parameters accepted by `@ComponentSchema(params)`. `decorators` are applied last, after every
 * property has been decorated — they are not merged into the class's rendered JSON Schema, unlike
 * `description`/`deprecated`. There is no field to rename the component: its name is always
 * `target.name`.
 */
export declare interface ClassDescriptionsProperties extends BaseDescriptionsProperties {
  decorators?: ClassDecorator[];
}

/** Parameters shared by every `PropertySchema.*` factory, in addition to type-specific ones. */
export declare interface CommonDescriptionsProperties extends BaseDescriptionsProperties {
  /** Also accept `null` (applies `IsNullable`, i.e. `ValidateIf(value !== null)`) — independent of `isOptional`. */
  nullable?: boolean;
  /** Example values surfaced in the rendered JSON Schema. */
  examples?: any[];
  /** Skip the main validator when the value is `undefined`; the property is also left out of `required`. */
  isOptional?: boolean;
  /** Exclude the property from class-transformer output (`instanceToPlain`) — `Exclude()`. */
  hidden?: boolean;
  /** Mark the property read-only in the rendered JSON Schema. */
  readOnly?: boolean;
  /** Treat the property as an array of the described type; range/pattern validators get `each: true`. */
  isArray?: boolean;
  /** Custom class-validator error message for the property's main validator. */
  message?: string | ((validationArguments: ValidationArguments) => string);
  /** class-validator groups the main validator belongs to. */
  groups?: string[];
  /** Run the main validator even when groups are specified elsewhere. */
  always?: boolean;
  /** Extra property decorators, applied last — after the factory's own decorator set. */
  decorators?: PropertyDecorator[];
}

/**
 * Discriminator for the `PropertySchema.*` factories. Also the value stored in
 * `AomSchemas.schemaName` for a decorated property and in `FoldedProperty.factory` after
 * `foldSchemas` — the same string identifies which factory to call when reconstructing a class
 * (e.g. `@aom-js/codegen`'s `emitSchemas`).
 */
export enum SchemaTypes {
  STRING = "String",
  DATE = "Date",
  NUMBER = "Number",
  BOOLEAN = "Boolean",
  ENUM = "Enum",
  ANY = "Any",
  TYPE = "Type",
}
