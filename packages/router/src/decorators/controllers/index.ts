import { Constructor } from "@aom/core";
import { AomHttp } from "../../common";

export function Controller() {
  return AomHttp.classDecorator(($) => {
    $.route.isController = true;

    const methodPath = ({ method, path }) => [method, path].join(":");

    const prefixes = $.route.bridges.map((bridge) => bridge.prefix);
    const methods = $.route.endpoints.map(methodPath);

    const errors: string[] = [];
    // унаследовать декораторы
    const inheritDecorators = (parent: Constructor) => {
      const _$ = AomHttp.instance(parent);

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

      // запустим повторно процедуру, если родитель для текущего родителя сам является контроллером
      if (AomHttp.instance(Object.getPrototypeOf(parent)).route.isController) {
        inheritDecorators(Object.getPrototypeOf(parent));
      }
    };

    inheritDecorators(Object.getPrototypeOf($._.target));
  });
}
