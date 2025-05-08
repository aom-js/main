import { HandlerFunction } from "../common/types";

export declare type NextFunction = (...middlewares: HandlerFunction[]) => Promise<HandlerFunction>;

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
