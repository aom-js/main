import * as messages from "./messages";
import locales from "./locales";

/**
 * Aggregates this package's message codes and built-in locale dictionaries. Not re-exported from
 * `src/index.ts` — used internally by controllers, responses, and `Server`.
 */
export { messages, locales };
