import { ComponentSchema } from "@aom-js/schemer";
import { messages } from "../constants";

import { ErrorMessage } from "./error-message";
import { API_ERROR_423_DATA_LOCKED } from "../constants/messages";

class ErrorWithStatusResponse extends ErrorMessage {
  static status = 500;

  constructor(message: string, data?: any) {
    super(message, undefined, data);
  }
}

@ComponentSchema({ description: messages.API_ERROR_500_SERVER_ERROR })
export class ServerErrorResponse extends ErrorWithStatusResponse {
  static status = 500;

  static description = messages.SERVER_ERROR;
}

@ComponentSchema({ description: messages.API_ERROR_404_NOT_FOUND })
export class NotFoundResponse extends ErrorWithStatusResponse {
  static status = 404;

  static description = messages.ERROR_NOT_FOUND;
}

@ComponentSchema({ description: messages.API_ERROR_409_CONFLICT })
export class ConflictResponse extends ErrorWithStatusResponse {
  static status = 409;

  static description = messages.ERROR_CONFLICT;
}

@ComponentSchema({ description: messages.API_ERROR_400_WRONG_DATA })
export class WrongDataResponse extends ErrorWithStatusResponse {
  static status = 400;

  static description = messages.ERROR_WRONG_DATA;
}

@ComponentSchema({ description: API_ERROR_423_DATA_LOCKED })
export class LockedResponse extends ErrorWithStatusResponse {
  static status = 423;

  static description = messages.ERROR_WRONG_DATA;
}

@ComponentSchema({ description: messages.API_ERROR_424_WRONG_DEPENDENCY })
export class FailedDependencyResponse extends ErrorWithStatusResponse {
  static status = 424;

  static description = messages.ERROR_WRONG_DATA;
}

@ComponentSchema({ description: messages.API_ERROR_403_ACCESS_DENY })
export class AccessDenyResponse extends ErrorWithStatusResponse {
  static status = 403;

  static description = messages.ERROR_ACCESS_DENY;
}

@ComponentSchema({ description: messages.API_ERROR_402_PAYMENT_REQUIRED })
export class PaymentRequiredResponse extends ErrorWithStatusResponse {
  static status = 402;

  static description = messages.PAYMENT_REQUIRED;
}

@ComponentSchema({ description: messages.API_ERROR_401_AUTH_REQUIRED })
export class AuthRequiredResponse extends ErrorWithStatusResponse {
  static status = 401;

  static description = messages.ERROR_AUTH_REQUIRED;
}

@ComponentSchema({ description: messages.API_ERROR_303_SEE_OTHER })
export class SeeOtherResponse extends ErrorWithStatusResponse {
  static status = 303;

  static description = messages.SEE_OTHER_RESPONSE;
}
