/**
 * Rules over route chains that hold for any application: they read the router projection and
 * return violations as strings (or facts), so the application decides how to assert them.
 */
import { AomApi } from "../common/api";
import { resolveTarget, type AomCursor } from "../common/cursor";
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
