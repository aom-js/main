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
 * @publicApi
 */
export function IntersectionType<T extends Type[]>(...classRefs: T) {
  abstract class IntersectionClassType {}
  type intersectionValue = [
    InstanceTarget,
    PropertyDescriptor | undefined,
    SchemaTypes,
    CommonDescriptionsProperties
  ];
  const intersectionsMap: Map<Property, intersectionValue> = new Map();
  const intersectionsProtoMap: Map<Property, intersectionValue> = new Map();

  classRefs.forEach((classRef) => {
    const $classInstance = AomSchemas.checkExists(classRef);
    if (!$classInstance || !$classInstance.isComponentSchema) {
      throw new Error(`${classRef.name} parent class is not ComponentSchema constructor`);
    }

    $classInstance._.origins.forEach((origin) => {
      // если у оригинальной конструкции установлены соответствующие требуемые значения
      // то переносим исключительно их, добавляя в значения schemaParams правильно isOptional=true
      const { schemaName, schemaParams } = origin.self;
      if (schemaName && schemaParams) {
        const isClassOrigin = origin.target === origin._.target;
        const target = isClassOrigin ? IntersectionClassType : IntersectionClassType.prototype;
        const targetMap = isClassOrigin ? intersectionsMap : intersectionsProtoMap;
        targetMap.set(origin.property, [target, origin.descriptor, schemaName, schemaParams]);
      }
    });
    // теперь здесь следует собрать комплект атрибутов, которые будут
  });

  intersectionsMap.forEach((value, property) => {
    const [target, descriptor, schemaName, schemaParams] = value;
    // Reflect.defineProperty(target, property, { ...descriptor });
    Reflect.decorate(
      // [Schema[schemaName](schemaParams)],
      [Reflect.apply(PropertySchema[schemaName], undefined, [schemaParams])],
      target,
      property
    );
  });

  intersectionsProtoMap.forEach((value, property) => {
    const [target, descriptor, schemaName, schemaParams] = value;
    // Reflect.defineProperty(target, property, { ...descriptor });
    Reflect.decorate(
      // [Schema[schemaName](schemaParams)],
      [Reflect.apply(PropertySchema[schemaName], undefined, [schemaParams])],
      target,
      property
    );
  });

  Reflect.decorate([ComponentSchema()], IntersectionClassType);

  return IntersectionClassType as Intersection<T>;
}
