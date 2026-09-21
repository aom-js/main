import { Type } from "./type.interface";
import { MappedType } from "./mapped-type.interface";
import { RemoveFieldsWithType } from "./types/remove-fields-with-type.type";

import { AomSchemas } from "../module";
import { ComponentSchema } from "../decorators";

import { PropertySchema } from "../properties";

/**
 * Builds a new component with every property of `classRef` except the listed ones, kept as
 * originally described.
 *
 * Same rebuild mechanism as `PartialType`/`PickType`, inverted: keeps every own property whose name
 * is not in `keys`. The result is a component under the fixed class name `OmitTypeClass`
 * (`KI-SCHEMER-07`) — wrap it in a named subclass before using it as a `$ref` target.
 *
 * @param classRef - a class decorated with `\@ComponentSchema()`
 * @param keys - property names to drop
 * @returns a new anonymous component class without `keys`
 * @throws {Error} if `classRef` is not a `\@ComponentSchema` class
 *
 * @example
 * ```ts
 * import { ComponentSchema, PropertySchema, OmitType } from "@aom-js/schemer";
 *
 * \@ComponentSchema()
 * class UserDto {
 *   \@PropertySchema.String({})
 *   id!: string;
 *
 *   \@PropertySchema.String({})
 *   password!: string;
 * }
 *
 * \@ComponentSchema()
 * class PublicUserDto extends OmitType(UserDto, ["password"]) {}
 * ```
 */
export function OmitType<T, K extends keyof T>(classRef: Type<T>, keys: readonly K[]) {
  abstract class OmitTypeClass {}

  const $classInstance = AomSchemas.checkExists(classRef);
  if (!$classInstance || !$classInstance.isComponentSchema) {
    throw new Error(`${classRef.name} parent class is not ComponentSchema constructor`);
  }

  // mark as a mapped class — foldSchemas will unfold it into extends instead of a name reference
  AomSchemas.instance(OmitTypeClass).mapped = {
    kind: "Omit",
    of: [classRef],
    keys: keys.map(String),
  };

  $classInstance._.origins.forEach((origin) => {
    const property = origin.property as K;
    if (!keys.includes(property)) {
      // if the original property has schemaName/schemaParams set (i.e. it was described via
      // PropertySchema.*), transfer exactly those, unchanged
      const { schemaName, schemaParams } = origin.self;
      if (schemaName && schemaParams) {
        const isClassOrigin = origin.target === origin._.target;
        const target = isClassOrigin ? OmitTypeClass : OmitTypeClass.prototype;
        // find the matching property and add the decorator to it
        // Reflect.defineProperty(target, origin.property, { ...origin.descriptor });
        Reflect.decorate(
          //[Schema[schemaName](schemaParams)]
          [Reflect.apply(PropertySchema[schemaName], undefined, [schemaParams])],
          target,
          origin.property,
        );
      }
    }
  });
  Reflect.decorate([ComponentSchema()], OmitTypeClass);

  return OmitTypeClass as MappedType<
    RemoveFieldsWithType<Omit<T, (typeof keys)[number]>, Function>
  >;
}
