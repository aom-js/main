import { Type } from "./type.interface";
import { MappedType } from "./mapped-type.interface";
import { RemoveFieldsWithType } from "./types/remove-fields-with-type.type";

import { AomSchemas } from "../module";
import { ComponentSchema } from "../decorators";

import { Schema } from "../descriptors";

export function PickType<T, K extends keyof T>(
  classRef: Type<T>,
  keys: readonly K[]
): Type<Pick<T, (typeof keys)[number]>> {
  abstract class PickTypeClass {}

  const $classInstance = AomSchemas.checkExists(classRef);
  if (!$classInstance || !$classInstance.isComponentSchema) {
    throw new Error(`${classRef.name} parent class is not ComponentSchema constructor`);
  }

  $classInstance._.origins.forEach((origin) => {
    const property = origin.property as K;
    if (keys.includes(property)) {
      // если у оригинальной конструкции установлены соответствующие требуемые значения
      // то переносим исключительно их, добавляя в значения schemaParams правильно isOptional=true
      const { schemaName, schemaParams } = origin.self;
      if (schemaName && schemaParams) {
        const isClassOrigin = origin.target === origin._.target;
        const target = isClassOrigin ? PickTypeClass : PickTypeClass.prototype;
        // определим соответствующее свойство и добавим на него декоратор
        Reflect.defineProperty(target, origin.property, { ...origin.descriptor });
        Reflect.decorate([Schema[schemaName](schemaParams)], target, origin.property);
      }
    }
  });
  Reflect.decorate([ComponentSchema()], PickTypeClass);

  return PickTypeClass as MappedType<
    RemoveFieldsWithType<Pick<T, (typeof keys)[number]>, Function>
  >;
}
