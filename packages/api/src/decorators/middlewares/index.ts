import { CombinedDecorator, Constructor, DecoratorsQueueStore } from "@aom-js/core";

import * as constants from "../../constants";
import { FwdContainer, HandlerFunction, MarkerHandler, MiddlewareHandler } from "../../common";

import { AomApi } from "../../common";
// ************************************************ //
// ...
export function Use(...middlewares: MiddlewareHandler[]): CombinedDecorator {
  return AomApi.combinedDecorator(($) => {
    $.element.addPreMiddlewares(
      ...middlewares
        .map((middleware) => AomApi.instance(middleware))
        .filter(($) => $.element.isMiddleware)
    );
  }, DecoratorsQueueStore.LAST);
}

export const UseBefore = Use;

// ...
export function UseAfter(...middlewares: MiddlewareHandler[]): CombinedDecorator {
  return AomApi.combinedDecorator(($) => {
    $.element.addPostMiddlewares(
      ...middlewares
        .map((middleware) => AomApi.instance(middleware))
        .filter(($) => $.element.isMiddleware)
    );
  }, DecoratorsQueueStore.LAST);
}

// ************************************************ //
// ...
export function Middleware(): MethodDecorator {
  return AomApi.methodDecorator(($, descriptor) => {
    if ($.element.isNextpoint || $.element.isEndpoint || $.element.isWebsocket) {
      throw new Error(constants.MIDDLEWARE_DEFINE_ERROR);
    } else {
      $.element.descriptor = descriptor;
      $.element.isMiddleware = true;
    }
  });
}
// ************************************************ //
// ...
export function Bridge(prefix: string, nextRoute: Constructor): CombinedDecorator {
  return AomApi.combinedDecorator(($, descriptor) => {
    const next = AomApi.instance(nextRoute);
    // если это bridge вокруг предварительного middleware
    // то добавим его в качестве самого первого вызова у следующего роута
    if (descriptor) {
      $.element.descriptor = descriptor;
      next.element.pre_middlewares = [$, ...next.element.pre_middlewares];
    }
    $._.root.element.bridges.push({ prefix, next, $ });
  });
}
// ************************************************ //
// ...
export function Marker(): MethodDecorator {
  return AomApi.methodDecorator(($, descriptor) => {
    $.element.isMarker = true;
    $.element.descriptor = descriptor;
  }, DecoratorsQueueStore.FIRST);
}

// ************************************************ //
// ...
export function UseMarker(handler: MarkerHandler): MethodDecorator {
  return AomApi.methodDecorator(($, descriptor) => {
    const marker = AomApi.instance(handler);
    if (marker.element.isMarker) {
      $.element.descriptor = descriptor;
      $.element.markers.push(marker);
    } else {
      throw new Error(constants.USE_MARKER_DEFINE_ERROR);
    }
  }, DecoratorsQueueStore.LAST);
}

// ************************************************ //
export function UseNext(handler: HandlerFunction | FwdContainer): MethodDecorator {
  return AomApi.methodDecorator(($, descriptor) => {
    const handlerInstance = AomApi.instance(
      handler instanceof FwdContainer ? handler.exec() : handler
    );
    if (handlerInstance.element.isNextpoint) {
      $.element.addNextpoint(handlerInstance);
    } else {
      throw new Error(constants.USE_NEXT_DEFINE_ERROR);
    }
  }, DecoratorsQueueStore.LAST);
}
