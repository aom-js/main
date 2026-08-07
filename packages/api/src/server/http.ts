import http from "node:http";
import path from 'node:path';
import { parse } from "node:url";
import Stream from "node:stream";
import { Router, AomRoute, type HTTPMethods } from "@aom-js/router";

//
import { ErrorMessage, NotFoundResponse } from "../responses";
import { messages, locales } from "../constants";
import { type AomServerSettings } from "./types";
import { I18nizer } from "./i18nizer";


declare type StringStructures = Record<string, string | string[]>;
// node отдаёт заголовки (IncomingHttpHeaders) и query (ParsedUrlQuery) со значениями
// `string | string[] | undefined`, а контракт роутера — только заполненные значения.
// Пустые ключи отбрасываем здесь, а не размазываем проверки по хендлерам.
function definedValues(
  source: Record<string, string | string[] | undefined>,
): StringStructures {
  const result: StringStructures = {};
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined) result[key] = value;
  }
  return result;
}

function structurizeValues(
  source: Record<string, string | string[] | undefined>,
): StringStructures {
  const result: StringStructures = {};
  for (const [key, value] of source) {
    if (key in result) {
      const current = query[key];
      result[key] = Array.isArray(current)
        ? [...current, value]
        : [current!, value];
    } else {
      result[key] = value;
    }
  }
  return result;
}

//
class RouteMatcher {
  private routes: Map<string, AomRoute[]> = new Map();
  private patterns: Map<string, RegExp> = new Map();
  private paramValidators: Map<string, Map<string, RegExp>> = new Map();

  addRoute(route: AomRoute) {
    if (!route.method) return;

    const method = route.method.toLowerCase();
    if (!this.routes.has(method)) {
      this.routes.set(method, []);
    }

    const { pattern, validators } = this.convertPathToRegex(route.path);
    this.patterns.set(route.path, pattern);
    this.paramValidators.set(route.path, validators);
    this.routes.get(method)!.push(route);
  }
  private convertPathToRegex(path: string): { pattern: RegExp; validators: Map<string, RegExp> } {
    const validators = new Map<string, RegExp>();

    // Находим все параметры с валидаторами
    const paramMatches = path.match(/:[^/()]+\([^)]+\)/g) || [];
    paramMatches.forEach((paramMatch: string) => {
      const [paramName, pattern] = paramMatch.slice(1).split("(");
      const validator = new RegExp(`^${pattern.slice(0, -1)}$`);
      validators.set(paramName, validator);
    });

    // Заменяем параметры с валидаторами на их паттерны
    let pattern = path;
    paramMatches.forEach((paramMatch: string) => {
      const [_paramName, patternStr] = paramMatch.slice(1).split("(");
      const regexPattern = patternStr.slice(0, -1);
      pattern = pattern.replace(paramMatch, `(${regexPattern})`);
    });

    // Преобразуем оставшиеся параметры и экранируем слеши
    pattern = pattern.replace(/:[^/]+/g, "([^/]+)").replace(/\//g, "\\/");
    return {
      pattern: new RegExp(`^${pattern}$`),
      validators,
    };
  }

  match(
    method: HTTPMethods,
    path: string,
  ): { route: AomRoute; params: Record<string, string> } | null {
    const routes = this.routes.get(method.toLowerCase());
    if (!routes) return null;

    for (const route of routes) {
      const pattern = this.patterns.get(route.path)!;
      const validators = this.paramValidators.get(route.path)!;
      const match = path.match(pattern);

      if (match) {
        const params: Record<string, string> = {};
        const paramNames = route.path.match(/:[^/()]+/g) || [];

        paramNames.forEach((param: string, index: number) => {
          const paramName = param.slice(1);
          const value = match[index + 1];

          // Проверяем значение на соответствие валидатору, если он есть
          const validator = validators.get(paramName);
          if (validator && !validator.test(value)) {
            return null;
          }

          params[paramName] = value;
        });

        return { route, params };
      }
    }

    return null;
  }
}

export class Server {
  static routesAmount: number = 0;

  private routeMatcher: RouteMatcher;

  readonly server: http.Server;

  constructor(settings: AomServerSettings, root: Router, private i18nizer?: I18nizer) {
    this.routeMatcher = new RouteMatcher();

    if (i18nizer) {
      i18nizer.addLocalesStruct(locales);
    }

    root.routes.forEach((route: AomRoute) => {
      this.routeMatcher.addRoute(route);
      Server.routesAmount++;
    });

    root.sockets.forEach((route: AomRoute) => {
      this.routeMatcher.addRoute(route);
    });

    this.server = http.createServer(async (req, res) => {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,PUT,DELETE,OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");

      // Обработка preflight-запроса (OPTIONS)
      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }

      const url = new URL(path.join(settings.url, req.url || '/'));
      const match = this.routeMatcher.match(<HTTPMethods>req.method, url.pathname || "/");

      const query = structurizeValues(url.searchParams);
      const headers = definedValues(req.headers);



      // найдём текущую локаль
      let locale: string | undefined;
      if (this.i18nizer) {
        locale = this.i18nizer.defineLocale(headers, query)
      }

      const localize = (text: string): string => {
        if (locale && this.i18nizer) {
          return this.i18nizer.localize(text, locale);
        } else {
          return text;
        }
      }

      if (!match) {
        res.writeHead(404);
        res.end(JSON.stringify(new NotFoundResponse(messages.PATH_NOT_FOUND)));
        return;
      }

      try {
        const result = await match.route.apply({
          req,
          res,
          ctx: { req, res },
          body: await this.parseBody(req),
          headers,
          query,
          params: match.params,
          cookies: this.parseCookies(req),
          session: {},
          files: {},
        });

        if (typeof result === "string") {
          res.writeHead(200, { "Content-Type": "text/html" });
          res.end(localize(result));
        } else if (result instanceof Stream) {
          result.pipe(res);
        } else {
          let status = 200;
          if (result instanceof ErrorMessage) {
            status = result.status;
          } else if (result instanceof Error) {
            status = 500;
          }
          res.writeHead(status, { "Content-Type": "application/json" });
          res.end(localize(JSON.stringify(result)));
        }
      } catch (err: any) {
        console.error("Request error:", err);
        res.writeHead(err.status || 500, { "Content-Type": "application/json" });
        res.end(localize(JSON.stringify(err)));
      }
    });

    this.server.on("upgrade", async (req: http.IncomingMessage, socket, head) => {
      const url = new URL(req.url || "/", true);
      const match = this.routeMatcher.match("sockets", url.pathname || "/");

      const query = structurizeValues(url.searchParams);
      const headers = definedValues(req.headers);

      if (!match) {
        socket.destroy();
        return;
      }

      try {
        await match.route.apply({
          req,
          res: socket,
          ctx: { req, res: socket },
          body: head,
          query,
          headers,
          params: match.params,
          cookies: this.parseCookies(req),
          session: {},
          files: {},
        });
      } catch (err: any) {
        console.error("Request error:", err);
        socket.destroy();
      }
    });

    console.info("Server started:", settings);
    this.server.listen(settings.port);
  }


  private async parseBody(req: http.IncomingMessage): Promise<any> {
    return new Promise((resolve, reject) => {
      if (req.headers["content-type"] === "application/json") {
        let body = "";
        req.on("data", (chunk) => (body += chunk.toString()));
        req.on("end", () => {
          try {
            resolve(body ? JSON.parse(body) : {});
          } catch (e) {
            reject(new Error("Invalid JSON"));
          }
        });
        req.on("error", reject);
      } else {
        resolve({});
      }
    });
  }

  private parseCookies(req: http.IncomingMessage): Record<string, string> {
    const cookies: Record<string, string> = {};
    const cookieHeader = req.headers.cookie;

    if (cookieHeader) {
      cookieHeader.split(";").forEach((cookie) => {
        const [name, value] = cookie.trim().split("=");
        if (name && value) cookies[name] = value;
      });
    }

    return cookies;
  }
}
