import fs from "node:fs";
import path from "node:path";
import { ComponentSchema, PropertySchema } from "@aom-js/schemer";
import { MarkerType, OpenAPIObject, RefFunction, Route } from "@aom-js/router";
import { Responses, This, Before, AomRoute, Nextpoint, ThisRef, Ctx } from "@aom-js/router";
import { DelayRefStack, Title, Controller, Get, OpenApi } from "@aom-js/router";
//
import { messages } from "../constants";
import { AuthBasic } from "./auth";
import swagger from "./swagger";
//
import { CommonResponse } from "../responses";
import { type HttpCtx } from "../types";

const SafeOriginResponse = ThisRef((<T extends typeof BaseRootController>(constructor: T) => [
  Responses(constructor.RoutesStructure.JSONSchema()),
]) as RefFunction);

/**
 * One route entry in `BaseRootController.Index`'s response: HTTP method, path, and operation id.
 * Extend it to add application-specific fields and override `markersToRoute` to fill them.
 */
@ComponentSchema({ description: messages.CONTROLLERS_ROOT_ROUTE_ELEMENT_METHOD })
export class RouteElement extends CommonResponse {
  @PropertySchema.String({ description: messages.CONTROLLERS_ROOT_ROUTE_ELEMENT_METHOD })
  method!: string;

  @PropertySchema.String({ description: messages.CONTROLLERS_ROOT_ROUTE_ELEMENT_PATH })
  path!: string;

  @PropertySchema.String({ description: messages.CONTROLLERS_ROOT_ROUTE_ELEMENT_OPERATION_ID })
  operationId!: string;
}

/** Response shape of `BaseRootController.Index`: the module's identifier plus its route list. */
@ComponentSchema({ description: messages.CONTROLLERS_ROOT_ROUTES_STRUCTURE })
export class RoutesStructure<RE extends RouteElement> extends CommonResponse {
  @PropertySchema.String({ description: messages.CONTROLLERS_ROOT_ROUTES_STRUCTURE_IDENT })
  ident: string;

  @PropertySchema.Type({
    value: () => RouteElement,
    isArray: true,
    isOptional: true,
    description: messages.CONTROLLERS_ROOT_ROUTES_STRUCTURE_ROUTES,
  })
  routes: RE[] = [];

  constructor(ident: string) {
    super();
    this.ident = ident;
    this.routes = [];
  }
}

/**
 * Root controller for an API module: lists its routes, and serves `/openapi.json` and
 * `/swagger.html`. Meant to be subclassed once per module, with `RoutesStructure`/`RouteElement`
 * overridden to carry application-specific data (e.g. access markers) and `markersToRoute`
 * implemented to fill it in.
 *
 * @example
 * ```ts
 * import { BaseRootController, RouteElement, RoutesStructure } from "@aom-js/api";
 * import { Controller, MarkerType } from "@aom-js/router";
 * import { ComponentSchema, PropertySchema } from "@aom-js/schemer";
 *
 * \@ComponentSchema()
 * class ModuleRouteElement extends RouteElement {
 *   \@PropertySchema.String({ isOptional: true })
 *   access?: string;
 * }
 *
 * \@ComponentSchema()
 * class ModuleRoutesStructure extends RoutesStructure<ModuleRouteElement> {}
 *
 * \@Controller()
 * export class ModuleRootController extends BaseRootController {
 *   static readonly RoutesStructure = ModuleRoutesStructure;
 *   readonly RouteElement = ModuleRouteElement;
 *
 *   markersToRoute(routeElement: ModuleRouteElement, markers: MarkerType): void {
 *     routeElement.access = markers["app:access"];
 *   }
 * }
 * ```
 */
@Controller()
export class BaseRootController {
  /** This controller's route identifier, used as `RoutesStructure.ident` by `Index`. */
  readonly ident!: string;

  /** Response class instantiated per request by `Index`; override with an application-specific subclass. */
  static readonly RoutesStructure: typeof RoutesStructure<RouteElement>;

  /** Element class instantiated per route by `Index`; override with an application-specific subclass. */
  readonly RouteElement: typeof RouteElement;

  /** Cache for `JSONDocs`, keyed by the class it was computed on (see `JSONDocs`). */
  protected static docsJSON: OpenAPIObject;

  /** The `OpenApi` document builder for this controller's router, used by `JSONDocs`. */
  readonly docs: OpenApi;

  // url!: string;

  // static current_build: string;

  // static server_ip: string = process.env.SERVER_IP;

  /**
   * Copies data from a route's markers onto its `RouteElement`. The base implementation always
   * throws — every subclass must override it with whatever markers it wants to surface (e.g.
   * access requirements) in `Index`'s response.
   *
   * @throws {Error} always, unless overridden
   */
  markersToRoute(_routeElement: InstanceType<typeof this.RouteElement>, _markers: MarkerType) {
    // move route.markers to routeElemet properties
    // throw error if not overloaded
    throw new Error(
      "`markersToRoute` for every `RootController` child must be overloaded with defined markers",
    );
  }

  constructor(..._args: any) {}

  /**
   * `GET` endpoint (and `\@Nextpoint`, so subclasses can extend it): lists every route registered
   * on this controller's router as `RoutesStructure`, running `markersToRoute` on each one.
   */
  @Get()
  @Nextpoint()
  @Title(messages.CONTROLLERS_ROOT_ROUTES_LIST)
  @DelayRefStack(SafeOriginResponse)
  static Index<RE extends RouteElement, RS extends RoutesStructure<RE>>(
    @This() self: BaseRootController,
    @Route() route: AomRoute,
  ): RS {
    const { routes } = route.router;
    const { ident } = self;
    const result = new this.RoutesStructure(ident);
    routes.forEach((route) => {
      const { method, path } = route;
      const routeElement = new self.RouteElement();
      routeElement.method = method;
      routeElement.path = path;
      routeElement.operationId = route.endpoint.$.toString();
      self.markersToRoute(routeElement, route.markers);
      result.routes.push(routeElement);
    });
    return result as RS;
  }

  /**
   * `GET /openapi.json`, protected by `AuthBasic.Required`. Serializes `docs` to an OpenAPI
   * document on first call and caches it on `static docsJSON` for the concrete subclass, so
   * repeated requests don't rebuild it.
   */
  @Get("/openapi.json")
  @Before(AuthBasic.Required)
  @Title(messages.CONTROLLERS_ROOT_OPENAPI_TITLE)
  @Responses({
    status: 200,
    description: messages.CONTROLLERS_ROOT_OPENAPI_RESPONSE,
    schema: { type: "string" },
  })
  static JSONDocs(@This() { docs }: BaseRootController) {
    // cache the docs on the class so they aren't regenerated on repeated calls
    // this is valid because subclasses will inherit from RootRoute
    if (!this.docsJSON) {
      this.docsJSON = docs.toJSON();
    }
    return this.docsJSON;
  }

  /**
   * `GET /swagger.html`, protected by `AuthBasic.Required`. Returns the Swagger UI page, which
   * loads its assets from `unpkg.com` and points itself at `/openapi.json` on the same host.
   *
   * Sets `Content-Type: text/html` itself before returning the string, because a string result
   * defaults to `text/plain` otherwise (see `Server`).
   */
  @Get("/swagger.html")
  @Before(AuthBasic.Required)
  @Title(messages.CONTROLLERS_ROOT_OPENAPI_UI_TITLE)
  @Responses({
    status: 200,
    description: messages.CONTROLLERS_ROOT_OPENAPI_UI_TITLE,
    schema: { type: "string" },
  })
  static Swagger(@Ctx() ctx: HttpCtx): string {
    // a string defaults to text/plain (KI-API-17) - for a real HTML page we set the type
    // explicitly, before return
    ctx.res.setHeader("Content-Type", "text/html; charset=utf-8");
    return swagger.toString();
  }
}
