import { ClassType, CombinedDecorator, ExecutionPhase } from "@aom-js/core";
import { AomHolder } from "./init";

// Очередь holder'а по смыслу разнородна: Hold кладёт в неё декораторы свойств,
// Delay/Apply — декораторы классов, а применяются они через Reflect.decorate
// с нужной арностью в каждом месте. Выразить это в типах нельзя (у CombinedDecorator
// propertyKey необязателен, у PropertyDecorator — обязателен), поэтому на границе
// очереди стоят приведения.
export function Hold(...queue: PropertyDecorator[]): PropertyDecorator {
  return AomHolder.propertyDecorator(($) => {
    $.queue.push(...(queue as unknown as CombinedDecorator[]));
    //
  }, ExecutionPhase.LAST);
}

export function Delay(...queue: ClassDecorator[]): ClassDecorator {
  return AomHolder.classDecorator(($) => {
    $.queue.push(...queue);

    const errors: Error[] = [];

    const inheritDecorators = (parent: ClassType) => {
      $._.inherit(parent);
    };
    // перенесем декораторы со свойствами из родителя
    inheritDecorators(Object.getPrototypeOf($._.target));

    $._.apply(); // применим перенесенные декораторы
  }, ExecutionPhase.INSTANT);
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
        origin.self.queue as unknown as PropertyDecorator[],
        isClassOrigin ? $._.target : $._.target.prototype,
        origin.property,
      );
    });
    // применим собственные декораторы класса из его очереди
    Reflect.decorate($.queue, $._.target);
    //
  }, ExecutionPhase.INSTANT);
}
