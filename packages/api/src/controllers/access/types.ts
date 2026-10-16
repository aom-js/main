import { type HandlerFunction } from "@aom-js/router";
import { AomCore } from "@aom-js/core";
//
import { AccessTypes } from "./init";
//
/**
 * `AomCore` meta-class used to attach access metadata (allowed types, extra-access-layer flag,
 * extra middlewares) to methods via `BaseAccessController.AccessCore`. Applications subclass
 * this to plug their own `AomCore` registry into `BaseAccessController`.
 */
export class AomAccessCore extends AomCore {
  /** Whether the decorated method is an extra access layer (set by `BaseAccessController.SetExtraAccess`). */
  extraAccess!: boolean;

  /** Middlewares marked as extra access layers via `BaseAccessController.ExtraAccess`. */
  extraAccessMiddlewares: HandlerFunction[] = [];

  /** Access types required to reach the decorated method. */
  accessTypes: AccessTypes[] | string[] = [];
}

// the table is filled in as roles are parsed, keys arrive as strings - Partial, not a full Record
/** Access types granted for the current request; see `BaseAccessController.activeAccessTypes`. */
export type ActiveAccessTypes = Partial<Record<AccessTypes | string, boolean>>;

/** Route/cursor fields used to describe an access point's location (method, path or prefix). */
export type IAomAccessPoint = { prefix?: string; method?: string; path?: string };

/** Access map structure keyed by access point identifier, each entry listing its granted extra layers. */
export type AomAccessPlainStructure = Record<string, { extra?: string[] }>;

/**
 * The resolved access map for the current request: either full access, or a structure of
 * individually granted access point identifiers. Built by `BaseAccessController.generateAccessMap`
 * and read by `BaseAccessController.checkAccessPoint`.
 */
export class AomAccessMapStructure {
  /** When `true`, every access point is allowed regardless of `structure`. */
  fullAccess: boolean = false;

  /** Individually granted access points, keyed by identifier. */
  structure: AomAccessPlainStructure = {};
}
