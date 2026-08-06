import { Class } from "type-fest";
//
import { type RefFunction } from "@aom-js/router";
import { ThisRef, This, Middleware, Responses, Before } from "@aom-js/router";
import { Controller, DelayRefStack, Headers, Parameters } from "@aom-js/router";
//
import { WrongDataResponse } from "../responses";
import { SafeData } from "../decorators";
import { HeaderJSONSchema } from "../common";

const SafeOrigin = ThisRef((<T extends typeof HeadersBuilderConstructor>({ schema }: T) =>
  SafeData(schema)) as RefFunction);

const SafeOriginParameters = ThisRef((<T extends typeof HeadersBuilderConstructor>(
  constructor: T,
) => [Parameters(...constructor.JSONSchema())]) as RefFunction);

@Controller()
class HeadersBuilderConstructor<
  T extends Class<any, any>,
  R = InstanceType<T>,
> extends HeaderJSONSchema {
  static readonly schema: Class<any, any>;

  headers!: R;

  // определить заголовок с его описанием в open-api
  @Middleware()
  @DelayRefStack(SafeOriginParameters)
  @Before(HeadersBuilderConstructor.ImplicitHeaders)
  static async Headers() { }

  // определить заголовок без его описания в open-api
  @Middleware()
  @Responses(WrongDataResponse.JSONSchema())
  static async ImplicitHeaders<T extends typeof HeaderJSONSchema>(
    @Headers(SafeOrigin) headers: any,
    @This() self: HeadersBuilderConstructor<T>,
  ) {
    self.headers = headers;
  }
}

export function HeadersBuilder<T extends Class<any, any>>(schema: T) {
  return class extends HeadersBuilderConstructor<T> {
    static readonly schema = schema;
  };
}
