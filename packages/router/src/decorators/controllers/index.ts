import { ClassType, ExecutionPhase } from "@aom-js/core";
import { AomApi } from "../../common";

export function Controller() {
  return AomApi.classDecorator(($) => {
    $.element.isController = true;

    const errors: Error[] = [];
    // унаследовать декораторы
    const inheritDecorators = (parent: ClassType) => {
      // вот тут при переносе надо сделать так, чтобы родительские декораторы выполнились первыми, а не последними
      const $parent = $._.inherit(parent);

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
  }, ExecutionPhase.INSTANT);
  // этот декоратор не сохраняем, чтобы не вызывать рекурсии при переносе
}
