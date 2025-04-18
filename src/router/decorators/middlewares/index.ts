import * as constants from "../../constants";

import { CombinedDecorator, Constructor, Property } from "../../../common";
import { FwdContainer, HandlerFunction, MarkerHandler, MiddlewareHandler } from "../../common";

import { AomHttp } from "../../common";
// ************************************************ //
// ...
export function Use(...middlewares: MiddlewareHandler[]): CombinedDecorator {
  return AomHttp.combinedDecorator(($) => {
    $.route.middlewares.push(
      ...middlewares
        .map((middleware) => AomHttp.instance(middleware))
        .filter(($) => $.route.isMiddleware)
    );
  });
}
// ************************************************ //
// ...
export function Middleware(): MethodDecorator {
  return AomHttp.staticDecorator(($, descriptor) => {
    if ($.route.isNextpoint || $.route.isEndpoint) {
      throw new Error(constants.MIDDLEWARE_DEFINE_ERROR);
    } else {
      $.route.descriptor = descriptor;
      $.route.isMiddleware = true;
    }
  });
}
// ************************************************ //
// ...
export function Bridge(prefix: string, nextRoute: Constructor): CombinedDecorator {
  return AomHttp.combinedDecorator(($, descriptor) => {
    const next = AomHttp.instance(nextRoute);
    // если это bridge вокруг предварительного middleware
    // то добавим его в качестве самого первого вызова у следующего роута
    if (descriptor) {
      $.route.descriptor = descriptor;
      next.route.middlewares = [$, ...next.route.middlewares];
    }
    $._.root.route.bridges.push({ prefix, next, $ });
  });
}
// ************************************************ //
// ...
export function Marker(handler: MarkerHandler): MethodDecorator {
  return AomHttp.staticDecorator(($, descriptor) => {
    const marker = AomHttp.instance(handler);
    $.route.descriptor = descriptor;
    $.route.markers.push({ marker, $ });
  });
}

// ************************************************ //
export function UseNext(handler: HandlerFunction | FwdContainer): MethodDecorator {
  return AomHttp.staticDecorator(($) => {
    const handlerInstance = AomHttp.instance(
      handler instanceof FwdContainer ? handler.exec() : handler
    );
    if (handlerInstance.route.isNextpoint) {
      $.route.nextpoint = handlerInstance;
    } else {
      throw new Error(constants.USE_NEXT_DEFINE_ERROR);
    }
  });
}
