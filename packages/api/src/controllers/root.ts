import fs from "node:fs";
import path from "node:path";
import { ComponentSchema, PropertySchema } from "@aom-js/schemer";
import { MarkerType, OpenAPIObject, RefFunction, Route } from "@aom-js/router";
import { Responses, This, Before, AomRoute, Nextpoint, ThisRef } from "@aom-js/router";
import { DelayRefStack, Title, Controller, Get, OpenApi } from "@aom-js/router";
//
import { messages } from "../constants";
import { AuthBasic } from "./auth";
import swagger from "./swagger";
//
import { CommonResponse } from "../responses";

const SafeOriginResponse = ThisRef((<T extends typeof BaseRootController>(constructor: T) => [
  Responses(constructor.RoutesStructure.JSONSchema()),
]) as RefFunction);

@ComponentSchema({ description: messages.CONTROLLERS_ROOT_ROUTE_ELEMENT_METHOD })
export class RouteElement extends CommonResponse {
  @PropertySchema.String({ description: messages.CONTROLLERS_ROOT_ROUTE_ELEMENT_METHOD })
  method!: string;

  @PropertySchema.String({ description: messages.CONTROLLERS_ROOT_ROUTE_ELEMENT_PATH })
  path!: string;

  @PropertySchema.String({ description: messages.CONTROLLERS_ROOT_ROUTE_ELEMENT_OPERATION_ID })
  operationId!: string;
}

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

@Controller()
export class BaseRootController {
  readonly ident!: string;

  static readonly RoutesStructure: typeof RoutesStructure<RouteElement>;

  readonly RouteElement: typeof RouteElement;

  protected static docsJSON: OpenAPIObject;

  readonly docs: OpenApi;

  // url!: string;

  // static current_build: string;

  // static server_ip: string = process.env.SERVER_IP;

  markersToRoute(_routeElement: InstanceType<typeof this.RouteElement>, _markers: MarkerType) {
    // move route.markers to routeElemet properties
    // throw error if not overloaded
    throw new Error(
      "`markersToRoute` for every `RootController` child must be overloaded with defined markers",
    );
  }

  constructor(..._args: any) {}

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

  @Get("/openapi.json")
  @Before(AuthBasic.Required)
  @Title(messages.CONTROLLERS_ROOT_OPENAPI_TITLE)
  @Responses({
    status: 200,
    description: messages.CONTROLLERS_ROOT_OPENAPI_RESPONSE,
    schema: { type: "string" },
  })
  static JSONDocs(@This() { docs }: BaseRootController) {
    // сохраним документацию в контексте класса, чтобы не генерировать ее заново при повторных вызовах
    // это валидно, потому что от RootRoute будут наследоваться
    if (!this.docsJSON) {
      this.docsJSON = docs.toJSON();
    }
    return this.docsJSON;
  }

  @Get("/swagger.html")
  @Before(AuthBasic.Required)
  @Title(messages.CONTROLLERS_ROOT_OPENAPI_UI_TITLE)
  @Responses({
    status: 200,
    description: messages.CONTROLLERS_ROOT_OPENAPI_UI_TITLE,
    schema: { type: "string" },
  })
  static Swagger(): string {
    return swagger.toString();
  }
}
