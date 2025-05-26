import { Constructor } from "@aom/core";

export declare type HTTPMethods = "get" | "post" | "put" | "patch" | "delete" | "options" | "all" | "sockets";

export declare type HandlerFunction = (...args: any[]) => any;

export declare type MiddlewareHandler = HandlerFunction;

export declare type FwdFunction = () => HandlerFunction | Constructor;

export declare type RefFunction = (constructor: Constructor) => any;

export declare type ContainerFunction = FwdFunction | RefFunction;
