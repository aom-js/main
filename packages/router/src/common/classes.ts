import { ClassInstanceMap, AomCore, ClassConstructor } from "@aom-js/core";
import { resolve, join } from "node:path";
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
import { Router } from "../classes";

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

export declare type MarkerType = Record<string, any>;

export declare type MarkerHandler = (route: AomRoute, cursor: AomCursor) => void | unknown;

export declare interface AomBridge {
  prefix: string;
  next: AomApi;
  $: AomApi;
}

// export declare interface AomMarker {
//   marker: AomApi;
//   $: AomApi;
// }

export declare interface AomEndpoint {
  prefix: string;
  method: HTTPMethods;
  $: AomApi;
}

class AomHttpOpenApiTags {
  $!: AomApi;
  rule!: TagsRules;
}

class AomHttpOpenApi {
  tag: AomHttpOpenApiTags = new AomHttpOpenApiTags();

  path: OpenApiPathParameters[] = [];

  responses: OpenApiResponse[] = [];

  requestBody?: OpenApiRequestBody;

  parameters: OpenApiParameterObject[] = [];

  security?: OpenApiSecuritySchema;

  // delayStack: Array<FwdContainer | RouteRefContainer | ThisRefContainer> = [];

  private http!: AomApi;

  constructor(http: AomApi) {
    this.http = http;
  }
}

class AomHttpParameters {
  handlers: ArgumentsDecoratorHandler[] = [];

  private api: AomApi;

  constructor(api: AomApi) {
    this.api = api;
  }

  apply(args: ArgumentsHandlerParameters) {
    return this.handlers.map((parameterHandler) =>
      Reflect.apply(parameterHandler, this.api._.target, [args]),
    );
  }
}

class AomApiElement {
  descriptor!: PropertyDescriptor;

  isController?: boolean;

  isMarker?: boolean;

  isNextpoint?: boolean;

  isMiddleware?: boolean;

  isInstance?: boolean;

  isEndpoint?: boolean;

  isWebsocket?: boolean;

  bridges: AomBridge[] = [];

  markers: AomApi[] = [];

  instanceHooks: AomApi[] = [];

  endpoints: AomEndpoint[] = [];

  websockets: AomEndpoint[] = [];

  parametersHandlers: ArgumentsDecoratorHandler[] = [];

  parameters: AomHttpParameters;

  pre_middlewares: AomApi[] = [];

  post_middlewares: AomApi[] = [];

  nextpoint?: AomApi;

  private api: AomApi;

  constructor(api: AomApi) {
    this.api = api;
    this.parameters = new AomHttpParameters(api);
  }

  addPreMiddlewares(...middlewares: AomApi[]) {
    this.pre_middlewares.push(...middlewares);
  }

  addPostMiddlewares(...middlewares: AomApi[]) {
    this.post_middlewares.push(...middlewares);
  }

  addNextpoint(nextpoint: AomApi) {
    this.nextpoint = nextpoint;
  }
}

export class AomApi extends AomCore {
  openApi = new AomHttpOpenApi(this);

  element = new AomApiElement(this);

  delayStack: Array<FwdContainer | RouteRefContainer | ThisRefContainer> = [];

  title?: string;

  description?: string;

  toString() {
    const { name } = this._.target;
    const property = this._.property;
    return [name, property].filter(Boolean).map(String).join(".");
  }

  static async instanceWithHooks(target: ClassConstructor, args: ArgumentsHandlerParameters) {
    const { context, cursor } = args;

    const $target = AomApi.instance(target);
    const instanceArgs = await Promise.all($target.element.parameters.apply(args));
    const instance = Reflect.construct(target, instanceArgs);

    // зафиксируем его в переданном контексте
    context.state.set(target, instance);

    // используем механику, аналогичную процедуре run, только в качестве источника
    // курсоров используем список instanceHooks
    const { prefix, endpoint } = cursor;

    // асинхронно запустим все хуки (порядок должен быть не важен)
    await Promise.all(
      $target.element.instanceHooks.map(($) => {
        const nextCursor = new AomCursor($, cursor.$, prefix, endpoint);
        return context.run([nextCursor]);
      }),
    );
    return instance;
  }
}

export class AomCursor {
  // применяемый ендпоинт
  endpoint?: AomEndpoint;

  // место применения курсора
  origin: AomApi;

  // префикс пути
  prefix: string;

  // порядковый номер
  index!: number;

  // собственный api инстанс курсора
  $: AomApi;

  constructor($: AomApi, origin: AomApi, prefix: string, endpoint?: AomEndpoint) {
    // если $ ссылается на родительский класс относительно места сцепки —
    // перепривяжемся к инстансу потомка до реализации отложенного стека
    if ($._.property && origin._.target.prototype instanceof $._.target) {
      $ = $._.base.instance(origin._.target, $._.property);
    }

    this.$ = $;
    this.origin = origin;
    this.prefix = prefix;
    this.endpoint = endpoint;
    this.index = 0;

    this.realizeDelay();
  }

  private realizeDelay() {
    const { $ } = this;

    const { target, property } = $._;
    // такая процедура используется для того, чтобы на одном и том же курсоре не вызывать повторно отложенный стек
    // то есть в изолированном контексте он вызывается однократно, а затем удаляется из очереди
    if ($.delayStack.length) {
      while ($.delayStack.length) {
        const handler = $.delayStack.shift();
        // вызовем отложенные действия
        if (handler instanceof FwdContainer) {
          Reflect.decorate([...handler.exec()], target, property!);
        } else if (handler instanceof ThisRefContainer) {
          Reflect.decorate([...handler.exec(this.$._.target)], target, property!);
        } else if (handler instanceof RouteRefContainer) {
          Reflect.decorate([...handler.exec(this.endpoint!.$._.target)], target, property!);
        }
      }
      // применим вероятные отложенные вызовы
      $._.apply();
    }
  }
}

export class AomRoute {
  router: Router;

  endpoint: AomEndpoint;

  path: string;

  method: HTTPMethods;

  markers: MarkerType = {};

  cursors: AomCursor[] = [];

  constructor(router: Router, prefix: string, endpoint: AomEndpoint, cursors: AomCursor[]) {
    //
    this.router = router;

    this.path = resolve(join(prefix, endpoint.prefix));

    this.method = endpoint.method;

    this.endpoint = endpoint;

    this.plain([
      ...cursors.map((cursor) => {
        cursor.endpoint = endpoint;
        return cursor;
      }),
      new AomCursor(endpoint.$, endpoint.$, this.path, endpoint), // сам ендпоинт тоже является курсором
    ]);

    // назначим индексы для курсоров
    this.cursors.forEach((cursor, index) => {
      // применим маркеры в контексте того класса, где они объявлены
      cursor.$.element.markers.forEach((marker) => {
        Reflect.apply(marker.element.descriptor.value, marker._.target, [this, cursor]);
      });

      cursor.index = index;
    });
  }

  private plain(cursors: AomCursor[]) {
    cursors.forEach((cursor) => {
      // если текущий применяет курсор использует контекст, который тянется из его собственного
      // родительского класса то есть сработало наследование, но перенос контекста не состоялся
      if (cursor.origin._.target.prototype instanceof cursor.$._.target) {
        // то заменим в текущем курсоре его основание из контекста собственного класса места сцепки
        cursor.$ = cursor.$._.base.instance(cursor.origin._.target, cursor.$._.property);
      }

      // сначала загоним в качестве значений собственные миддлвари текущего курсора
      this.plain(
        cursor.$.element.pre_middlewares.map(
          (middleware) => new AomCursor(middleware, cursor.$, cursor.prefix, cursor.endpoint),
        ),
      );

      // затем поместим сам курсор, который может быть как миддлварей так и
      this.cursors.push(cursor);

      this.plain(
        cursor.$.element.post_middlewares.map(
          (middleware) => new AomCursor(middleware, cursor.$, cursor.prefix, cursor.endpoint),
        ),
      );

      // если у текущего курсора есть nextpoint, то рекурсивно обработаем его, включив вероятные миддлвари и nextpoint-ы
      if (cursor.$.element.nextpoint) {
        this.plain([
          new AomCursor(cursor.$.element.nextpoint, cursor.$, cursor.prefix, cursor.endpoint),
        ]);
      }
    });
  }

  apply(context: HttpContextValues): any {
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

  run(cursors: AomCursor[]): any {
    const { route } = this;
    return new Promise((resolve, reject) => {
      from(cursors)
        .pipe(
          concatMap(async (cursor: AomCursor) => {
            try {
              const { $ } = cursor;
              // на уровне каждого курсора проверим, что для него есть существуюший инстанс в state
              // и создадим его, если его нет (работает в том числе с учетом декорированных constructor)
              const { target } = $._;
              if (!this.state.get(target)) {
                // создадим инстанс с учетом вероятных хуков
                await AomApi.instanceWithHooks(target, { context: this, cursor, route });
              }
              const args = await Promise.all(
                $.element.parameters.apply({ context: this, cursor, route }),
              );

              const result = await Reflect.apply(
                $.element.descriptor?.value || new Function(),
                target,
                args,
              );

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
          catchError((error) => throwError(() => error)),
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
