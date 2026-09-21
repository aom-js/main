import { After, Controller, Headers, Query, This, ThisRef, type RefFunction } from "@aom-js/router";
import { type OpenApiParameterObject, type OpenApiPathParameters } from "@aom-js/router";
import { Parameters, Params, PathParameters, DelayRefStack, Middleware } from "@aom-js/router";
//
import { MongoIDSchema, NanoIDSchema, NumberIDSchema, ParamIDSchema, UUIDSchema } from "./schemas";

type pathIn = "path" | "query" | "header";

const PathRefParams = ThisRef((<T extends typeof IDController>(constructor: T) => {
  return [PathParameters(constructor.param())];
}) as RefFunction);

const RefParams = (pathIn: pathIn) =>
  ThisRef((<T extends typeof IDController>(constructor: T) => {
    return [Parameters(constructor.JSONSchema(pathIn))];
  }) as RefFunction);

/**
 * Base controller for a single typed ID value that can live in the path, query, or a header,
 * validated against a `ParamIDSchema` pattern (regexp, length, format). Built by {@link IDValue}
 * — subclass through that factory (or the ready-made `UUIDParam`/`MongoIDParam`/`NanoIDParam`/
 * `NumberIDParam`) rather than extending `IDController` directly, since `attr`/`pattern` must be set.
 */
@Controller()
export class IDController {
  /** The extracted, typed ID value, populated by `Assign` after `PathID`/`QueryID`/`HeaderID` runs. */
  value: any;

  /** Raw source object (path params, query, or headers) the value was read from. */
  source: any;

  static readonly attr: string;

  static readonly pattern: ParamIDSchema;

  /**
   * Middleware: reads `attr` from the route's path parameters, registers it as a documented
   * `PathParameters` entry, and populates `value` via `PathValue`/`Assign`.
   */
  @Middleware()
  @DelayRefStack(PathRefParams)
  @After(IDController.PathValue)
  static async PathID() {}

  /** Middleware: same as `PathID`, but reads `attr` from the query string. */
  @Middleware()
  @DelayRefStack(RefParams("query"))
  @After(IDController.QueryValue)
  static async QueryID() {}

  /** Middleware: same as `PathID`, but reads `attr` from the request headers. */
  @Middleware()
  @DelayRefStack(RefParams("header"))
  @After(IDController.HeaderValue)
  static async HeaderID() {}

  @Middleware()
  @After(IDController.Assign)
  static async PathValue(@This() self: IDController, @Params() data: any) {
    self.source = { ...data };
  }

  @Middleware()
  @After(IDController.Assign)
  static async QueryValue(@This() self: IDController, @Query() data: any) {
    self.source = { ...data };
  }

  @Middleware()
  @After(IDController.Assign)
  static async HeaderValue(@This() self: IDController, @Headers() data: any) {
    self.source = { ...data };
  }

  @Middleware()
  static async Assign(@This() self: IDController) {
    self.value = self.source[this.attr];
  }

  /**
   * Renders this ID as a route path segment, e.g. `:orgId([0-9a-f-]{36})` for a `UUIDParam`.
   * Use it to build paths: `` `/orgs/${OrgID}` ``.
   */
  static toString(): string {
    return this.pattern.format(this.attr);
  }

  /** Describes this ID as an OpenAPI path parameters object, keyed by `toString()`. */
  static param(): OpenApiPathParameters {
    return {
      [this.toString()]: this.JSONSchema("path"),
    };
  }

  /** Describes this ID as a single OpenAPI parameter for the given location. */
  static JSONSchema(pathIn: pathIn): OpenApiParameterObject {
    return {
      name: this.attr,
      description: this.attr,
      schema: this.pattern.schema(),
      required: true,
      in: pathIn,
    };
  }
}

/**
 * Builds a typed ID parameter controller bound to a specific attribute name and format.
 *
 * @param attr - name of the path parameter / query key / header this ID reads from
 * @param IDPattern - `ParamIDSchema` subclass describing the expected format
 * @returns an `IDController` subclass with `attr`/`pattern` set
 *
 * @example
 * ```ts
 * import { IDValue, UUIDSchema } from "@aom-js/api";
 * import { Controller } from "@aom-js/router";
 *
 * \@Controller()
 * class OrgID extends IDValue("orgId", UUIDSchema) {}
 * ```
 */
export function IDValue<T extends typeof ParamIDSchema>(attr: string, IDPattern: T) {
  return class extends IDController {
    static readonly attr = attr;
    static pattern = new IDPattern();
  };
}

/**
 * Shortcut for `IDValue(attr, UUIDSchema)` — a UUID-formatted ID parameter.
 *
 * @example
 * ```ts
 * import { UUIDParam } from "@aom-js/api";
 * import { Controller, Get, Before, This } from "@aom-js/router";
 *
 * \@Controller()
 * class TicketID extends UUIDParam("ticketId") {}
 *
 * \@Controller()
 * class TicketsController {
 *   \@Get(`/tickets/${TicketID}`) // ":ticketId([0-9a-f-]{36})"
 *   \@Before(TicketID.PathID)
 *   static async get(\@This(TicketID) { value }: TicketID) {
 *     // value is the validated UUID string
 *   }
 * }
 * ```
 */
export function UUIDParam(attr: string): ReturnType<typeof IDValue<typeof UUIDSchema>> {
  return IDValue(attr, UUIDSchema);
}

/** Shortcut for `IDValue(attr, MongoIDSchema)` — a MongoDB `ObjectId`-formatted ID parameter. */
export function MongoIDParam(attr: string): ReturnType<typeof IDValue<typeof MongoIDSchema>> {
  return IDValue(attr, MongoIDSchema);
}

/** Shortcut for `IDValue(attr, NanoIDSchema)` — a NanoID-formatted (21-char) ID parameter. */
export function NanoIDParam(attr: string): ReturnType<typeof IDValue<typeof NanoIDSchema>> {
  return IDValue(attr, NanoIDSchema);
}

/** Shortcut for `IDValue(attr, NumberIDSchema)` — a numeric (up to 12 digits) ID parameter. */
export function NumberIDParam(attr: string): ReturnType<typeof IDValue<typeof NumberIDSchema>> {
  return IDValue(attr, NumberIDSchema);
}
