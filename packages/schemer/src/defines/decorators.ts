// add a class-description decorator
import { ClassType, ExecutionPhase } from "@aom-js/core";
import { JSONSchema } from "class-validator-jsonschema";
// local imports
import { AomSchemas, isComponentAncestor } from "./module";
import { ClassDescriptionsProperties } from "./types";

/**
 * Marks a class as a component schema — the entry point of the flat-decorator model. Every
 * `PropertySchema.*` factory queues its work at `ExecutionPhase.LAST` and does nothing on its own;
 * `@ComponentSchema` is the class-level `ExecutionPhase.INSTANT` decorator that flushes that queue.
 * A class with `PropertySchema.*` properties but never decorated with `@ComponentSchema()` is a
 * complete no-op: nothing renders and nothing validates.
 *
 * On each application it, in order:
 * 1. walks up the prototype chain to the nearest `@ComponentSchema`-decorated ancestor (inclusive),
 *    calling `inherit()` on every class in between — including undecorated intermediate classes, so
 *    an undecorated `class Mid extends Base {}` with its own `PropertySchema` properties still
 *    contributes them once a decorated `class Child extends Mid {}` is processed;
 * 2. applies `JSONSchema(schema)` to the class, where `schema` is `params` without `decorators`
 *    (`decorators` never becomes part of the class's rendered JSON Schema);
 * 3. flushes the queued `PropertySchema` decorators for every property (`$._.apply()`);
 * 4. applies `params.decorators` last, so they see a fully decorated class.
 *
 * @param params - class-level description (`description`, `deprecated`) plus extra `decorators` to
 * apply last; the component's name is always `target.name` — there is no rename option
 * @returns a class decorator
 *
 * @example
 * ```ts
 * import { ComponentSchema, PropertySchema } from "@aom-js/schemer";
 *
 * @ComponentSchema({ description: "A user account" })
 * export class UserDto {
 *   @PropertySchema.String({ minLength: 1, maxLength: 64 })
 *   name!: string;
 * }
 * ```
 */
export function ComponentSchema(params?: ClassDescriptionsProperties): ClassDecorator {
  //
  return AomSchemas.classDecorator(($: AomSchemas) => {
    $.isComponentSchema = true;
    // This is where inheritance should carry over the original decorators. Inheritance here
    // will differ slightly from what was used for controllers, in particular because various
    // kinds of trimming can happen via mapped-types or similar tools — which, by the way, means
    // we should really build our own version of mapped-types, replicating what, say,
    // @buddh4/mapped-types does, and merging it with our own decorators. And that, incidentally,
    // looks like a sound idea.
    // Inherit the decorators: an undecorated intermediate class doesn't inherit anything from
    // its ancestors on its own (it has no `@ComponentSchema` of its own to do that), so we walk
    // up to the nearest `@ComponentSchema` inclusive, not just to the direct parent.
    let parent: ClassType = Object.getPrototypeOf($._.target);
    while (typeof parent === "function" && parent !== Function.prototype) {
      if (isComponentAncestor($._.inherit(parent))) break;
      parent = Object.getPrototypeOf(parent);
    }

    // If params were given, apply the corresponding description to the class.
    // `decorators` is not part of the class's JSON Schema — it's applied separately below.
    if (params) {
      // Keep as-is — `foldSchemas` needs this to tell "no params were given" apart from
      // "an empty object was passed".
      $.componentParams = params;
      const { decorators: _decorators, ...schema } = params;
      Reflect.decorate([JSONSchema(schema)], $._.target);
    }

    $._.apply(); // flush the rest of the queued decorators

    Reflect.decorate(params?.decorators || [], $._.target); // apply decorators added to the component's context
  }, ExecutionPhase.INSTANT);
}
