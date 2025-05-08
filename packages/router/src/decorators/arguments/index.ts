import { ClassConstructor } from "@aom/common";
import * as constants from "../../constants";

import { ArgumentsDecoratorHandler, ArgumentsHandlerParameters } from "../../common";
import { FwdContainer, ThisRefContainer, RouteRefContainer } from "../../common";
import { HandlerFunction, AomHttp, AomCursor } from "../../common";

function defaultHandler(args: ArgumentsHandlerParameters | any) {
  return args;
}

export function Args(
  handler: ArgumentsDecoratorHandler = defaultHandler
): ReturnType<typeof AomHttp.parameterDecorator> {
  if (typeof handler !== "function") throw new Error(constants.PARAMETER_HANDLER_ERROR);
  return AomHttp.parameterDecorator(($, parameterIndex) => {
    $.route.parametersHandlers[parameterIndex] = handler;
  });
}

// ---
export function Query(
  queryHandler: Function | ThisRefContainer | RouteRefContainer = defaultHandler
): ReturnType<typeof Args> {
  const handler: ArgumentsDecoratorHandler = function (args) {
    const { context, cursor } = args;
    let resultHandler = queryHandler;
    if (queryHandler instanceof ThisRefContainer) {
      resultHandler = queryHandler.exec(cursor.$._.target);
    } else if (queryHandler instanceof RouteRefContainer) {
      resultHandler = queryHandler.exec(cursor.endpoint.$._.target);
    }

    return Reflect.apply(<Function>resultHandler, undefined, [context.values.query]);
  };
  return Args(handler);
}

// ---
export function Body(
  bodyHandler: Function | ThisRefContainer | RouteRefContainer = defaultHandler
): ReturnType<typeof Args> {
  const handler: ArgumentsDecoratorHandler = function (args) {
    const { context, cursor } = args;
    let resultHandler = bodyHandler;
    if (bodyHandler instanceof ThisRefContainer) {
      resultHandler = bodyHandler.exec(cursor.$._.target);
    } else if (bodyHandler instanceof RouteRefContainer) {
      resultHandler = bodyHandler.exec(cursor.endpoint.$._.target);
    }
    return Reflect.apply(<Function>resultHandler, undefined, [context.values.body]);
  };
  return Args(handler);
}

// ---
export function Params(
  paramsHandler: Function | ThisRefContainer | RouteRefContainer | string = defaultHandler
): ReturnType<typeof Args> {
  const handler: ArgumentsDecoratorHandler = function (args) {
    const { context, cursor } = args;
    let resultHandler = paramsHandler;
    if (paramsHandler instanceof ThisRefContainer) {
      resultHandler = paramsHandler.exec(cursor.$._.target);
    } else if (paramsHandler instanceof RouteRefContainer) {
      resultHandler = paramsHandler.exec(cursor.endpoint.$._.target);
    } else if ("string" === typeof paramsHandler) {
      return Reflect.get(context.values.params, paramsHandler);
    }
    return Reflect.apply(<Function>resultHandler, undefined, [context.values.params]);
  };
  return Args(handler);
}

// ---
export function Session(sessionName?: string): ReturnType<typeof Args> {
  const handler: ArgumentsDecoratorHandler = function (args) {
    const { context } = args;
    return sessionName ? Reflect.get(context.values.session, sessionName) : context.values.session;
  };
  return Args(handler);
}

// ---
export function Files(fileName?: string): ReturnType<typeof Args> {
  const handler: ArgumentsDecoratorHandler = function (args) {
    const { context } = args;
    return fileName ? Reflect.get(context.values.files, fileName) : context.values.files;
  };
  return Args(handler);
}

// ---
export function Headers(
  headerHandler: Function | ThisRefContainer | RouteRefContainer | string = defaultHandler
): ReturnType<typeof Args> {
  const handler: ArgumentsDecoratorHandler = function (args) {
    const { context, cursor } = args;
    let resultHandler = headerHandler;
    if (headerHandler instanceof ThisRefContainer) {
      resultHandler = headerHandler.exec(cursor.$._.target);
    } else if (headerHandler instanceof RouteRefContainer) {
      resultHandler = headerHandler.exec(cursor.endpoint.$._.target);
    } else if ("string" === typeof headerHandler) {
      return Reflect.get(context.values.headers, headerHandler);
    }
    return Reflect.apply(<Function>resultHandler, cursor.constructor, [context.values.headers]);
  };
  return Args(handler);
}

// ---
export function Next(): ReturnType<typeof Args> {
  const handler: ArgumentsDecoratorHandler = function ({ context, cursor }) {
    // return (...handlers: HandlerFunction[]) => nextSequences(handlers, args);
    return (...handlers: HandlerFunction[]) => {
      // восстановим из handler-ов курсоры с тем же эндпоинтом
      const cursors = handlers.map((handler) => {
        const $ = AomHttp.instance(handler);
        const result = new AomCursor($, cursor.prefix, cursor.endpoint);
        return result;
      });
      // вызовем рекурсивно тот же контекст, передав в него новый перечень курсоров
      // которые могут быть указаны внутри next()
      return context.run(cursors);
    };
  };
  return Args(handler);
}

// ---
export function Ctx() {
  const handler: ArgumentsDecoratorHandler = function (args) {
    const { context } = args;
    return context.values.ctx;
  };
  return Args(handler);
}

// ---
export function Err(ErrorConstructor: ClassConstructor = Error): ReturnType<typeof Args> {
  if (!(ErrorConstructor === Error || ErrorConstructor.prototype instanceof Error))
    throw new Error(constants.ERROR_CONSTRUCTOR_ERROR);
  const handler = function () {
    return function (message: string, status?: number, data?: any) {
      const error = new ErrorConstructor(message);
      status = status || error["status"] || Reflect.get(ErrorConstructor, "status");
      data = data || error["data"];
      return Object.assign(error, { status, data });
    };
  };
  return Args(handler);
}

// ---
export function Req() {
  const handler: ArgumentsDecoratorHandler = function (args) {
    const { context } = args;
    return context.values.req;
  };
  return Args(handler);
}

// ---
export function Res() {
  const handler: ArgumentsDecoratorHandler = function (args) {
    const { context } = args;
    return context.values.res;
  };
  return Args(handler);
}

// ---
export function Cursor(): ReturnType<typeof Args> {
  const handler: ArgumentsDecoratorHandler = function ({ cursor }) {
    return cursor.$;
  };
  return Args(handler);
}

// ---
export function Route(): ReturnType<typeof Args> {
  const handler: ArgumentsDecoratorHandler = function ({ cursor }) {
    return cursor.endpoint.$;
  };
  return Args(handler);
}

// ---
export function State(constructor = undefined): ReturnType<typeof Args> {
  const handler: ArgumentsDecoratorHandler = ({ context }) => {
    // если используется `FwdRef`, то в качестве целевого значения используем результат функции
    // if (constructor instanceof FwdContainer) {
    //   constructor = constructor.exec();
    // }
    return constructor ? context.state.get(constructor) : context.state;
  };
  return Args(handler);
}

// ---
export function This(
  constructor?: ClassConstructor | FwdContainer | RouteRefContainer
): ReturnType<typeof Args> {
  if (
    constructor &&
    !(
      constructor instanceof Function ||
      constructor instanceof FwdContainer ||
      constructor instanceof RouteRefContainer
    )
  ) {
    throw new Error(constants.CONSTRUCTOR_TYPE_ERROR);
  }
  // const handler = ({ ctx, cursor, route }: ArgumentsHandlerParameters) => {
  const handler: ArgumentsDecoratorHandler = ({ context, cursor }) => {
    let target: ClassConstructor;
    if (constructor instanceof FwdContainer) {
      // если используется `FwdRef`, то в качестве целевого значения используем результат функции
      target = constructor.exec();
    } else if (constructor instanceof RouteRefContainer) {
      // если используется RouteRef, то возвращается конструктор для текущего маршрута
      target = constructor.exec(cursor.endpoint.$._.target);
    } else if (constructor) {
      target = constructor;
    } else {
      target = cursor.$._.target;
    }

    let instance = context.state.get(target);
    if (!instance) {
      instance = Reflect.construct(target, []);
      context.state.set(target, instance);
    }
    return instance;
  };
  return Args(handler);
}
