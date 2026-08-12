import {
  Headers,
  Controller,
  Middleware,
  Security,
  This,
  Responses,
  Cookies,
  ThisRef,
  RefFunction,
  DelayRefStack,
} from "@aom-js/router";
//
import { AuthRequiredResponse } from "../../responses";
import { messages } from "../../constants";

const SafeSecuritySchema = ThisRef((<T extends typeof AuthCookieToken>(constructor: T) => [
  Security({ ...CookieTokenSecuritySchema, name: constructor.COOKIE_NAME }),
]) as RefFunction);

export const CookieTokenSecuritySchema = {
  type: "apiKey",
  in: "cookie",
};

@Controller()
export class AuthCookieToken {
  static COOKIE_NAME: string = "sessionId";

  value!: string;

  @Middleware()
  @DelayRefStack(SafeSecuritySchema)
  @Responses(AuthRequiredResponse.JSONSchema())
  static async Required(@This() self: AuthCookieToken, @Cookies() cookies: Record<string, string>) {
    self.value = cookies[this.COOKIE_NAME];

    if (!self.value) {
      throw new AuthRequiredResponse(messages.AUTH_NO_COOKIE);
    }
  }
}
