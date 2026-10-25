import _ from "es-toolkit/compat";

import { type CombinedDecorator } from "@aom-js/core";
import {
  Before,
  This,
  type HandlerFunction,
  UseMarker,
  After,
  ThisRef,
  RefFunction,
  DelayRefStack,
} from "@aom-js/router";
import { AomRoute, AomApi, AomCursor, Marker, Cursor, Route } from "@aom-js/router";
import { Responses, Middleware, Controller } from "@aom-js/router";
//
import { messages } from "../../constants";
import { AccessDenyResponse } from "../../responses";
//

import type { ActiveAccessTypes, IAomAccessPoint } from "./types";
import { AomAccessCore, AomAccessMapStructure } from "./types";
import {
  AomAccessMarkerElement,
  AomAccessIdentElement,
  AomAccessToModulesStructure,
} from "./schemas";
import { AccessTypes } from "./init";

// ThisRef + DelayRefStack are used so the marker is correctly threaded through subclasses
const SafeAccessMarker = ThisRef((<T extends typeof BaseAccessController>(constructor: T) => [
  UseMarker(constructor.SetAccessMark),
]) as RefFunction);

/**
 * Access control built on route markers: every `\@Before`/method in a chain that is decorated
 * (directly or transitively) leaves a marker describing which access types can reach it; at
 * request time `Required` checks the caller's granted access map against that marker.
 *
 * Subclass once per application and set the four `static readonly` fields
 * (`MarkerName`/`AllowedAccessTypes`/`AccessMarker`/`AccessCore`) before using any of the
 * decorators below — they are abstract on the base class.
 *
 * @example
 * ```ts
 * import { BaseAccessController, AomAccessMarkerElement, AomAccessCore } from "@aom-js/api";
 * import { Controller, Before } from "@aom-js/router";
 *
 * enum PermissionsTypes { ADMIN = "admin", ORG = "org" }
 *
 * \@Controller()
 * class AccessController extends BaseAccessController {
 *   static readonly MarkerName = "app:access";
 *   static readonly AllowedAccessTypes = Object.values(PermissionsTypes);
 *   static readonly AccessMarker = AomAccessMarkerElement;
 *   static readonly AccessCore = AomAccessCore;
 * }
 *
 * \@Controller()
 * \@Before(AccessController.Init) // enable the check for this module
 * class OrdersController {
 *   \@Get("/orders")
 *   \@AccessController.TypesRequired(PermissionsTypes.ADMIN) // marks the endpoint, adds Required
 *   static async list() {
 *     // ...
 *   }
 * }
 * ```
 */
@Controller()
export class BaseAccessController {
  /** Key this application's access marker is stored under in `route.markers`. Must be overridden. */
  static readonly MarkerName: string;

  /** Full set of access types this application recognizes. Must be overridden. */
  static readonly AllowedAccessTypes: AccessTypes[] | string[];

  /** Component-schema class describing the marker shape (accumulated per route). Must be overridden. */
  static readonly AccessMarker: typeof AomAccessMarkerElement;

  /** Meta-class (`AomCore` subclass) used to attach access metadata to middlewares/endpoints. Must be overridden. */
  static readonly AccessCore: typeof AomAccessCore;

  /** Identifier of the module this controller instance is guarding; must be set by the application (e.g. by a step before the one that calls `generateAccessMap`); while unset, roles grant nothing but `fullAccess`. */
  moduleIdent!: string;

  accessMap!: AomAccessMapStructure; // access map

  /** Access types granted for the current request, keyed by type name. */
  activeAccessTypes: ActiveAccessTypes = {};

  /** Whether access checks are active for this request; `false` means `checkAccessPoint` always allows. Set by `Init`. */
  enabled!: boolean;

  // check whether access to the identifier at this route point is valid
  /**
   * Checks whether the current request is allowed to reach a given access point.
   *
   * Returns `true` immediately when checks aren't `enabled` (i.e. `Init` never ran for this
   * request). Otherwise, for each access type on `accessMarker` that is also currently active
   * (`activeAccessTypes`), access is granted if `accessMap.fullAccess` is set or `ident` appears
   * in `accessMap.structure`.
   *
   * @param ident - identifier of the route/middleware being checked (see `SetAccessMark`)
   * @param accessMarker - the marker accumulated for this point (`route.markers[MarkerName]`)
   * @returns whether the current caller may reach this point
   */
  checkAccessPoint(ident: string, accessMarker: AomAccessMarkerElement): boolean {
    // grab the user's existing access data
    const { accessMap, activeAccessTypes } = this;

    // if access control isn't active, access is always allowed
    // used for cases where access-controlled methods are reused, e.g. in an API meant only for users
    let isAllowed = !this.enabled;

    // checking access means checking for active permissions among the access types granted to
    // this access point, which must be present in the current set of allowed types
    const { accessTypes } = accessMarker;
    _.each(accessTypes, (accessType) => {
      const typeIsActive = activeAccessTypes[<string>accessType];
      // grant access if full access was allowed for the current access type, or the needed point
      // is present in the structure
      if (typeIsActive) {
        isAllowed = isAllowed || accessMap.fullAccess || !!accessMap.structure[ident];
      }
    });

    return isAllowed;
  }

  /**
   * Builds `accessMap`/`activeAccessTypes` for the current request from an application-resolved
   * set of granted access types and roles (typically called once per request, e.g. from an
   * application's own auth middleware, after loading the current user's roles).
   *
   * @param allowedAccessTypes - access types active for this request; each is set to `true` on `activeAccessTypes`
   * @param userRoles - roles to fold into `accessMap`; a role with `fullAccess` makes every check
   * pass, otherwise only entries for `this.moduleIdent` contribute to `accessMap.structure` (none
   * while `moduleIdent` is unset)
   */
  generateAccessMap(allowedAccessTypes: string[], userRoles: AomAccessToModulesStructure[]) {
    // set the allowed set from the passed-in values
    allowedAccessTypes.forEach((accessType) => {
      this.activeAccessTypes[accessType] = true;
    });

    // build the access map
    this.accessMap = new AomAccessMapStructure();

    // from the list of received roles, extract the types they belong to
    // and build full access maps according to those types
    userRoles.forEach((role) => {
      // mark that in the current context the user has full access
      this.accessMap.fullAccess = this.accessMap.fullAccess || role.fullAccess;
      // unfold `role.modulesAccess` into a shape compatible with `structure`
      this.accessMap.structure = _.merge(
        { ...this.accessMap.structure },
        {
          ..._.keyBy(
            _.reduce(
              role.modulesAccess,
              (result: AomAccessIdentElement[], value) =>
                // without a module there are no grants: a grant lacking `moduleIdent` must not match `undefined`
                result.concat(
                  this.moduleIdent && value.moduleIdent === this.moduleIdent ? value.elements : [],
                ),
              [],
            ),
            "ident",
          ),
        },
      );
    });
  }

  /**
   * Middleware: turns on access checking (`enabled = true`) for this request. Without it,
   * `checkAccessPoint` always allows access — useful for modules where access control isn't
   * enforced but the same controllers are reused.
   */
  @Middleware()
  static async Init(@This() self: BaseAccessController): Promise<void> {
    self.enabled = true;
  }

  /**
   * Method decorator: restricts an endpoint/middleware to the given access types and attaches
   * `Required` as a `\@Before` on it, so the restriction is actually enforced. The access types
   * accumulate as markers walk up the cursor chain (see `SetAccessMark`) and show up in
   * `BaseRootController.Index` via `markersToRoute`.
   *
   * @param accessTypes - one or more of `AllowedAccessTypes`
   * @throws {Error} when called with no types, or with a type outside `AllowedAccessTypes`
   */
  static TypesRequired(...accessTypes: typeof this.AllowedAccessTypes): CombinedDecorator {
    if (!accessTypes.length) {
      throw new Error(messages.CONTROLLERS_ACCESS_TYPES_REQUIRED);
    }

    const diff = _.difference(<string[]>accessTypes, <string[]>this.AllowedAccessTypes);
    if (diff.length) {
      throw new Error(`${messages.CONTROLLERS_ACCESS_TYPES_MISMATCH}: ${diff}`);
    }

    return this.AccessCore.combinedDecorator(($) => {
      $.accessTypes.push(...(accessTypes as never[]));
      const { target, property } = $._;
      Reflect.decorate([Before(this.Required) as MethodDecorator], target, property!);
    });
  }

  // check that the given function is an access layer
  private static IsExtraAccess(handler: HandlerFunction) {
    const handlerInstance = this.AccessCore.checkExists(handler);
    // const { constructor, property } = ; restoreReverseMetadata(handler);
    return handlerInstance && handlerInstance.extraAccess;
  }

  // mark a middleware as an access layer
  /**
   * Method decorator: marks a middleware as an "extra access layer" that `ExtraAccess` can
   * reference, and attaches `CheckLayerPass` as a `\@Before` on it so passing the layer is
   * recorded on `layerPassed`.
   *
   * @param accessTypes - one or more of `AllowedAccessTypes` that may grant this layer
   * @throws {Error} when a passed type is outside `AllowedAccessTypes`
   */
  static SetExtraAccess(...accessTypes: typeof this.AllowedAccessTypes): MethodDecorator {
    const diff = _.difference(<string[]>accessTypes, <string[]>this.AllowedAccessTypes);
    if (diff.length) {
      throw new Error(`${messages.CONTROLLERS_ACCESS_TYPES_MISMATCH}: ${diff}`);
    }

    return this.AccessCore.methodDecorator(($) => {
      $.extraAccess = true;
      $.accessTypes.push(...(accessTypes as never[]));
      const { target, property } = $._;
      Reflect.decorate([Before(this.CheckLayerPass) as MethodDecorator], target, property!);
    });
  }

  // flag indicating whether the most recently used layer was passed
  /** Whether the most recently checked `SetExtraAccess` layer was passed for this request. Set by `CheckLayerPass`. */
  layerPassed!: boolean;

  /**
   * Middleware attached by `SetExtraAccess` to every extra-access-layer middleware: figures out
   * which layer this cursor corresponds to, and sets `layerPassed` based on whether the current
   * `accessMap`/`activeAccessTypes` grant that specific layer.
   */
  @Middleware()
  static async CheckLayerPass(
    @Cursor() cursor: AomCursor,
    @Route() route: AomRoute,
    @This() self: BaseAccessController,
  ) {
    // a layer is considered passed if a role has full access without specifying a type
    const { accessMap, activeAccessTypes: permissions } = self;
    self.layerPassed = false; // self.accessMap.get(null)?.fullAccess;
    const { index } = cursor; // take the position for the current cursor, to unambiguously find its relevant origin
    // used so that, when constructs repeat, there's no "allowed here, not allowed there" bug
    // cursor.origin is the construct that acts as the layer; its ident needs to be checked in the
    // structure of the middleware the given access layers are attached to
    // open question: how to do this?!
    // for the current cursor (which is CheckLayerPass) find where it's attached - i.e. the access-layer construct
    const { target, property } = cursor.origin._;
    // then, among the cursors of the current route, find the nearest one matching the current access-layer
    const [extraCursor] = route.cursors.filter(
      (cursor) =>
        cursor.index > index && cursor.$._.target === target && cursor.$._.property === property,
    );
    // technically there can be several of them, and they may attach to different constructs
    // so iterate over all of them and record at least one layer pass
    // this said, the possible failure modes of this approach deserve a closer look
    if (extraCursor) {
      const extraIdent = extraCursor.$.toString();

      // and for it, take its attachment point and its identifier
      const originIdent = extraCursor.origin.toString();

      // find the current control point's info in the route data
      const routeAccessControl: AomAccessMarkerElement = route.markers[this.MarkerName];

      const accessPoint = routeAccessControl.accessPoints.find(
        (value) => value.ident === originIdent,
      );
      // access point not found in the route marker - the layer is considered not passed, no exception thrown
      if (!accessPoint) return;
      const { extra = [] } = accessPoint;

      // find among them the one that matches this extra-point
      const extraPoint = extra.find((value) => value.ident === extraIdent);
      // layer not found among extra-points - consider it not passed
      if (!extraPoint) return;
      const { accessTypes } = extraPoint;

      accessTypes.forEach((accessType) => {
        // if the current types are among those allowed for the organization
        const typeAllowed = permissions[accessType];
        if (typeAllowed) {
          // consider the extra layer passed if it has full access
          // or the extension list names this specific layer
          const extraIdentPassed =
            accessMap.fullAccess || !!accessMap.structure[originIdent]?.extra?.includes(extraIdent);
          self.layerPassed = self.layerPassed || extraIdentPassed;
        }
      });
    }
  }

  // use access layers
  /**
   * Method decorator: requires one or more `SetExtraAccess`-marked middlewares to be attached
   * as `\@Before` on the same endpoint/middleware, in addition to any `TypesRequired` check.
   *
   * @param middlewares - middlewares previously decorated with `SetExtraAccess`
   * @throws {Error} when called with no middlewares, or with one that isn't marked via `SetExtraAccess`
   */
  static ExtraAccess(...middlewares: HandlerFunction[]): CombinedDecorator {
    //

    // could be elaborated further here
    if (!middlewares.length) {
      throw new Error(messages.CONTROLLERS_ACCESS_MIDDLEWARES_REQUIRED);
    }

    // check that every middleware is a valid layer
    middlewares.forEach((middleware) => {
      if (!this.IsExtraAccess(middleware)) {
        const aomMiddleware = AomApi.instance(middleware);
        throw new Error(
          `${messages.CONTROLLERS_ACCESS_WRONG_MIDDLEWARE_ACCESS_LAYER}: ${aomMiddleware.toString()}`,
        );
      }
    });

    return this.AccessCore.combinedDecorator(($) => {
      //
      $.extraAccessMiddlewares.push(...middlewares);
      const { target, property } = $._;
      Reflect.decorate([Before(...middlewares) as MethodDecorator], target, property!);
    });
  }

  /**
   * Middleware: the actual access gate. Also registers `SetAccessMark` as a route marker (via
   * `\@DelayRefStack`) so every point this decorator reaches gets recorded on the route's access
   * marker, which is what `checkAccessPoint`/`BaseRootController.Index` read.
   *
   * @throws {AccessDenyResponse} 403, when `checkAccessPoint` denies access to this point
   */
  @Middleware()
  @DelayRefStack(SafeAccessMarker)
  @Responses(AccessDenyResponse.JSONSchema())
  static async Required(
    @This() self: BaseAccessController,
    @Cursor() cursor: AomCursor,
    @Route() route: AomRoute,
  ): Promise<void | Error> {
    // ...
    const cursorIsEndpoint = route.endpoint.$ === cursor.$;

    const markName = this.MarkerName;
    const origin = cursorIsEndpoint ? route.endpoint.$ : cursor.origin;

    const ident = origin.toString();

    if (!self.checkAccessPoint(ident, route.markers[markName])) {
      throw new AccessDenyResponse(messages.ERROR_ACCESS_DENY);
    }
  }

  // set the typical access, accounting for requirements of specific partnership types
  /**
   * Route marker attached wherever `Required` is used (directly or via `TypesRequired`):
   * accumulates one `AccessMarker` per route describing every access point reachable through it
   * — the data that `checkAccessPoint`/`Index.markersToRoute` read later. Internal machinery;
   * not meant to be called directly by application code.
   */
  @Marker()
  static SetAccessMark(route: AomRoute, cursor: AomCursor): void {
    const markName = this.MarkerName;

    let currentAccessControl: InstanceType<typeof this.AccessMarker>;
    if (!route.markers[markName]) {
      currentAccessControl = new this.AccessMarker();
    } else {
      currentAccessControl = route.markers[markName];
    }

    // what matters is the info from the cursor's "attachment" point
    const { target, property } = cursor.origin._;

    const extaAccessInstance = this.AccessCore.instance(target, property);

    // if no specific values are given, take them from the cursor's current value
    // this lets restrictions be set once at a higher level and later, for deeper elements, refined
    // just by adding @Before(AccessAdmin.Required)
    // also add the restriction for when the "admin only" flag is set
    const extraAccessTypes = extaAccessInstance.accessTypes.length
      ? extaAccessInstance.accessTypes
      : currentAccessControl.accessTypes;

    // if access types were already set earlier, a deeper level must not enrich the list, only
    // possibly narrow it down via the new values
    // ideally this should also warn that the incoming list contains invalid values
    const newAccessTypes = currentAccessControl.accessTypes.length
      ? _.intersection(<string[]>currentAccessControl.accessTypes, <string[]>extraAccessTypes)
      : extraAccessTypes;

    // if the new list ends up empty, carry over the old values, and ideally this should also warn
    // that a conflict occurred while resolving the values
    currentAccessControl.accessTypes = newAccessTypes.length
      ? newAccessTypes
      : currentAccessControl.accessTypes;

    const controlForEndpoint = cursor.origin === route.endpoint.$;
    // cursor.origin.constructor === route.constructor && cursor.origin.property === route.property;

    const dataElem = controlForEndpoint ? route.endpoint.$ : cursor.origin;

    const { prefix, method, path } = <IAomAccessPoint>(controlForEndpoint ? route : cursor);

    const ident = dataElem.toString();
    const title = dataElem.title || ident;
    const layersMiddlewares = extaAccessInstance.extraAccessMiddlewares;

    // build the list of extra layers that may be accessible
    const extra = layersMiddlewares.map((middleware) => {
      const httpInstance = AomApi.instance(middleware);
      const extraAccessInstance = this.AccessCore.instance(middleware);

      const ident = httpInstance.toString();
      const title = httpInstance.title || ident;

      const extraPermissionsTypes = extraAccessInstance.accessTypes;

      const accessTypes = currentAccessControl.accessTypes.length
        ? _.intersection(
            <string[]>currentAccessControl.accessTypes,
            <string[]>extraPermissionsTypes,
          )
        : extraPermissionsTypes;

      return { ident, title, accessTypes };
    });

    // check that this identifier isn't already in the requirements list
    const accessPoint = { ident, title, extra, method, path: path || prefix };
    if (
      !currentAccessControl.accessPoints.filter((value) => value.ident === accessPoint.ident).length
    ) {
      // and add it
      currentAccessControl.accessPoints.push(accessPoint);
    }
    // add the marker
    route.markers[markName] = currentAccessControl;
  }

  /** Returns the class name; used wherever the access controller needs a stable string identifier. */
  static toString(): string {
    return this.name;
  }
  // */
}
