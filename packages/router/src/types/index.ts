import { HandlerFunction } from "../common/types";

export declare type RunFunction = (...middlewares: HandlerFunction[]) => Promise<any>;

export declare interface HttpContextValues {
  ctx: any;
  req: any;
  res: any;
  body: any;
  files: any;
  query: Record<string, string | string[]>;
  params: Record<string, string>;
  cookies: Record<string, string>;
  headers: Record<string, string | string[]>;
  session: Record<string, any>;
}
