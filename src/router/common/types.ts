import { Constructor } from "../../common";

export declare interface HttpContextValues {
  ctx: any;
  req: any;
  res: any;
  body: any;
  files: any;
  query: any;
  params: any;
  cookies: any;
  headers: any;
  session: any;
}

export declare type HTTPMethods = "get" | "post" | "put" | "patch" | "delete" | "options" | "all";

export declare type HandlerFunction = (...args: any[]) => any;

export declare type MiddlewareHandler = HandlerFunction;

export declare type FwdFunction = () => HandlerFunction | Constructor;

export declare type RefFunction = (constructor: Constructor) => any;

export declare type ContainerFunction = FwdFunction | RefFunction;
