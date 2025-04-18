import { from, throwError } from "rxjs";
import { concatMap, catchError, takeWhile } from "rxjs/operators";

import { $aom } from "../../core";
import { ClassInstanceMap } from "../../common";
import { HTTPMethods, HttpContextValues } from "./types";

import {
  OpenApiParameterObject,
  OpenApiPathParameters,
  OpenApiRequestBody,
  OpenApiResponse,
  OpenApiSecuritySchema,
  TagsRules,
} from "./openapi";

export declare type ArgumentsHandlerParameters = { context: RxContext; cursor: AomCursor };

export declare type ArgumentsDecoratorHandler = (args: ArgumentsHandlerParameters) => any;

export declare type MarkerHandler = (cursor: AomCursor) => void | unknown;

export declare interface Bridge {
  prefix: string;
  next: AomHttp;
  $: AomHttp;
}

export declare interface Marker {
  marker: AomHttp;
  $: AomHttp;
}

export declare interface Endpoint {
  path: string;
  method: HTTPMethods;
  $: AomHttp;
}

class AomHttpOpenApiTags {
  tag: AomHttp;
  rule: TagsRules = TagsRules.REPLACE;
}

class AomHttpOpenApi {
  tags: AomHttpOpenApiTags = new AomHttpOpenApiTags();

  path: OpenApiPathParameters[] = [];

  responses: OpenApiResponse[] = [];

  requestBody: OpenApiRequestBody;

  parameters: OpenApiParameterObject[] = [];

  security: OpenApiSecuritySchema;
}

class AomHttpRoute {
  descriptor?: PropertyDescriptor;

  isController: boolean;

  isNextpoint: boolean;

  isMiddleware: boolean;

  isEndpoint: boolean;

  bridges: Bridge[] = [];

  markers: Marker[] = [];

  endpoints: Endpoint[] = [];

  parametersHandlers: ArgumentsDecoratorHandler[] = [];

  middlewares: AomHttp[] = [];

  nextpoint: AomHttp;
}

export class AomHttp extends $aom {
  openApi = new AomHttpOpenApi();

  route = new AomHttpRoute();

  title: string;

  description: string;
}

export class AomCursor {
  endpoint: Endpoint;

  $: AomHttp;

  constructor($: AomHttp, endpoint: Endpoint) {
    this.$ = $;
    this.endpoint = endpoint;
  }
}

export class AomRoute {
  endpoint: Endpoint;

  private cursors: AomCursor[] = [];

  constructor(endpoint: Endpoint, middlewares: AomHttp[]) {
    this.endpoint = endpoint;
    this.plain([...middlewares, endpoint.$]);
  }

  private plain(elements: AomHttp[]) {
    elements.forEach(($) => {
      // сначала загоним в качестве значений собственные миддлвари текущего курсора
      this.plain($.route.middlewares);
      // затем поместим сам курсор, который может быть как миддлварей так и
      this.cursors.push(new AomCursor($, this.endpoint));
      // если у текущего курсора есть nextpoint, то рекурсивно обработаем его, включив вероятные миддлвари и nextpoint-ы
      if ($.route.nextpoint) {
        this.plain([$.route.nextpoint]);
      }
    });
  }

  apply(context: HttpContextValues) {
    return new RxContext(context).run(this.cursors);
  }
}

class RxContext {
  values: HttpContextValues;

  state: ClassInstanceMap;
  //
  constructor(context: HttpContextValues) {
    this.values = context;

    this.state = new ClassInstanceMap();
  }

  run(cursors: AomCursor[]) {
    return new Promise((resolve, reject) => {
      from(cursors)
        .pipe(
          concatMap(async (cursor: AomCursor) => {
            try {
              const { $ } = cursor;
              const args = await Promise.all(
                $.route.parametersHandlers.map((parameterHandler) =>
                  Reflect.apply(parameterHandler, $._.target, [{ context: this, cursor }])
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
