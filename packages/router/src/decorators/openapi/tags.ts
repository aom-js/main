import { ClassType } from "@aom-js/core";
import { AomApi, TagsRules } from "../../common";

/**
 * Sets the OpenAPI tag for an endpoint operation to `constructor`'s `@Title` (or its
 * class name if no `@Title` is set). Must be used on a **method**, not a class — a
 * class-level `@UseTag` is a type error at the TypeScript level (the decorator's
 * return type only fits `MethodDecorator`).
 *
 * How it combines with tags from other cursors of the same route is controlled by the
 * active `TagsRules` — see `@ReplaceNextTags`/`@MergeNextTags`/`@IgnoreNextTags`.
 *
 * @param constructor - class whose title (or name) becomes the tag
 * @returns a method decorator
 *
 * @example
 * ```ts
 * import { Controller, Get, Title, UseTag } from "@aom-js/router";
 *
 * @Title("Catalog")
 * class Catalog {}
 *
 * @Controller()
 * class Items {
 *   @Get("/items")
 *   @UseTag(Catalog) // operation tagged "Catalog"
 *   static async list() {
 *     return [];
 *   }
 * }
 * ```
 */
export function UseTag(constructor: ClassType) {
  return AomApi.methodDecorator(($) => {
    $.openApi.tag.$ = AomApi.instance(constructor);
  });
}

/**
 * From this cursor onward (until changed again), a tag set by `@UseTag` on a later
 * cursor of the same route is dropped instead of being added to the operation's tags.
 *
 * @returns a method decorator
 *
 * @example see {@link UseTag}; add `@IgnoreNextTags()` on a cursor that runs after the
 * one carrying `@UseTag` to drop tags from cursors beyond it.
 */
export function IgnoreNextTags() {
  return AomApi.methodDecorator(($) => {
    $.openApi.tag.rule = TagsRules.IGNORE;
  });
}

/**
 * From this cursor onward (until changed again), a tag set by `@UseTag` on a later
 * cursor is appended to the running tag list instead of replacing it, producing a
 * joined tag name like `"Section > Tag"` (`OpenApi.tagsSeparator`).
 *
 * @returns a method decorator
 *
 * @example
 * ```ts
 * import { Controller, Get, Title, UseTag, MergeNextTags } from "@aom-js/router";
 *
 * @Title("Section")
 * class SectionTag {}
 *
 * @Title("Items")
 * class ItemsTag {}
 *
 * @Controller()
 * @UseTag(SectionTag)
 * class Items {
 *   @Get("/items")
 *   @UseTag(ItemsTag)
 *   @MergeNextTags() // tag becomes "Section > Items" instead of just "Items"
 *   static async list() {
 *     return [];
 *   }
 * }
 * ```
 */
export function MergeNextTags() {
  return AomApi.methodDecorator(($) => {
    $.openApi.tag.rule = TagsRules.MERGE;
  });
}

/**
 * From this cursor onward (until changed again), a tag set by `@UseTag` on a later
 * cursor replaces the last tag collected so far. This is the default rule, so this
 * decorator is only needed to switch back after `@MergeNextTags`/`@IgnoreNextTags`.
 *
 * @returns a method decorator
 *
 * @example see {@link MergeNextTags} for the tag-combination mechanics this reverses.
 */
export function ReplaceNextTags() {
  return AomApi.methodDecorator(($) => {
    $.openApi.tag.rule = TagsRules.REPLACE;
  });
}
