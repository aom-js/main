import { ClassType } from "@aom-js/core";

export declare type HTTPMethods =
  | "get"
  | "post"
  | "put"
  | "patch"
  | "delete"
  | "options"
  | "all"
  | "sockets";

export declare type HandlerFunction = (...args: any[]) => any;

export declare type MiddlewareHandler = HandlerFunction;

export declare type FwdFunction = () => HandlerFunction | ClassType;

export declare type RefFunction = (constructor: ClassType) => any;

export declare type ContainerFunction = FwdFunction | RefFunction;
