/**
 * `@aom-js/api` — the "batteries" package on top of `@aom-js/router`: an HTTP server on
 * `node:http` (`Server`), parameter builders that turn component schemas into validating
 * controllers (`BodyBuilder`, `QueryStringBuilder`, `HeadersBuilder`, `CookieBuilder`,
 * `ParamsBuilder`, `ResponseBuilder`), reusable base controllers (module root, access control,
 * authentication, typed ID parameters, request logging), response/error classes, and a
 * localizer (`I18nizer`).
 *
 * `import "reflect-metadata"` below is required by the decorators used throughout this package
 * and its dependents; importing anything from `@aom-js/api` pulls it in once, for the whole process.
 */
import "reflect-metadata";

export * from "./server";
export * from "./builders";
export * from "./types";
export * from "./controllers";
export * from "./decorators";
export * from "./functions";
export * from "./responses";
export * from "./schemas";
