import { type RefFunction, Controller, CookieParameters, DelayRefStack } from "@aom-js/router";
import { ThisRef, Cookies, This, Middleware, Responses } from "@aom-js/router";
//
import { type ClassConstructor } from "../types";
import { WrongDataResponse } from "../responses";
import { SafeData } from "../decorators";
import { messages } from "../constants";

//
import { CookieJSONSchema, QueryStringJSONSchema } from "../common";

const SafeOrigin = ThisRef((<T extends typeof CookieBuilderConstructor>({ schema }: T) =>
  SafeData(schema)) as RefFunction);

const SafeOriginParameters = ThisRef((<T extends typeof CookieBuilderConstructor>(
  constructor: T,
) => [CookieParameters(...constructor.JSONSchema())]) as RefFunction);

@Controller()
class CookieBuilderConstructor<
  T extends ClassConstructor,
  R = InstanceType<T>,
> extends CookieJSONSchema {
  static readonly schema: ClassConstructor;

  cookies!: R;

  @Middleware()
  @Responses(WrongDataResponse.JSONSchema())
  static async NotEmpty(@Cookies(SafeOrigin) cookies: any) {
    if (!Object.entries(cookies).length) {
      throw new WrongDataResponse(messages.REQUIRED_DATA_MISSING);
    }
  }

  @Middleware()
  @DelayRefStack(SafeOriginParameters)
  @Responses(WrongDataResponse.JSONSchema())
  static async Cookie(
    @Cookies(SafeOrigin) cookies: any,
    @This() queryBuilder: CookieBuilderConstructor<typeof QueryStringJSONSchema>,
  ) {
    queryBuilder.cookies = cookies;
  }
}

export function CookieBuilder<T extends ClassConstructor>(schema: T): typeof CookieBuilderConstructor<T> {
  return class extends CookieBuilderConstructor<T> {
    static readonly schema = schema;
  };
}
