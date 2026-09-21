/** Namespace prefix for every message code defined in this package. */
export const PREFIX_VALUE = "AOM_API";

/**
 * Builds a namespaced message code, e.g. `PREFIX("ERROR_NOT_FOUND")` → `"AOM_API:ERROR_NOT_FOUND"`.
 * Every constant in `constants/messages/*` is built with this; the same code doubles as the key
 * `I18nizer` looks up a translation for.
 */
export const PREFIX = (value: string) => `${PREFIX_VALUE}:${value}`;
