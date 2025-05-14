import { ClassInstanceMap, AomCore } from "@aom/core";
import { from, throwError } from "rxjs";
import { concatMap, catchError, takeWhile } from "rxjs/operators";

import { HTTPMethods } from "./types";

import {
  OpenApiParameterObject,
  OpenApiPathParameters,
  OpenApiRequestBody,
  OpenApiResponse,
  OpenApiSecuritySchema,
} from "./openapi";

import { HttpContextValues } from "../types";
import { FwdContainer, RouteRefContainer, ThisRefContainer } from "./references";

export enum TagsRules {
  IGNORE = "ignore",
  MERGE = "merge",
  REPLACE = "replace",
}

export declare type ArgumentsHandlerParameters = {
  context: RxContext;
  cursor: AomCursor;
  route: AomRoute;
};

export declare type ArgumentsDecoratorHandler = (args: ArgumentsHandlerParameters) => any;

export declare type MarkerHandler = (route: AomRoute, cursor: AomCursor) => void | unknown;

export declare interface AomBridge {
  prefix: string;
  next: AomHttp;
  $: AomHttp;
}

export declare interface AomMarker {
  marker: AomHttp;
  $: AomHttp;
}

export declare interface AomEndpoint {
  path: string;
  method: HTTPMethods;
  $: AomHttp;
}

class AomHttpOpenApiTags {
  $: AomHttp;
  rule: TagsRules;
}

class AomHttpOpenApi {
  tag: AomHttpOpenApiTags = new AomHttpOpenApiTags();

  path: OpenApiPathParameters[] = [];

  responses: OpenApiResponse[] = [];

  requestBody: OpenApiRequestBody;

  parameters: OpenApiParameterObject[] = [];

  security: OpenApiSecuritySchema;

  delayStack: Array<FwdContainer | RouteRefContainer | ThisRefContainer> = [];
}

class AomHttpRoute {
  descriptor?: PropertyDescriptor;

  isController: boolean;

  isNextpoint: boolean;

  isMiddleware: boolean;

  isEndpoint: boolean;

  bridges: AomBridge[] = [];

  markers: AomMarker[] = [];

  endpoints: AomEndpoint[] = [];

  parametersHandlers: ArgumentsDecoratorHandler[] = [];

  middlewares: AomHttp[] = [];

  nextpoint: AomHttp;
}

export class AomHttp extends AomCore {
  openApi = new AomHttpOpenApi();

  route = new AomHttpRoute();

  title: string;

  description: string;

  toString() {
    const { name } = this._.target;
    const property = this._.property;
    return [name, property].filter(Boolean).map(String).join(".");
  }
}

export class AomCursor {
  endpoint: AomEndpoint;

  prefix: string;

  index: number;

  $: AomHttp;

  constructor($: AomHttp, prefix: string, endpoint?: AomEndpoint) {
    this.$ = $;
    this.prefix = prefix;
    this.endpoint = endpoint;
  }

  setEndpoint(endpoint: AomEndpoint) {
    this.endpoint = endpoint;
    return this;
  }
}

export class AomRoute {
  endpoint: AomEndpoint;

  markers: Record<string, any> = {};

  cursors: AomCursor[] = [];

  constructor(endpoint: AomEndpoint, cursors: AomCursor[]) {
    this.endpoint = endpoint;

    this.plain([
      ...cursors.map((cursor) => cursor.setEndpoint(endpoint)),
      new AomCursor(endpoint.$, endpoint.path, endpoint),
    ]);

    // назначим индексы для курсоров
    this.cursors.forEach((cursor, index) => (cursor.index = index));
  }

  private plain(cursors: AomCursor[]) {
    cursors.forEach((cursor) => {
      // сначала загоним в качестве значений собственные миддлвари текущего курсора
      this.plain(
        cursor.$.route.middlewares.map(
          (middleware) => new AomCursor(middleware, cursor.prefix, cursor.endpoint)
        )
      );
      // затем поместим сам курсор, который может быть как миддлварей так и
      this.cursors.push(cursor);
      // если у текущего курсора есть nextpoint, то рекурсивно обработаем его, включив вероятные миддлвари и nextpoint-ы
      if (cursor.$.route.nextpoint) {
        this.plain([new AomCursor(cursor.$.route.nextpoint, cursor.prefix, cursor.endpoint)]);
      }
    });
  }

  apply(context: HttpContextValues) {
    return new RxContext(context, this).run(this.cursors);
  }
}

class RxContext {
  values: HttpContextValues;

  state: ClassInstanceMap;

  route: AomRoute;
  //
  constructor(context: HttpContextValues, route: AomRoute) {
    this.values = context;

    this.route = route;

    this.state = new ClassInstanceMap();
  }

  run(cursors: AomCursor[]) {
    const { route } = this;
    return new Promise((resolve, reject) => {
      from(cursors)
        .pipe(
          concatMap(async (cursor: AomCursor) => {
            try {
              const { $ } = cursor;
              const args = await Promise.all(
                $.route.parametersHandlers.map((parameterHandler) =>
                  Reflect.apply(parameterHandler, $._.target, [{ context: this, cursor, route }])
                )
              );

              const result = await Reflect.apply($.route.descriptor?.value, $._.target, args);

              // Если результат - ошибка, выбрасываем её
              if (result instanceof Error) {
                throw result;
              }

              return result;
            } catch (error) {
              throw error;
            }
          }),
          takeWhile((result) => result === undefined, true),
          catchError((error) => throwError(() => error))
        )
        .subscribe({
          next: (result) => {
            // Если результат не undefined, останавливаем выполнение и возвращаем результат
            if (result !== undefined) {
              resolve(result);
            }
          },
          error: (error) => reject(error),
          complete: () => resolve(undefined),
        });
    });
    //
  }
}
