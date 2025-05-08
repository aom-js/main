import { Constructor } from "@aom/common";

export declare type HTTPMethods = "get" | "post" | "put" | "patch" | "delete" | "options" | "all";

export declare type HandlerFunction = (...args: any[]) => any;

export declare type MiddlewareHandler = HandlerFunction;

export declare type FwdFunction = () => HandlerFunction | Constructor;

export declare type RefFunction = (constructor: Constructor) => any;

export declare type ContainerFunction = FwdFunction | RefFunction;
