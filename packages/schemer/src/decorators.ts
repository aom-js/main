// локальные импорты
import { Schemer, AomSchemas } from "./module";
import { ConnectionSchema } from "./types";
// import { IsolatedCallbackResponse, IsolatedMessageHeaders } from "./types";

/**
 * Декоратор для определения компонентной схемы
 * @param schemer конфигурация визуализации
 * @returns Декоратор класса
 */
export function ComponentSchema(schemer?: Schemer): ClassDecorator {
  //
  if (!schemer) {
    schemer = Schemer.default;
  }
  return AomSchemas.classDecorator(($) => {
    $.schemer = schemer;
  });
}

export function ComponentConnect(schema: ConnectionSchema): PropertyDecorator {
  //
  return AomSchemas.propertyDecorator(($) => {
    const { property } = $._;
    $._.root.connections.set(property, schema);
  });
}
