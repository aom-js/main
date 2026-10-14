import * as constants from "../../constants";
import { AomApi, AomCursorKind } from "../../common";

const cursorKinds: string[] = Object.values(AomCursorKind);

/**
 * Declares the kind of a step on its **definition** — only where the application can't
 * infer it from what the code is (filter, value, collector, pager, response). Attachment
 * points (`\@Before(...)`, `\@Next(...)`) stay untouched: the kind lives in one place.
 * Read back as `AomApi.checkExists(Step).element.cursorKind` and in the cursor projection
 * (`AomCursor.toJSON().kind`).
 *
 * A typo must fail at startup rather than silently become `Step`: `bun test` doesn't
 * type-check, and `AomCursorKind.Colector` is just `undefined` at runtime.
 *
 * @param kind - a value of {@link AomCursorKind}
 * @returns a method decorator
 * @throws {Error} `CURSOR_KIND_DEFINE_ERROR` when `kind` isn't an `AomCursorKind` value,
 *   or when the method already has a `\@CursorKind` — both at decoration time
 *
 * @example
 * ```ts
 * import { Controller, CursorKind, AomCursorKind, Middleware } from "@aom-js/router";
 *
 * \@Controller()
 * class AgreementsData {
 *   \@CursorKind(AomCursorKind.Collector)
 *   \@Middleware()
 *   static async Query() {}
 * }
 * ```
 */
export function CursorKind(kind: AomCursorKind): MethodDecorator {
  if (!cursorKinds.includes(kind)) throw new Error(constants.CURSOR_KIND_DEFINE_ERROR);
  return AomApi.methodDecorator(($) => {
    if ($.element.cursorKind) throw new Error(constants.CURSOR_KIND_DEFINE_ERROR);
    $.element.cursorKind = kind;
  });
}
