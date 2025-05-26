import * as constants from "../../constants";

import { HandlerFunction, HTTPMethods } from "../../common";

import { AomApi } from "../../common";

/**
 * определить endpoint: вернуть типичный Endpoint по методу, или подключить
 * отложенный endpoint
 */
function defineEndpoint(
  method: HTTPMethods,
  path: string,
  handler?: HandlerFunction
): ReturnType<typeof Endpoint> | ClassDecorator {
  if (!handler) {
    return Endpoint(method, path);
  }

  return AomApi.classDecorator(($) => {
    const handlerOrigin = AomApi.instance(handler);
    if (handlerOrigin.element.isNextpoint) {
      $.element.endpoints.push({ method, prefix: path, $: handlerOrigin });
    } else {
      throw new Error(constants.COMMON_ENDPOINT_ERROR);
    }
  });
}

// установим признак, что это nextPoint
export function Nextpoint(): ReturnType<typeof AomApi.methodDecorator> {
  return AomApi.methodDecorator(($, descriptor) => {
    if ($.element.isMiddleware) {
      throw new Error(constants.NEXPOINT_DEFINE_ERROR);
    } else {
      $.element.descriptor = descriptor;
      $.element.isNextpoint = true;
    }
  });
}

// установим признак, что это websocket, и добавим его в соответствуюший набор ендпоинтов, коим он и является
// и использует специфический метод SOCKETS
export function WebSocketPoint(path?: string): ReturnType<typeof AomApi.methodDecorator> {
  return AomApi.methodDecorator(($, descriptor) => {
    if ($.element.isMiddleware || $.element.isNextpoint) {
      throw new Error(constants.NEXPOINT_DEFINE_ERROR);
    } else {
      $.element.descriptor = descriptor;
      $.element.isWebsocket = true;
      $._.root.element.websockets.push({ method: "sockets", prefix: path, $ });
    }
  });
}

/**
 *
 * @param method {HTTPMethods} метод endpoint-а
 * @param path {string} путь endpoint-а
 * @returns {ReturnType<typeof AomApi.methodDecorator>}
 */
export function Endpoint(
  method: HTTPMethods,
  path: string = "/"
): ReturnType<typeof AomApi.methodDecorator> {
  return AomApi.methodDecorator(($, descriptor) => {
    if ($.element.isMiddleware || $.element.isWebsocket) {
      throw new Error(constants.ENDPOINT_DEFINE_ERROR);
    } else {
      $.element.descriptor = descriptor;
      $.element.isEndpoint = true;
      $._.root.element.endpoints.push({ method, prefix: path, $ });
    }
  });
}

// ************************************************ //
export function Get(path?: string): MethodDecorator;
export function Get(path: string, handler: HandlerFunction): ClassDecorator;

/**
 * определить endpoint с указанным адресом по методу `GET`
 * @param path адрес пути, по которому осуществляется доступ к endpoint-у
 * @param handler перехваченный endpoint (только для декоратора класса)
 * @returns ClassDecorator | MethodDecorator
 */
export function Get(
  path: string = "/",
  handler?: HandlerFunction
): ReturnType<typeof defineEndpoint> {
  const method = "get";
  return defineEndpoint(method, path, handler);
}

// ************************************************ //
export function Post(path?: string): MethodDecorator;
export function Post(path: string, handler: HandlerFunction): ClassDecorator;

/**
 * определить endpoint с указанным адресом по методу `POST`
 * @param path адрес пути, по которому осуществляется доступ к endpoint-у
 * @param handler перехваченный endpoint (только для декоратора класса)
 * @returns ClassDecorator | MethodDecorator
 */
export function Post(
  path: string = "/",
  handler?: HandlerFunction
): ReturnType<typeof defineEndpoint> {
  const method = "post";
  return defineEndpoint(method, path, handler);
}

// ************************************************ //
export function Patch(path?: string): MethodDecorator;
export function Patch(path: string, handler: HandlerFunction): ClassDecorator;

/**
 * определить endpoint с указанным адресом по методу `PATCH`
 * @param path адрес пути, по которому осуществляется доступ к endpoint-у
 * @param handler перехваченный endpoint (только для декоратора класса)
 * @returns ClassDecorator | MethodDecorator
 */
export function Patch(
  path: string = "/",
  handler?: HandlerFunction
): ReturnType<typeof defineEndpoint> {
  const method = "patch";
  return defineEndpoint(method, path, handler);
}

// ************************************************ //
export function Put(path?: string): MethodDecorator;
export function Put(path: string, handler: HandlerFunction): ClassDecorator;
/**
 * определить endpoint с указанным адресом по методу `PUT`
 * @param path адрес пути, по которому осуществляется доступ к endpoint-у
 * @param handler перехваченный endpoint (только для декоратора класса)
 * @returns ClassDecorator | MethodDecorator
 */
export function Put(
  path: string = "/",
  handler?: HandlerFunction
): ReturnType<typeof defineEndpoint> {
  const method = "put";
  return defineEndpoint(method, path, handler);
}

// ************************************************ //
export function Options(path?: string): MethodDecorator;
export function Options(path: string, handler: HandlerFunction): ClassDecorator;

/**
 * определить endpoint с указанным адресом по методу `OPTIONS`
 * @param path адрес пути, по которому осуществляется доступ к endpoint-у
 * @param handler перехваченный endpoint (только для декоратора класса)
 * @returns ClassDecorator | MethodDecorator
 */
export function Options(
  path: string = "/",
  handler?: HandlerFunction
): ReturnType<typeof defineEndpoint> {
  const method = "options";
  return defineEndpoint(method, path, handler);
}

// ************************************************ //
export function Delete(path?: string): MethodDecorator;
export function Delete(path: string, handler: HandlerFunction): ClassDecorator;
/**
 * определить endpoint с указанным адресом по методу `DELETE`
 * @param path адрес пути, по которому осуществляется доступ к endpoint-у
 * @param handler перехваченный endpoint (только для декоратора класса)
 * @returns ClassDecorator | MethodDecorator
 */
export function Delete(
  path: string = "/",
  handler?: HandlerFunction
): ReturnType<typeof defineEndpoint> {
  const method = "delete";
  return defineEndpoint(method, path, handler);
}

// ************************************************ //
export function All(path?: string): MethodDecorator;
export function All(path: string, handler: HandlerFunction): ClassDecorator;
/**
 * определить endpoint с указанным адресом по методу `ALL`
 * @param path адрес пути, по которому осуществляется доступ к endpoint-у
 * @param handler перехваченный endpoint (только для декоратора класса)
 * @returns ClassDecorator | MethodDecorator
 */
export function All(
  path: string = "/",
  handler?: HandlerFunction
): ReturnType<typeof defineEndpoint> {
  const method = "all";
  return defineEndpoint(method, path, handler);
}
