import type { CombinedDecorator } from "@aom-js/core";
import { AomApi } from "../../common";

// The return type is annotated explicitly: without it, declaration emit can't name
// CombinedDecorator and fails with TS2883 (the type would arrive transitively from @aom-js/core).
/**
 * Sets the OpenAPI `summary` of an endpoint operation. On a class, also becomes the
 * default tag title for that class when used with `@UseTag`. There is no separate
 * `Summary` decorator — this is the one that fills that field.
 *
 * @param value - text for `summary` (and the tag title, on a class)
 * @returns a decorator usable on both a class and a method
 *
 * @example
 * ```ts
 * import { Controller, Get, Title, Description } from "@aom-js/router";
 *
 * @Controller()
 * class Orgs {
 *   @Get("/")
 *   @Title("List organizations")
 *   @Description("Returns every organization the current user has access to")
 *   static async index() {
 *     return [];
 *   }
 * }
 * ```
 */
export function Title(value: string): CombinedDecorator {
  return AomApi.combinedDecorator(($) => {
    $.title = value;
  });
}

/**
 * Sets the OpenAPI `description` of an endpoint operation.
 *
 * @param value - text for `description`
 * @returns a decorator usable on both a class and a method
 *
 * @example see {@link Title}
 */
export function Description(value: string): CombinedDecorator {
  return AomApi.combinedDecorator(($) => {
    $.description = value;
  });
}
