import { ClassConstructor, Constructor, Property } from "@aom/common";

// локальные импорты
import { Schemer, AomSchemas } from "./module";
import { ConnectionSchema } from "./types";
// import { IsolatedCallbackResponse, IsolatedMessageHeaders } from "./types";

/**
 * Декоратор для определения компонентной схемы
 * @param jsonSchema конфигурация визуализации
 * @returns Декоратор класса
 */
export function ComponentSchema(jsonSchema?: Schemer): ClassDecorator {
  //
  if (!jsonSchema) {
    jsonSchema = Schemer.default;
  }
  return AomSchemas.classDecorator(($) => {
    $.schemer = jsonSchema;
  });
}

export function ComponentConnect(schema: ConnectionSchema): PropertyDecorator {
  //
  return AomSchemas.propertyDecorator(($) => {
    const { property } = $._;
    $._.root.connections.set(property, schema);
  });
}
