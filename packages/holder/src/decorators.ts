import {
  Constructor,
  DecoratorsQueueStore,
  hasOwnProperty,
  InstanceTarget,
  Property,
} from "@aom-js/core";
import { AomHolder } from "./init";

export function Hold(...queue: PropertyDecorator[]): PropertyDecorator {
  return AomHolder.propertyDecorator(($) => {
    $.queue.push(...queue);
    //
  }, DecoratorsQueueStore.LAST);
}

export function Delay(...queue: ClassDecorator[]): ClassDecorator {
  return AomHolder.classDecorator(($) => {
    $.queue.push(...queue);

    const errors: Error[] = [];

    const inheritDecorators = (parent: Constructor) => {
      const $parent = $._.base.instance(parent);

      // console.log("$parent is", $parent._.origins);

      // перенесем собственные вызовы с родителя на конечного потомка
      $parent._.callstack.transferTo($);

      const transferDescritorWithDecorators = (
        target: InstanceTarget,
        property: Property,
        source: AomHolder,
        descriptor: PropertyDescriptor
      ) => {
        // // здесь обязательно каррирование, так как иначе будет замена контекста исходного дескриптора изначального родительского класса
        // const curriedDescriptor =
        //   descriptor && descriptor.value
        //     ? (...args: any) => Reflect.apply(descriptor.value, null, args)
        //     : undefined;
        // // определим дескриптор с учётом карирования
        // Reflect.defineProperty(target, property, {
        //   ...descriptor,
        //   value: curriedDescriptor,
        // });

        const $childInstance = $._.base.instance(target, property);
        // и вот тут должен быть соответствующий перенос всех декораторов за счет переноса релевантных значений в callstack
        source._.callstack.transferTo($childInstance);
      };

      // перенесем декорированные данные из статичных свойств и методов
      $parent._.origins.forEach((origin) => {
        const $origin = origin.self; // $._.base.instance(origin.descriptor.value);
        const isClassOrigin = origin.target === $origin._.target;
        //
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
    };
    // перенесем декораторы со свойствами из родителя
    inheritDecorators(Object.getPrototypeOf($._.target));

    $._.apply(); // применим перенесенные декораторы
  }, DecoratorsQueueStore.INSTANT);
}

export function Apply(...queue: ClassDecorator[]): ClassDecorator {
  return AomHolder.classDecorator(($) => {
    // применим стандартную процедуру delay для переноса всех свойств
    // console.log("apply delayed decorators", $._.target);
    Reflect.decorate([Delay(...queue)], $._.target);
    // console.log("parent transfered", $._.target);

    // и выполним запуск тех декораторов, которые были перенесены
    $._.origins.forEach((origin) => {
      const $origin = origin.self; // $._.base.instance(origin.descriptor.value);
      const isClassOrigin = origin.target === $origin._.target;

      // применим декораторы из очереди на те свойства, которые были созданы
      Reflect.decorate(
        origin.self.queue,
        isClassOrigin ? $._.target : $._.target.prototype,
        origin.property
      );
    });
    // применим собственные декораторы класса из его очереди
    Reflect.decorate($.queue, $._.target);
    //
  }, DecoratorsQueueStore.INSTANT);
}
