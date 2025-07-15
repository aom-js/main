// локальные импорты
import {
  Constructor,
  DecoratorsQueueStore,
  hasOwnProperty,
  InstanceTarget,
  Property,
} from "@aom-js/core";
import { Schemer, AomSchemas } from "./module";
import { ConnectionSchema } from "./types";
// import { IsolatedCallbackResponse, IsolatedMessageHeaders } from "./types";

/**
 * Декоратор для определения компонентной схемы
 * @param schemer конфигурация визуализации
 * @returns Декоратор класса
 */
export function ComponentSchema(): ClassDecorator {
  //
  return AomSchemas.classDecorator(($) => {
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
    const inheritDecorators = (parent: Constructor) => {
      const $parent = $._.base.instance(parent);

      // console.log("$parent is", $parent._.origins);

      // перенесем собственные вызовы с родителя на конечного потомка
      $parent._.callstack.transferTo($);

      const transferDescritorWithDecorators = (
        target: InstanceTarget,
        property: Property,
        source: AomSchemas,
        descriptor: PropertyDescriptor
      ) => {
        // здесь обязательно каррирование, так как иначе будет замена контекста исходного дескриптора изначального родительского класса
        const curriedDescriptor =
          descriptor && descriptor.value
            ? (...args: any) => Reflect.apply(descriptor.value, null, args)
            : undefined;
        // определим дескриптор с учётом карирования
        Reflect.defineProperty(target, property, {
          ...descriptor,
          value: curriedDescriptor,
        });

        const $childInstance = $._.base.instance(target, property);
        // и вот тут должен быть соответствующий перенос всех декораторов за счет переноса релевантных значений в callstack
        source._.callstack.transferTo($childInstance);
      };

      // перенесем декорированные данные из статичных свойств и методов
      $parent._.origins.forEach((origin) => {
        const $origin = origin.self; // $._.base.instance(origin.descriptor.value);
        const isClassOrigin = origin.target === $origin._.target;
        // console.log("origin is", $origin);
        if (isClassOrigin && !hasOwnProperty($._.target, $origin._.property)) {
          transferDescritorWithDecorators(
            $._.target,
            $origin._.property,
            $origin,
            origin.descriptor
          );
        } else if (!isClassOrigin && !hasOwnProperty($._.target.prototype, $origin._.property)) {
          // иначе проверим, что это свойство самого инстанса, и надо создать соответствующие перенос
          transferDescritorWithDecorators(
            $._.target.prototype,
            $origin._.property,
            $origin,
            origin.descriptor
          );
        } else {
          errors.push(
            new Error(`same property exists ${$._.target.name}.${origin.property.toString()}`)
          );
        }
      });
      // запустим повторно процедуру, если текущий элемент не был компонентной схемой
      // а родитель для текущего родителя является компонентной схемой
      // if (
      //   !$parent.isComponentSchema &&
      //   $._.base.instance(Object.getPrototypeOf(parent)).isComponentSchema
      // ) {
      //   inheritDecorators(Object.getPrototypeOf(parent));
      // }
    };
    inheritDecorators(Object.getPrototypeOf($._.target));
    // console.log ($._, $._.origins);
    $._.apply(); // применим остальные декораторы
    if (errors.length) {
      console.error("ComponentSchema inherit errors", errors);
    }
  }, DecoratorsQueueStore.INSTANT);
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
