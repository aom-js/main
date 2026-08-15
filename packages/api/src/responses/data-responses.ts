import { ComponentSchema, PropertySchema } from "@aom-js/schemer";
//
import { ResponseJSONSchema } from "../schemas";
import { messages } from "../constants";
import { RESPONSES_NUMBER_RESPONSE_VALUE } from "../constants/messages";

@ComponentSchema({ description: messages.RESPONSES_COMMON_RESPONSE })
export class CommonResponse extends ResponseJSONSchema {
  static status = 200;

  static description: string;
}

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
