//
import { type RefFunction } from "@aom-js/router";
import { ThisRef, This, Middleware, Responses, Before } from "@aom-js/router";
import { Controller, DelayRefStack, Headers, Parameters } from "@aom-js/router";
//
import { type ClassConstructor } from "../types";
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
  T extends ClassConstructor,
  R = InstanceType<T>,
> extends HeaderJSONSchema {
  static readonly schema: ClassConstructor;

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

export function HeadersBuilder<T extends ClassConstructor>(schema: T): typeof HeadersBuilderConstructor<T> {
  return class extends HeadersBuilderConstructor<T> {
    static readonly schema = schema;
  };
}
