import { Type } from "./type.interface";

import { MappedType } from "./mapped-type.interface";
import { RemoveFieldsWithType } from "./types/remove-fields-with-type.type";
import { AomSchemas } from "../module";
import { ComponentSchema } from "../decorators";
import { InstanceTarget, Property } from "@aom-js/core";
import { CommonDescriptionsProperties, SchemaTypes } from "../types";
import { PropertySchema } from "../properties";

// https://stackoverflow.com/questions/50374908/transform-union-type-to-intersection-type
type UnionToIntersection<U> = (U extends any ? (k: U) => void : never) extends (k: infer I) => void
  ? I
  : never;

// Converts ClassRefs array `Type<Class>[]` to `Class[]` using `infer`
// e.g. `ClassRefsToConstructors<[Type<Foo>, Type<Bar>]>` becomes `[Foo, Bar]`
type ClassRefsToConstructors<T extends Type[]> = {
  [U in keyof T]: T[U] extends Type<infer V> ? V : never;
};

// Firstly, it uses indexed access type `Class[][number]` to convert `Class[]` to union type of it
// e.g. `[Foo, Bar][number]` becomes `Foo | Bar`
// then, uses the `UnionToIntersection` type to transform union type to intersection type
// e.g. `Foo | Bar` becomes `Foo & Bar`
// finally, returns `MappedType` passing the generated intersection type as a type argument
type Intersection<T extends Type[]> = MappedType<
  RemoveFieldsWithType<UnionToIntersection<ClassRefsToConstructors<T>[number]>, Function>
>;

/**
 * Builds a new component whose properties are the union of every listed class's own properties.
 *
 * Same rebuild mechanism as the other mapped-types, applied across several sources: for each class in
 * `classRefs`, walks its own decorated properties and re-applies each property's original
 * `PropertySchema.*` factory unchanged. Properties are collected into two maps (static and instance)
 * keyed by name, so when the same property name appears in more than one source class, the last class
 * passed wins. The result is a component under the fixed class name `IntersectionClassType` —
 * wrap it in a named subclass before using it as a `$ref` target. Composes with
 * the other mapped-types, including recursively (`IntersectionType(A, PartialType(B))`).
 *
 * @param classRefs - classes decorated with `\@ComponentSchema()`; later entries win on name conflicts
 * @returns a new anonymous component class with the combined properties of `classRefs`
 * @throws {Error} if any of `classRefs` is not a `\@ComponentSchema` class
 *
 * @example
 * ```ts
 * import { ComponentSchema, PropertySchema, IntersectionType, PickType } from "@aom-js/schemer";
 * import { entities } from "./entities";
 *
 * \@ComponentSchema()
 * class OrgIdDTO {
 *   \@PropertySchema.String({})
 *   orgId!: string;
 * }
 *
 * \@ComponentSchema()
 * class TicketBodyDTO extends PickType(entities.Tickets, ["title", "text"]) {}
 *
 * \@ComponentSchema()
 * class OrgTicketDTO extends IntersectionType(OrgIdDTO, TicketBodyDTO) {}
 * ```
 */
export function IntersectionType<T extends Type[]>(...classRefs: T) {
  abstract class IntersectionClassType {}
  type intersectionValue = [
    InstanceTarget,
    PropertyDescriptor | undefined,
    SchemaTypes,
    CommonDescriptionsProperties,
  ];
  const intersectionsMap: Map<Property, intersectionValue> = new Map();
  const intersectionsProtoMap: Map<Property, intersectionValue> = new Map();

  // mark as a mapped class — foldSchemas will unfold it into extends instead of a name reference
  AomSchemas.instance(IntersectionClassType).mapped = {
    kind: "Intersection",
    of: [...classRefs],
  };

  classRefs.forEach((classRef) => {
    const $classInstance = AomSchemas.checkExists(classRef);
    if (!$classInstance || !$classInstance.isComponentSchema) {
      throw new Error(`${classRef.name} parent class is not ComponentSchema constructor`);
    }

    $classInstance._.origins.forEach((origin) => {
      // if the original property has schemaName/schemaParams set (i.e. it was described via
      // PropertySchema.*), transfer exactly those, unchanged
      const { schemaName, schemaParams } = origin.self;
      if (schemaName && schemaParams) {
        const isClassOrigin = origin.target === origin._.target;
        const target = isClassOrigin ? IntersectionClassType : IntersectionClassType.prototype;
        const targetMap = isClassOrigin ? intersectionsMap : intersectionsProtoMap;
        targetMap.set(origin.property, [target, origin.descriptor, schemaName, schemaParams]);
      }
    });
    // at this point, this is where the set of attributes should be collected, which will be
  });

  intersectionsMap.forEach((value, property) => {
    const [target, descriptor, schemaName, schemaParams] = value;
    // Reflect.defineProperty(target, property, { ...descriptor });
    Reflect.decorate(
      // [Schema[schemaName](schemaParams)],
      [Reflect.apply(PropertySchema[schemaName], undefined, [schemaParams])],
      target,
      property,
    );
  });

  intersectionsProtoMap.forEach((value, property) => {
    const [target, descriptor, schemaName, schemaParams] = value;
    // Reflect.defineProperty(target, property, { ...descriptor });
    Reflect.decorate(
      // [Schema[schemaName](schemaParams)],
      [Reflect.apply(PropertySchema[schemaName], undefined, [schemaParams])],
      target,
      property,
    );
  });

  Reflect.decorate([ComponentSchema()], IntersectionClassType);

  return IntersectionClassType as Intersection<T>;
}
