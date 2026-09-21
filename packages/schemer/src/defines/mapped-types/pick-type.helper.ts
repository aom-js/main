import { Type } from "./type.interface";
import { MappedType } from "./mapped-type.interface";
import { RemoveFieldsWithType } from "./types/remove-fields-with-type.type";

import { AomSchemas } from "../module";
import { ComponentSchema } from "../decorators";

import { PropertySchema } from "../properties";

/**
 * Builds a new component with only the listed properties of `classRef`, kept as originally described.
 *
 * Same rebuild mechanism as `PartialType`: walks `classRef`'s own decorated properties and re-applies
 * each selected property's original `PropertySchema.*` factory unchanged. The result is a component
 * in its own right (`ComponentSchema()` applied), but under the fixed class name `PickTypeClass`
 * (`KI-SCHEMER-07`) — wrap it in a named subclass before using it as a `$ref` target.
 *
 * @param classRef - a class decorated with `@ComponentSchema()`
 * @param keys - property names to keep
 * @returns a new anonymous component class with only `keys`
 * @throws {Error} if `classRef` is not a `@ComponentSchema` class
 *
 * @example
 * ```ts
 * import { ComponentSchema, PickType } from "@aom-js/schemer";
 * import { entities } from "./entities";
 *
 * @ComponentSchema({ description: "Profile update" })
 * export class ProfileUpdateDTO extends PickType(entities.Users, ["name", "surname", "birthDate"]) {}
 * ```
 */
export function PickType<T, K extends keyof T>(classRef: Type<T>, keys: readonly K[]) {
  abstract class PickTypeClass {}

  const $classInstance = AomSchemas.checkExists(classRef);
  if (!$classInstance || !$classInstance.isComponentSchema) {
    throw new Error(`${classRef.name} parent class is not ComponentSchema constructor`);
  }

  // mark as a mapped class — foldSchemas will unfold it into extends instead of a name reference
  AomSchemas.instance(PickTypeClass).mapped = {
    kind: "Pick",
    of: [classRef],
    keys: keys.map(String),
  };

  $classInstance._.origins.forEach((origin) => {
    const property = origin.property as K;
    if (keys.includes(property)) {
      // if the original property has schemaName/schemaParams set (i.e. it was described via
      // PropertySchema.*), transfer exactly those, unchanged
      const { schemaName, schemaParams } = origin.self;
      if (schemaName && schemaParams) {
        const isClassOrigin = origin.target === origin._.target;
        const target = isClassOrigin ? PickTypeClass : PickTypeClass.prototype;
        // find the matching property and add the decorator to it
        // Reflect.defineProperty(target, origin.property, { ...origin.descriptor });
        Reflect.decorate(
          [Reflect.apply(PropertySchema[schemaName], undefined, [schemaParams])],
          target,
          origin.property,
        );
      }
    }
  });
  Reflect.decorate([ComponentSchema()], PickTypeClass);

  return PickTypeClass as MappedType<
    RemoveFieldsWithType<Pick<T, (typeof keys)[number]>, Function>
  >;
}
