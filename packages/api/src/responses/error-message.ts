import { ComponentSchema, PropertySchema } from "@aom-js/schemer";
//
import { messages } from "../constants";
import { IErrorData } from "./types";
import { responseJsonSchema } from "../functions";

/**
 * Base class for every error response in this package (`NotFoundResponse`, `ConflictResponse`,
 * etc.) and a reasonable base for application-defined error responses too. `Server` recognizes
 * any thrown `ErrorMessage` by construction: it serializes `toJSON()` and responds with `status`.
 *
 * @example
 * ```ts
 * import { ErrorMessage } from "@aom-js/api";
 *
 * class TeapotResponse extends ErrorMessage {
 *   static status = 418;
 *   static description = "I'm a teapot";
 * }
 *
 * // in a handler:
 * throw new TeapotResponse("APP:TEAPOT");
 * // -> HTTP 418, body { "message": "APP:TEAPOT", "status": 418 }
 * ```
 */
@ComponentSchema({ description: messages.API_COMMON_ERROR })
export class ErrorMessage extends Error implements IErrorData {
  /** Default HTTP status for this error class; overridden by subclasses, or by the constructor's `status` argument. */
  static status = 500;

  /** Default OpenAPI description for this error class, used by `JSONSchema` when no description is passed. */
  static description = messages.ERROR_MESSAGE;

  @PropertySchema.Number({ description: messages.API_ERROR_CODE })
  status: number;

  @PropertySchema.String({ description: messages.API_ERROR_MESSAGE })
  message: string;

  @PropertySchema.Any({ isOptional: true, description: messages.API_ERROR_DETAILS })
  data?: any;

  /**
   * @param message - message code (e.g. `AOM_API:ERROR_NOT_FOUND`); localized by `I18nizer` if configured
   * @param status - overrides `static status` on this instance
   * @param data - optional extra details attached to the response (e.g. validation errors)
   */
  constructor(message: string, status?: number, data?: any) {
    super(message);
    this.message = message;
    this.status = status || (<typeof ErrorMessage>this.constructor).status;
    this.data = data;
  }

  /** Plain-object shape actually sent to the client (used by `JSON.stringify` via `Server`). */
  toJSON(): IErrorData {
    return {
      message: this.message,
      status: this.status,
      data: this.data,
    };
  }

  /** Describes this error as an OpenAPI response, defaulting to `static description`/`status`. */
  static JSONSchema(description?: string): ReturnType<typeof responseJsonSchema> {
    return responseJsonSchema(this, description ?? this.description, this.status);
  }
}
