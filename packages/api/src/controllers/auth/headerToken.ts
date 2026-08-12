import { Headers, Controller, Middleware, Security, This, Responses } from "@aom-js/router";
//
import { AuthRequiredResponse } from "../../responses";
import { messages } from "../../constants";

export const HeaderTokenSecuritySchema = {
  type: "http",
  scheme: "bearer",
};

@Controller()
export class AuthHeaderToken {
  static TOKEN_NAME: string = "Bearer";

  static HEADERS_KEYS: string[] = ["authorization"];

  value!: string;

  type!: string;

  @Middleware()
  @Security(HeaderTokenSecuritySchema)
  @Responses(AuthRequiredResponse.JSONSchema())
  static async Required(
    @This() self: AuthHeaderToken,
    @Headers() headers: Record<string, string | string[]>,
  ) {
    this.HEADERS_KEYS.forEach((headerKey) => {
      const [headerValue] = [headers[headerKey]].flat();
      if (!self.value && headerValue) {
        // это специальное разрешение, позволяющее прокидывать токен через альтернативые заголовки
        // например `sec-websocket-protocol`
        [self.type, self.value] = headerValue
          .replace(`${this.TOKEN_NAME}_`, `${this.TOKEN_NAME} `)
          .split(" ");
      }
    });

    if (!self.value && !self.type) {
      throw new AuthRequiredResponse(messages.AUTH_NO_TOKEN);
    }

    if (self.type !== this.TOKEN_NAME) {
      throw new AuthRequiredResponse(messages.AUTH_WRONG_TOKEN_TYPE);
    }
  }
}
