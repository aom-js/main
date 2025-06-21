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
        descriptor: PropertyDescriptor
      ) => {
        // здесь обязательно каррирование, так как иначе будет замена контекста исходного дескриптора изначального родительского класса
        const curriedDescriptor = (...args: any) => Reflect.apply(descriptor.value, null, args);
        // определим
        Reflect.defineProperty(target, property, {
          ...descriptor,
          value: curriedDescriptor,
        });
        const $childInstance = $._.base.instance(target, property);
        // и вот тут должен быть соответствующий перенос всех декораторов за счет переноса релевантных значений в callstack
        source._.callstack.transferTo($childInstance);
      };

      // $parent._.callstack.transferTo($);
      // console.log ('result callstack', $._.callstack.stores);
      // $._.migrateCallstack($parent);
      // console.log("parse parent", $parent._.target.name);
      /*
      // что есть процедура наследования соответствующих свойств
      // для начала перенесем middleware и какие-то очевидные свойства
      $.route.middlewares.push(..._$.route.middlewares);

      // перенесем бриджи, учитывая то, чтобы в текущем контроллере не было бриджей с тем же префиксом
      _$.route.bridges.forEach((bridge) => {
        const { prefix } = bridge;
        //
        if (!prefixes.includes(prefix)) {
          prefixes.push(prefix);
          $.route.bridges.push(bridge);
        } else {
          errors.push(`same bridge ${prefix}`);
        }
      });

      // перенесем ендпоинты, проверяя, что таких методов еще не объявлено в самом контроллере
      _$.route.endpoints.forEach((endpoint) => {
        const method = methodPath(endpoint);
        //
        if (!methods.includes(method)) {
          methods.push(method);
          $.route.endpoints.push(endpoint);
        } else {
          errors.push(`same method ${method}`);
        }
        //
      });
      */
      /*
      // перенесем декорированные данные из собственных свойств и методов
      $parent._.properties.forEach((__$) => {
        //
      });

      // перенесем декорированные данные из статичных свойств и методов
      $parent._.statics.forEach((__$) => {
        console.log("do static merge", __$);
        // проверим, что целевой объект не содержит собственного аналогичного свойства
        if (
          $._.target.prototype instanceof __$._.target &&
          !Reflect.getOwnPropertyDescriptor($._.target, __$._.property)
        ) {
          Reflect.defineProperty($._.target, __$._.property, __$._.target[__$._.property]);
          // определим его собственный инстанс
          const $__ = $._.base.instance($._.target, __$._.property);
          // перенесем полезные свойства из метода
          const { _, ...aomHttp } = __$;
          Object.assign($__, aomHttp);
        } else {
          //
          console.warn("same static property exists", __$);
        }
      });
      */

      // перенесем декорированные данные из статичных свойств и методов
      $parent._.origins.forEach((origin) => {
        const $origin = $._.base.instance(origin.descriptor.value);
        const isClassOrigin = origin.target === $origin._.target;

        if (isClassOrigin && !hasOwnProperty($._.target, $origin._.property)) {
          transferDescritorWithDecorators(
            $._.target,
            $origin._.property,
            $origin,
            origin.descriptor
          );
          // // здесь обязательно каррирование, так как иначе будет замена контекста исходного дескриптора изначального родительского класса
          // const curryDescriptor = (...args: any) =>
          //   Reflect.apply(origin.descriptor.value, null, args);
          // // определим
          // Reflect.defineProperty($._.target, $origin._.property, {
          //   ...origin.descriptor,
          //   value: curryDescriptor,
          // });
          // // определим его собственный инстанс
          // // проверить, что здесь создается именно инстанс для наследника, а не берется родительский по тому же дескриптору
          // const $childInstance = $._.base.instance($._.target, $origin._.property);
          // // и вот тут должен быть соответствующий перенос всех декораторов за счет переноса релевантных значений в callstack
          // $origin._.callstack.transferTo($childInstance);
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
