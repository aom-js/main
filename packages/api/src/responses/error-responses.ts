import { ComponentSchema } from "@aom-js/schemer";
import { messages } from "../constants";

import { ErrorMessage } from "./error-message";
import { API_ERROR_423_DATA_LOCKED } from "../constants/messages";

/** `ErrorMessage` with a two-argument constructor `(message, data?)` — status comes only from the class. */
class ErrorWithStatusResponse extends ErrorMessage {
  static status = 500;

  constructor(message: string, data?: any) {
    super(message, undefined, data);
  }
}

/** HTTP 500 — unexpected server error; the generic fallback `Server` uses for uncaught exceptions. */
@ComponentSchema({ description: messages.API_ERROR_500_SERVER_ERROR })
export class ServerErrorResponse extends ErrorWithStatusResponse {
  static status = 500;

  static description = messages.SERVER_ERROR;
}

/** HTTP 404 — requested resource or route doesn't exist. */
@ComponentSchema({ description: messages.API_ERROR_404_NOT_FOUND })
export class NotFoundResponse extends ErrorWithStatusResponse {
  static status = 404;

  static description = messages.ERROR_NOT_FOUND;
}

/** HTTP 409 — the request conflicts with the current state of the resource (e.g. a duplicate). */
@ComponentSchema({ description: messages.API_ERROR_409_CONFLICT })
export class ConflictResponse extends ErrorWithStatusResponse {
  static status = 409;

  static description = messages.ERROR_CONFLICT;
}

/** HTTP 413 — request body exceeds the configured size limit; thrown by `parseJsonBody`. */
@ComponentSchema({ description: messages.API_ERROR_413_PAYLOAD_TOO_LARGE })
export class PayloadTooLargeResponse extends ErrorWithStatusResponse {
  static status = 413;

  static description = messages.ERROR_PAYLOAD_TOO_LARGE;
}

/** HTTP 400 — request data failed validation; thrown by `SafeData` and the builders that use it. */
@ComponentSchema({ description: messages.API_ERROR_400_WRONG_DATA })
export class WrongDataResponse extends ErrorWithStatusResponse {
  static status = 400;

  static description = messages.ERROR_WRONG_DATA;
}

/** HTTP 423 — the target resource is locked and can't be modified right now. */
@ComponentSchema({ description: API_ERROR_423_DATA_LOCKED })
export class LockedResponse extends ErrorWithStatusResponse {
  static status = 423;

  static description = messages.ERROR_DATA_LOCKED;
}

/** HTTP 424 — the request depends on another resource/step that failed or is missing. */
@ComponentSchema({ description: messages.API_ERROR_424_WRONG_DEPENDENCY })
export class FailedDependencyResponse extends ErrorWithStatusResponse {
  static status = 424;

  static description = messages.ERROR_WRONG_DEPENDENCY;
}

/** HTTP 403 — the caller is authenticated but not allowed to access this resource; thrown by `BaseAccessController.Required`. */
@ComponentSchema({ description: messages.API_ERROR_403_ACCESS_DENY })
export class AccessDenyResponse extends ErrorWithStatusResponse {
  static status = 403;

  static description = messages.ERROR_ACCESS_DENY;
}

/** HTTP 402 — the request requires payment/billing state that isn't satisfied. */
@ComponentSchema({ description: messages.API_ERROR_402_PAYMENT_REQUIRED })
export class PaymentRequiredResponse extends ErrorWithStatusResponse {
  static status = 402;

  static description = messages.PAYMENT_REQUIRED;
}

/** HTTP 401 — missing or invalid credentials; thrown by `AuthBasic`/`AuthHeaderToken`/`AuthCookieToken`. */
@ComponentSchema({ description: messages.API_ERROR_401_AUTH_REQUIRED })
export class AuthRequiredResponse extends ErrorWithStatusResponse {
  static status = 401;

  static description = messages.ERROR_AUTH_REQUIRED;
}

/** HTTP 303 — the resource is available at a different URL; use with a `Location` header set on the response. */
@ComponentSchema({ description: messages.API_ERROR_303_SEE_OTHER })
export class SeeOtherResponse extends ErrorWithStatusResponse {
  static status = 303;

  static description = messages.SEE_OTHER_RESPONSE;
}
