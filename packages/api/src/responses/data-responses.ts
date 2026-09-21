import { ComponentSchema, PropertySchema } from "@aom-js/schemer";
//
import { ResponseJSONSchema } from "../schemas";
import { messages } from "../constants";
import { RESPONSES_NUMBER_RESPONSE_VALUE } from "../constants/messages";

/** Base for every successful (2xx) response class in this package; status defaults to `200`. */
@ComponentSchema({ description: messages.RESPONSES_COMMON_RESPONSE })
export class CommonResponse extends ResponseJSONSchema {
  static status = 200;

  static description: string;
}

/**
 * Response carrying just an optional message string — the common case for "operation succeeded,
 * here's a note about it".
 *
 * @example
 * ```ts
 * import { MessageResponse } from "@aom-js/api";
 *
 * // in a handler:
 * return new MessageResponse("Organization created");
 * ```
 */
@ComponentSchema({ description: messages.RESPONSES_MESSAGE_RESPONSE })
export class MessageResponse extends CommonResponse {
  static description = messages.RESPONSES_MESSAGE_RESPONSE_DESCRIPTION;

  @PropertySchema.String({
    isOptional: true,
    description: messages.RESPONSES_MESSAGE_RESPONSE_MESSAGE,
  })
  message?: string;

  constructor(message?: string) {
    super();
    if (message) this.message = message;
  }
}

/** `MessageResponse` plus an untyped `data` payload. Applications typically subclass this to type `data`. */
@ComponentSchema({ description: messages.RESPONSES_DATA_RESPONSE })
export class DataResponse extends MessageResponse {
  static description = messages.RESPONSES_DATA_RESPONSE_DESCRIPTION;

  @PropertySchema.Any({ isOptional: true, description: messages.RESPONSES_DATA_RESPONSE_DATA })
  data?: any;

  constructor(message?: string, data?: any) {
    super(message);
    if (data) this.data = data;
  }
}

/** `MessageResponse` plus a numeric `value`. */
@ComponentSchema({ description: messages.RESPONSES_NUMBER_RESPONSE })
export class NumberResponse extends MessageResponse {
  static description = messages.RESPONSES_NUMBER_RESPONSE_DESCRIPTION;

  @PropertySchema.Number({ description: RESPONSES_NUMBER_RESPONSE_VALUE })
  value?: number;

  constructor(value?: number) {
    super();
    this.value = value;
  }
}

/** `MessageResponse` plus a boolean `value`. */
@ComponentSchema({ description: messages.RESPONSES_BOOLEAN_RESPONSE })
export class BooleanResponse extends MessageResponse {
  static description = messages.RESPONSES_BOOLEAN_RESPONSE_DESCRIPTION;

  @PropertySchema.Boolean({ description: messages.RESPONSES_BOOLEAN_RESPONSE_VALUE })
  value?: boolean;

  constructor(value?: boolean) {
    super();
    this.value = value;
  }
}
/** `MessageResponse` plus a string `value`. */
@ComponentSchema({ description: messages.RESPONSES_STRING_RESPONSE })
export class StringResponse extends MessageResponse {
  static description = messages.RESPONSES_STRING_RESPONSE_DESCRIPTION;

  @PropertySchema.String({ description: messages.RESPONSES_STRING_RESPONSE_VALUE })
  value?: string;

  constructor(value?: string) {
    super();
    this.value = value;
  }
}
