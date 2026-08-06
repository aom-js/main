// добавим декоратор для описания класса
import { ClassType, ExecutionPhase } from "@aom-js/core";
import { JSONSchema } from "class-validator-jsonschema";
// локальные импорты
import { Schemer, AomSchemas } from "./module";
import { ClassDescriptionsProperties } from "./types";
// import { IsolatedCallbackResponse, IsolatedMessageHeaders } from "./types";

/**
 * Декоратор для определения компонентной схемы
 * @param schemer конфигурация визуализации
 * @returns Декоратор класса
 */
export function ComponentSchema(params?: ClassDescriptionsProperties): ClassDecorator {
  //
  return AomSchemas.classDecorator(($: AomSchemas) => {
    // $.schemer = schemer;
    $.isComponentSchema = true;
    // console.log ('make inherits for', $);
    const errors: Error[] = [];
    // тут следует делать наследование с переносом исходных декораторов
    // наследование в данной ситуации будет немного отличаться от того, что применялось для контроллеров
    // в частности по той причине, что могут происходить разного рода обрезания через mapped-types или идентичные инструменты
    // что, к слову, приводит к тому, что по хорошему надо сделать свой собственный вариант mapped-types
    // повторив в нём то же, что использует, например @buddh4/mapped-types, и объединив их со своими декораторами
    // и это, кстати, выглядит как дельная мысль
    // унаследовать декораторы
    const inheritDecorators = (parent: ClassType) => {
      $._.inherit(parent);
    };
    inheritDecorators(Object.getPrototypeOf($._.target));

    // если указаны параметры, то применим соответствующее описание классу
    if (params) {
      const decorators = [JSONSchema({ ...params })];
      Reflect.decorate(decorators, $._.target);
    }

    $._.apply(); // применим остальные декораторы

    Reflect.decorate(params?.decorators || [], $._.target); // применим декораторы добавленные в контекст компоненты
    if (errors.length) {
      console.error("ComponentSchema inherit errors", errors);
    }
  }, ExecutionPhase.INSTANT);
}

/*
export function ComponentConnect(schema: ConnectionSchema): PropertyDecorator {
  //
  return AomSchemas.propertyDecorator(($) => {
    const { property } = $._;
    $._.root.connections.set(property, schema);
  });
}
*/
