import { PREFIX } from "./prefix";

/**
 * Message codes used by `AuthBasic`/`AuthHeaderToken`/`AuthCookieToken` when credentials are
 * missing or invalid. `constants/` isn't re-exported from the package's public entry point —
 * these codes are internal, used by the package's own controllers/responses and translated in
 * `constants/locales/*`.
 */
export const AUTH_REQUIRED = PREFIX("AUTH_REQUIRED");
export const AUTH_NO_TOKEN = PREFIX("AUTH_NO_TOKEN");
export const AUTH_WRONG_TOKEN_TYPE = PREFIX("AUTH_WRONG_TOKEN_TYPE");
export const AUTH_NO_COOKIE = PREFIX("AUTH_NO_COOKIE");
