import { Ctx, Middleware, Responses, Security } from "@aom-js/router";
import { Controller, Headers } from "@aom-js/router";
//
import { messages } from "../../constants";
import { type HttpCtx } from "../../types";
import { AuthRequiredResponse } from "../../responses";

export const BasicSecuritySchema = {
  type: "http",
  scheme: "basic",
};

@Controller()
export class AuthBasic {
  static BASIC_AUTH: string;

  @Middleware()
  @Responses(AuthRequiredResponse.JSONSchema())
  @Security(BasicSecuritySchema)
  static async Required(@Ctx() ctx: HttpCtx, @Headers() { authorization }: any) {
    const [, basic] = String(authorization).split(" ");
    if (this.BASIC_AUTH) {
      ctx.res.setHeader("WWW-Authenticate", "Basic");
      if (basic !== Buffer.from(this.BASIC_AUTH).toString("base64")) {
        throw new AuthRequiredResponse(messages.AUTH_REQUIRED);
      }
    }
    ///
  }
}
