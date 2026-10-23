/**
 * Rules over route chains that hold for any application: they read the router projection and
 * return violations as strings (or facts), so the application decides how to assert them.
 */
import { AomApi } from "../common/api";
import { resolveTarget, type AomCursor } from "../common/cursor";
import type { AomCursorKind } from "../common/kinds";
import type { AomRoute } from "../common/route";
import type { Router } from "../classes";
import { ThisRef } from "../specials";

/** A route in a message: method and path without the regexps of path parameters. */
export const routeName = ({ method, path }: { method: string; path: string }): string =>
  `${method} ${path.replace(/\([^)]*\)/g, "")}`;

/**
 * Where each cursor of a route is attached — the index of its parent, by identity: `before` is
 * attached to the nearest next cursor with `$ === origin`, `after`/`next` to the nearest previous
 * one; top cursors (`class-before`, `class-after`, `endpoint`) get `-1`.
 */
export function parentsOf(cursors: AomCursor[]): number[] {
  return cursors.map((cursor, j) => {
    if (cursor.via === "before") return cursors.findIndex((other, k) => k > j && other.$ === cursor.origin);
    if (cursor.via === "after" || cursor.via === "next") return cursors.findLastIndex((other, k) => k < j && other.$ === cursor.origin);
    return -1;
  });
}

/** P1: endpoints that serve more than one route of the router. */
export function sharedEndpoints(router: Router): string[] {
  const places = new Map<unknown, string[]>();
  router.routes.forEach(({ endpoint, method, path }) =>
    places.set(endpoint.$, [...(places.get(endpoint.$) ?? []), `${method} ${path}`]),
  );
  return [...places]
    .filter(([, list]) => list.length > 1)
    .map(([$, list]) => `endpoint ${String($)} serves ${list.length} routes: ${list.sort().join(", ")}`);
}

/**
 * P2: `ident`s of the router's access points and the elements they come from. An `ident` is
 * `String(origin)` of the cursor (for the endpoint itself — `String(endpoint.$)`); only cursors
 * with a marker count, and only when their `ident` is among the `accessPoints` of the route markers.
 */
export function accessIdents(router: Router): Map<string, Set<unknown>> {
  const sources = new Map<string, Set<unknown>>();
  router.routes.forEach((route) => {
    const points = new Set(Object.values(route.toJSON().markers).flatMap(({ accessPoints }) => accessPoints));
    // only a cursor with a marker records an access point; a namesake without one is not a source
    route.cursors.forEach((cursor) => {
      if (!cursor.$.element.markers.length) return;
      const source = cursor.origin === route.endpoint.$ ? route.endpoint.$ : cursor.origin;
      const ident = String(source);
      if (points.has(ident)) sources.set(ident, (sources.get(ident) ?? new Set()).add(source));
    });
  });
  return sources;
}

/** P2: one `ident` for several different access points (grants are stored as strings). */
export const identCollisions = (router: Router): string[] =>
  [...accessIdents(router)]
    .filter(([, sources]) => sources.size > 1)
    .map(
      ([ident, sources]) =>
        `ident "${ident}" is shared by ${sources.size} different access points — grants are stored as strings, a match would grant access to a foreign point`,
    );

/** P7: the router must serialize (`JSON.stringify(router)`): an unresolvable reference throws. */
export function serializationErrors(router: Router): string[] {
  try {
    JSON.stringify(router);
    return [];
  } catch (error) {
    return [`router does not serialize: ${(error as Error).message}`];
  }
}

/**
 * P8: constructors of classes created in routes (step classes, `@This` targets and, recursively,
 * `@This` targets of their constructors) and the parameters with `ThisRef` or `@This()` without an
 * argument: such a parameter is resolved from the cursor that created the class first, so its
 * target depends on the order.
 */
export function constructorThisRefs(router: Router): { inspected: number; found: string[] } {
  const ThisRefContainer = ThisRef().constructor;
  const inspected = new Set<object>();
  const found: string[] = [];
  const visit = (target: unknown, cursor: AomCursor) => {
    if (typeof target !== "function" || inspected.has(target)) return;
    inspected.add(target);
    (AomApi.checkExists(target)?.element.parameters.descriptors ?? []).forEach((descriptor, index) => {
      if (descriptor.ref instanceof ThisRefContainer) {
        found.push(`${target.name}: constructor parameter ${index} — ThisRef, the target depends on the cursor that created the class first`);
      } else if (descriptor.kind === "this" && descriptor.ref === undefined) {
        found.push(`${target.name}: constructor parameter ${index} — @This() without an argument, the target depends on the cursor that created the class first`);
      } else if (descriptor.kind === "this") {
        visit(resolveTarget(descriptor.ref, cursor), cursor);
      }
    });
  };
  router.routes.forEach((route) =>
    route.cursors.forEach((cursor) => {
      visit(cursor.$._.target, cursor);
      cursor.parameters().forEach(({ kind, target }) => kind === "this" && visit(target, cursor));
    }),
  );
  return { inspected: inspected.size, found };
}

/** What the application decides about a step for the repeat rule: its kind and whether it writes. */
export interface RepeatOptions {
  kindOf: (cursor: AomCursor) => AomCursorKind;
  writes: (cursor: AomCursor) => boolean;
  /** Kinds whose repeat is harmless. */
  harmless: AomCursorKind[];
}

export type RepeatBranch = "kind" | "next-group" | "after-handler";

/** A step met again in a route: `i` is the new occurrence, `earlier` the previous ones; no `branch` — not explained. */
export interface Repeat {
  step: AomCursor["$"]["_"];
  i: number;
  earlier: number[];
  branch?: RepeatBranch;
}

const same = (a: AomCursor["$"]["_"], b: AomCursor["$"]["_"]) => a.target === b.target && a.property === b.property;

/**
 * P6: repeats of a step in a route (the same `$._` earlier in the chain) and the branch that explains
 * each: (1) a harmless kind; (2) every earlier occurrence is in another `@Next` group (the group is
 * the `viaGroup` of the nearest ancestor with `via === "next"`); (3) the repeat is after the handler
 * and the step does not write. No branch — the repeat is not explained.
 */
export function repeatsOf(route: AomRoute, { kindOf, writes, harmless }: RepeatOptions): Repeat[] {
  const { cursors } = route;
  const handler = cursors.findIndex((cursor) => cursor.$ === route.endpoint.$);
  const parent = parentsOf(cursors);
  const groupOf = (j: number) => {
    for (let k = j; k >= 0; k = parent[k]) if (cursors[k].via === "next") return cursors[k].viaGroup;
    return undefined;
  };
  return cursors.flatMap((cursor, i): Repeat[] => {
    const earlier = cursors.slice(0, i).flatMap((other, j) => (same(other.$._, cursor.$._) ? [j] : []));
    if (!earlier.length) return [];
    const branch: RepeatBranch | undefined = harmless.includes(kindOf(cursor))
      ? "kind"
      : earlier.every((j) => groupOf(j) !== groupOf(i))
        ? "next-group"
        : i > handler && !writes(cursor)
          ? "after-handler"
          : undefined;
    return [{ step: cursor.$._, i, earlier, branch }];
  });
}
