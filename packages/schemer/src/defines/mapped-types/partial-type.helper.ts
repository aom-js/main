import { Type } from "./type.interface";

import { MappedType } from "./mapped-type.interface";

import { AomSchemas } from "../module";
import { ComponentSchema } from "../decorators";

import { PropertySchema } from "../properties";
import { RemoveFieldsWithType } from "./types/remove-fields-with-type.type";

/**
 * Builds a new component with every property of `classRef`, all made optional (`isOptional: true`).
 *
 * Rebuilds the class from `classRef`'s own decorated properties (`AomSchemas.origins`), re-applying
 * each property's original `PropertySchema.*` factory with `{...schemaParams, isOptional: true}` — a
 * property described with bare class-validator decorators (no `PropertySchema`) is silently dropped.
 * The result is itself decorated with `ComponentSchema()`, so it is a component in its own right, but
 * its class name is always the literal `PartialClassType` (`KI-SCHEMER-07`): wrap it in a named
 * subclass before using it as a `$ref` target (via `SchemasCollector` or `foldSchemas`) — used
 * unwrapped it is only safe where the schema gets flattened into plain parameters (e.g. query builders).
 *
 * @param classRef - a class decorated with `@ComponentSchema()`
 * @returns a new anonymous component class with all of `classRef`'s properties made optional
 * @throws {Error} if `classRef` is not a `@ComponentSchema` class
 *
 * @example
 * ```ts
 * import { ComponentSchema, PropertySchema, PartialType } from "@aom-js/schemer";
 *
 * @ComponentSchema()
 * class UserDto {
 *   @PropertySchema.String({})
 *   name!: string;
 * }
 *
 * @ComponentSchema()
 * class UserPatchDto extends PartialType(UserDto) {}
 * // UserPatchDto.name is now optional
 * ```
 */
export function PartialType<T>(classRef: Type<T>) {
  abstract class PartialClassType {}

  const $classInstance = AomSchemas.checkExists(classRef);
  if (!$classInstance || !$classInstance.isComponentSchema) {
    throw new Error(`${classRef.name} parent class is not ComponentSchema constructor`);
  }

  // mark as a mapped class — foldSchemas will unfold it into extends instead of a name reference
  AomSchemas.instance(PartialClassType).mapped = { kind: "Partial", of: [classRef] };

  $classInstance._.origins.forEach((origin) => {
    // if the original property has schemaName/schemaParams set (i.e. it was described via
    // PropertySchema.*), transfer exactly those, adding isOptional=true into schemaParams as we go
    const { schemaName, schemaParams } = origin.self;
    if (schemaName && schemaParams) {
      const isClassOrigin = origin.target === origin._.target;
      const target = isClassOrigin ? PartialClassType : PartialClassType.prototype;
      // find the matching property and add the decorator to it
      // Reflect.defineProperty(target, origin.property, { ...origin.descriptor });
      Reflect.decorate(
        // [Schema[schemaName]({ ...schemaParams, isOptional: true })],
        [
          Reflect.apply(PropertySchema[schemaName], undefined, [
            { ...schemaParams, isOptional: true },
          ]),
        ],
        target,
        origin.property,
      );
    }
  });

  Reflect.decorate([ComponentSchema()], PartialClassType);

  return PartialClassType as MappedType<RemoveFieldsWithType<Partial<T>, Function>>;
}
