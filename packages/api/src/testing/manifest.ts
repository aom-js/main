import {
  AomCursorKind,
  type AomCursor,
  type AomCursorJSON,
  type AomRoute,
  type AomRouteJSON,
  type Router,
} from "@aom-js/router";
import { parentsOf } from "@aom-js/router/testing";
import { BaseAccessController, IDController } from "../controllers";
import { bodyBuilderBase } from "../builders/body";
import { cookieBuilderBase } from "../builders/cookie";
import { headersBuilderBase } from "../builders/headers";
import { paramsBuilderBase } from "../builders/params";
import { queryStringBuilderBase } from "../builders/query-string";

/** Options of the step kind and of the dump. */
export interface ManifestOptions {
  /** Kind by the application's own classes; `undefined` — the core rules decide. */
  kindOf?: (cursor: AomCursor) => AomCursorKind | undefined;
}

/** A class constructor, abstract included. */
type Class = abstract new (...args: never[]) => unknown;

/** Classes whose own steps (`Query`, `Body`, `PathID`, …) read request input. */
const inputBases: Class[] = [
  bodyBuilderBase,
  queryStringBuilderBase,
  headersBuilderBase,
  cookieBuilderBase,
  paramsBuilderBase,
  IDController,
];

const inFamily = (target: Class, base: Class) => target === base || target.prototype instanceof base;

// a step of the base itself (inherited `Query`/`Body`), not the subclass's own method (a filter, not an input)
const inheritedFrom = (target: Class, property: PropertyKey | undefined) =>
  property !== undefined && inputBases.some((base) => inFamily(target, base) && Reflect.has(base, property));

/**
 * Kind of a step: declared `@CursorKind`, the endpoint (Handler), the application's `options.kindOf`,
 * then the core rules by what the class is: access gate, input builder, empty class-level step; else Step.
 */
export function kindOf(cursor: AomCursor, options: ManifestOptions = {}): AomCursorKind {
  const { $, origin, endpoint } = cursor;
  const target = $._.target as Class;
  const { element } = $;
  if (element.cursorKind) return element.cursorKind;
  if ($ === endpoint?.$) return AomCursorKind.Handler;
  const own = options.kindOf?.(cursor);
  if (own) return own;
  if (inFamily(target, BaseAccessController)) return AomCursorKind.Checkpoint;
  if (inheritedFrom(target, $._.property)) return AomCursorKind.Input;
  // empty class-level step (`Setup`, also with `@UseTag`): own step on the class level, no
  // parameters and no attachments of its own
  const empty =
    origin._.property === undefined &&
    origin._.target === target &&
    !element.parameters.handlers.length &&
    !element.pre_middlewares.length &&
    !element.post_middlewares.length &&
    !element.nextpoint;
  return empty ? AomCursorKind.Meta : AomCursorKind.Step;
}

/** A step of the enriched projection: every step has a kind and the index of its parent (`-1` for a top step). */
export type DescribedStep = AomCursorJSON & { kind: AomCursorKind; parent: number };
/** A route of the enriched projection. */
export type DescribedRoute = Omit<AomRouteJSON, "steps"> & { steps: DescribedStep[] };

/** Route projection (`route.toJSON()`) with the kind and the parent of every step. */
export function describe(route: AomRoute, options?: ManifestOptions): DescribedRoute {
  const json = route.toJSON();
  const parents = parentsOf(route.cursors);
  return {
    ...json,
    // parent and kind go right after the step's place, at the same position for all steps: the dump reads
    // and diffs line by line; the other core fields pass through rest in the core's order, so a new one is not lost
    steps: json.steps.map(({ i, step, origin, via, viaGroup, kind: _, ...rest }) => ({
      i,
      step,
      origin,
      via,
      ...(viaGroup ? { viaGroup } : {}),
      parent: parents[i],
      kind: kindOf(route.cursors[i], options),
      ...rest,
    })),
  };
}

/** Enriched router projection; routes are in the order of `Router.toJSON` (by `method path`). */
export function describeRouter(router: Router, options?: ManifestOptions): { version: 1; routes: DescribedRoute[] } {
  const key = ({ method, path }: AomRoute) => `${method} ${path}`;
  const routes = [...router.routes].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
  return { version: 1, routes: routes.map((route) => describe(route, options)) };
}

/** Dump text: JSON with indent 2 and a trailing newline. */
export const manifestOf = (router: Router, options?: ManifestOptions): string =>
  `${JSON.stringify(describeRouter(router, options), null, 2)}\n`;
