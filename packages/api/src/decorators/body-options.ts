import { AomRoute, Controller, Marker, UseMarker } from "@aom-js/router";

import type { BodyParseOptions } from "../server";

/**
 * Route marker key under which the collected {@link BodyParseOptions} for a route is stored.
 * `Server` reads `route.markers[BODY_OPTIONS_MARKER]` when parsing the (lazy) request body.
 */
// route marker key - the collected BodyParseOptions for a specific route is stored under it;
// the server reads it (next step) when parsing the request body
export const BODY_OPTIONS_MARKER = "aom:bodyOptions";

/**
 * Method decorator: overrides the body size limit for a specific route. Can be placed on an
 * endpoint or on a middleware; markers apply in cursor order and the endpoint's cursor runs
 * last, so an endpoint's `\@BodyOptions` overrides whatever a middleware in the same chain set —
 * in either direction, up or down.
 *
 * The effective limit `Server` uses is resolved at the moment the body is actually read (the
 * first `\@Body` in the chain): this route's `\@BodyOptions`, then `AomServerSettings.bodyLimit`,
 * then the package default `DEFAULT_BODY_LIMIT` (1 MiB).
 *
 * @param options - `{ limit }` in bytes for this route; `0` disables the limit for it
 *
 * @example
 * ```ts
 * import { BodyOptions } from "@aom-js/api";
 * import { Controller, Post, Before, Body } from "@aom-js/router";
 *
 * \@Controller()
 * class ImportController {
 *   \@Post("/import")
 *   \@BodyOptions({ limit: 10 * 1024 * 1024 }) // this endpoint needs more than the default
 *   static async import(\@Body() body: unknown) {
 *     // ...
 *   }
 * }
 * ```
 */
export function BodyOptions(options: BodyParseOptions): MethodDecorator {
  // a local class with @Controller() is required - only it triggers the deferred-decorator
  // pass; without it, @Marker() on the method silently doesn't apply
  @Controller()
  class BodyOptionsMarker {
    @Marker()
    static Mark(route: AomRoute): void {
      route.markers[BODY_OPTIONS_MARKER] = { ...route.markers[BODY_OPTIONS_MARKER], ...options };
    }
  }

  return UseMarker(BodyOptionsMarker.Mark);
}
