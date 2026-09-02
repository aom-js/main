import { CombinedDecorator, ClassType, ExecutionPhase, InheritPlacement } from "@aom-js/core";

import * as constants from "../../constants";
import { FwdContainer, HandlerFunction, MarkerHandler, MiddlewareHandler } from "../../common";

import { AomApi } from "../../common";
// ************************************************ //
// ...
export function Before(...middlewares: Array<MiddlewareHandler | FwdContainer>): CombinedDecorator {
  // PREPEND: при наследовании родительские Before встают перед собственными Before потомка
  return AomApi.combinedDecorator(
    ($) => {
      $.element.addPreMiddlewares(
        ...middlewares
          .map((middleware) => (middleware instanceof FwdContainer ? middleware.exec() : middleware))
          // ссылка могла зафиксировать статику родителя (Self.Method до отработки @Controller);
          // доразрешаем её в контексте класса, объявившего декоратор
          .map((middleware) => AomApi.resolveFor(AomApi.instance(middleware), $._.target))
          .filter(($) => $.element.isMiddleware),
      );
    },
    ExecutionPhase.LAST,
    InheritPlacement.PREPEND,
  );
}

// export const UseBefore = Use;

// ...
export function After(...middlewares: Array<MiddlewareHandler | FwdContainer>): CombinedDecorator {
  return AomApi.combinedDecorator(($) => {
    $.element.addPostMiddlewares(
      ...middlewares
        .map((middleware) => (middleware instanceof FwdContainer ? middleware.exec() : middleware))
        .map((middleware) => AomApi.resolveFor(AomApi.instance(middleware), $._.target))
        .filter(($) => $.element.isMiddleware),
    );
  }, ExecutionPhase.LAST);
}

// ************************************************ //
// ...
export function Middleware(): MethodDecorator {
  return AomApi.methodDecorator(($, descriptor) => {
    if (
      $.element.isNextpoint ||
      $.element.isEndpoint ||
      $.element.isWebsocket ||
      $.element.isInstance
    ) {
      throw new Error(constants.MIDDLEWARE_DEFINE_ERROR);
    } else {
      $.element.descriptor = descriptor;
      $.element.isMiddleware = true;
    }
  });
}
// ************************************************ //
// ...
export function Bridge(prefix: string, nextRoute: ClassType): CombinedDecorator {
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
  }, ExecutionPhase.FIRST);
}

// ************************************************ //
// ...
export function UseMarker(handler: MarkerHandler | FwdContainer): MethodDecorator {
  return AomApi.methodDecorator(($, descriptor) => {
    const marker = AomApi.resolveFor(
      AomApi.instance(handler instanceof FwdContainer ? handler.exec() : handler),
      $._.target,
    );
    if (marker.element.isMarker) {
      $.element.descriptor = descriptor;
      $.element.markers.push(marker);
    } else {
      throw new Error(constants.USE_MARKER_DEFINE_ERROR);
    }
  }, ExecutionPhase.LAST);
}

// ************************************************ //
export function Next(handler: HandlerFunction | FwdContainer): MethodDecorator {
  return AomApi.methodDecorator(($, descriptor) => {
    const handlerInstance = AomApi.resolveFor(
      AomApi.instance(handler instanceof FwdContainer ? handler.exec() : handler),
      $._.target,
    );
    if (handlerInstance.element.isNextpoint) {
      $.element.addNextpoint(handlerInstance);
    } else {
      throw new Error(constants.USE_NEXT_DEFINE_ERROR);
    }
  }, ExecutionPhase.LAST);
}

// ************************************************ //
// ...
export function OnInstance(): MethodDecorator {
  return AomApi.methodDecorator(($, descriptor) => {
    if (
      $.element.isNextpoint ||
      $.element.isEndpoint ||
      $.element.isWebsocket ||
      $.element.isMiddleware
    ) {
      throw new Error(constants.ON_INSTANCE_DEFINE_ERROR);
    } else {
      $.element.descriptor = descriptor;
      $.element.isInstance = true;
      $._.root.element.instanceHooks.push($);
    }
  });
}
