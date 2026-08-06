import { ComponentSchema, PropertySchema } from "@aom-js/schemer";
//
import { messages } from "../constants";
import { IErrorData } from "./types";
import { responseJsonSchema } from "../functions";

@ComponentSchema({ description: messages.API_COMMON_ERROR })
export class ErrorMessage extends Error implements IErrorData {
  static status = 500;

  static description = messages.ERROR_MESSAGE;

  @PropertySchema.Number({ description: messages.API_ERROR_CODE })
  status: number;

  @PropertySchema.String({ description: messages.API_ERROR_MESSAGE })
  message: string;

  @PropertySchema.Any({ description: messages.API_ERROR_DETAILS })
  data?: any;

  constructor(message: string, status?: number, data?: any) {
    super(message);
    this.message = message;
    this.status = status || (<any>this.constructor).status;
    this.data = data;
  }

  toJSON(): IErrorData {
    return {
      message: this.message,
      status: this.status,
      data: this.data,
    };
  }

  static JSONSchema(description?: string): ReturnType<typeof responseJsonSchema> {
    return responseJsonSchema(this, description, this.status);
  }
}
