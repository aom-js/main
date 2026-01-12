import { Type } from "./type.interface";

import { MappedType } from "./mapped-type.interface";

import { AomSchemas } from "../module";
import { ComponentSchema } from "../decorators";

import { PropertySchema } from "../properties";
import { RemoveFieldsWithType } from "./types/remove-fields-with-type.type";

/**
 * @publicApi
 */
export function PartialType<T>(classRef: Type<T>) {
  abstract class PartialClassType {}

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
      const target = isClassOrigin ? PartialClassType : PartialClassType.prototype;
      // определим соответствующее свойство и добавим на него декоратор
      // Reflect.defineProperty(target, origin.property, { ...origin.descriptor });
      Reflect.decorate(
        // [Schema[schemaName]({ ...schemaParams, isOptional: true })],
        [Reflect.apply(PropertySchema[schemaName], undefined, [{ ...schemaParams, isOptional: true }])],
        target,
        origin.property
      );
    }
  });

  Reflect.decorate([ComponentSchema()], PartialClassType);

  return PartialClassType as MappedType<RemoveFieldsWithType<Partial<T>, Function>>;
}
