import {
  Constructor,
  DecoratorsQueueStore,
  hasOwnProperty,
  InstanceTarget,
  Property,
} from "@aom-js/core";
import { AomApi } from "../../common";

export function Controller() {
  return AomApi.classDecorator(($) => {
    $.element.isController = true;

    const errors: Error[] = [];
    // унаследовать декораторы
    const inheritDecorators = (parent: Constructor) => {
      const $parent = $._.base.instance(parent);

      // перенесем собственные вызовы с родителя на конечного потомка
      $parent._.callstack.transferTo($);

      const transferDescritorWithDecorators = (
        target: InstanceTarget,
        property: Property,
        source: AomApi,
        descriptor: PropertyDescriptor,
      ) => {
        // здесь обязательно каррирование, так как иначе будет замена контекста исходного дескриптора изначального родительского класса
        const curriedDescriptor = (...args: any) => Reflect.apply(descriptor.value, null, args);
        // определим
        Reflect.defineProperty(target, property, {
          ...descriptor,
          value: curriedDescriptor,
        });
        const $childInstance = $._.base.instance(target, property as string);
        // и вот тут должен быть соответствующий перенос всех декораторов за счет переноса релевантных значений в callstack
        source._.callstack.transferTo($childInstance);
      };

      // перенесем декорированные данные из статичных свойств и методов
      $parent._.origins.forEach((origin) => {
        const $origin = $._.base.instance(origin.descriptor.value);
        const isClassOrigin = origin.target === $origin._.target;

        if (isClassOrigin && !hasOwnProperty($._.target, $origin._.property!)) {
          transferDescritorWithDecorators(
            $._.target,
            $origin._.property!,
            $origin,
            origin.descriptor,
          );
        } else if (!isClassOrigin && !hasOwnProperty($._.target.prototype, $origin._.property!)) {
          // иначе проверим, что это свойство самого инстанса, и надо создать соответствующие перенос
          transferDescritorWithDecorators(
            $._.target.prototype,
            $origin._.property!,
            $origin,
            origin.descriptor,
          );
        } else {
          errors.push(
            new Error(`same property exists ${$._.target.name}.${origin.property.toString()}`),
          );
        }
      });

      // запустим повторно процедуру, если текущий элемент не был контроллером, а родитель для текущего родителя является контроллером
      if (
        !$parent.element.isController &&
        $._.base.instance(Object.getPrototypeOf(parent)).element.isController
      ) {
        inheritDecorators(Object.getPrototypeOf(parent));
      }
    };
    inheritDecorators(Object.getPrototypeOf($._.target));
    $._.apply(); // вызовем собственные отложенные декораторы
  }, DecoratorsQueueStore.INSTANT);
  // этот декоратор не сохраняем, чтобы не вызывать рекурсии при переносе
}
