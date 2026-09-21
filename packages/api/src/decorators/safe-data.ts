import { Body, OpenApi, Query } from "@aom-js/router";
import { Schemer } from "@aom-js/schemer";
//
import { type ClassConstructor } from "../types";
import { messages } from "../constants";
import { WrongDataResponse } from "../responses";

const schemer = new Schemer(OpenApi.refPointerPrefix);

/** Shortcut for `Body(SafeData(constructor))`: injects the request body validated against `constructor`. */
export function SafeBody<T extends ClassConstructor>(constructor: T): ParameterDecorator {
  return Body(SafeData(constructor));
}

/** Shortcut for `Query(SafeData(constructor))`: injects the query string validated against `constructor`. */
export function SafeQuery<T extends ClassConstructor>(constructor: T): ParameterDecorator {
  return Query(SafeData(constructor));
}

/**
 * Builds a value-transform function that validates plain data against a component schema via
 * `Schemer.validate`, throwing on failure. This is the validation primitive every builder in
 * this package (`BodyBuilder`, `QueryStringBuilder`, `HeadersBuilder`, `CookieBuilder`,
 * `ParamsBuilder`) uses internally — reach for it directly only when writing a custom parameter
 * decorator that needs the same validation (e.g. via `@Body(SafeData(Schema))`, which is exactly
 * what `SafeBody`/`SafeQuery` do).
 *
 * @param constructor - component schema (`@ComponentSchema`) to validate against
 * @returns an async function `(data) => values` suitable for `@Body`/`@Query`/etc.'s transform argument
 * @throws {WrongDataResponse} 400, with the `Schemer` validation errors attached as `data`
 */
export function SafeData<T extends ClassConstructor>(constructor: T): Function {
  const handler = async (data: object) => {
    const { values, errors } = schemer.validate(constructor, data);

    if (errors.length) {
      // returns a 400 status when validation fails
      throw new WrongDataResponse(messages.ERROR_WRONG_DATA, errors);
    }
    return values;
  };
  return handler;
}
