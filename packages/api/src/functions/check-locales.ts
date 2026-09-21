import { difference } from "es-toolkit/compat";

/**
 * Diagnostic helper: logs to `console.log` every message code present in `source` (a
 * `messages/*` module, values like `AOM_API:ERROR_NOT_FOUND`) that has no translation in
 * `target` (a locale dictionary, keyed by those same codes). Does not throw — it only reports a
 * mismatch so it can be caught in review; the package's own locale files call it on module load
 * to self-check their translations.
 *
 * @param hint - label prepended to the console output, to identify which pair is being compared
 * @param source - message codes module (its values are the codes to check for)
 * @param target - locale dictionary (its keys should cover every code in `source`)
 *
 * @example
 * ```ts
 * import { checkLocales } from "@aom-js/api";
 * import * as errors from "./constants/messages/errors";
 *
 * const ru = { [errors.ERROR_NOT_FOUND]: "Данные не найдены" };
 * checkLocales("locales/ru/errors", errors, ru); // logs any code missing from `ru`
 * ```
 */
export function checkLocales(
  hint: string,
  source: Record<string, string>,
  target: Record<string, string>,
) {
  // `target`'s keys are `source`'s values (codes like `AOM_API:...`), not their names
  const sourceValues = Object.values(source);
  const targetKeys = Object.keys(target);

  const keysDiff = difference(sourceValues, targetKeys);
  if (keysDiff.length) {
    console.log(`locales difference ${hint}`, keysDiff);
  }
}
