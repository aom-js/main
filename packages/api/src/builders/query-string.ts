import { Class } from "type-fest";

import { type RefFunction, Controller, DelayRefStack } from "@aom-js/router";
import { Query, ThisRef, This, Middleware, QueryParameters, Responses } from "@aom-js/router";
//
import { WrongDataResponse } from "../responses";
import { SafeData } from "../decorators";
import { messages } from "../constants";

//
import { QueryStringJSONSchema } from "../common";

const SafeOrigin = ThisRef((<T extends typeof QueryStringBuilderConstructor>({ schema }: T) =>
  SafeData(schema)) as RefFunction);

const SafeOriginParameters = ThisRef((<T extends typeof QueryStringBuilderConstructor>(
  constructor: T,
) => [QueryParameters(...constructor.JSONSchema())]) as RefFunction);

@Controller()
class QueryStringBuilderConstructor<
  T extends Class<any, any>,
  R = InstanceType<T>,
> extends QueryStringJSONSchema {
  static readonly schema: Class<any, any>;

  query!: R;

  async queryBuild(query: R) {
    return query as any;
  }

  @Middleware()
  @Responses(WrongDataResponse.JSONSchema())
  static async NotEmpty(@Query(SafeOrigin) query: any) {
    if (!Object.entries(query).length) {
      return new WrongDataResponse(messages.REQUIRED_DATA_MISSING);
    }
  }

  @Middleware()
  @DelayRefStack(SafeOriginParameters)
  @Responses(WrongDataResponse.JSONSchema())
  static async Query(
    @Query(SafeOrigin) query: any,
    @This() queryBuilder: QueryStringBuilderConstructor<typeof QueryStringJSONSchema>,
  ) {
    queryBuilder.query = query;
  }
}

export function QueryStringBuilder<T extends Class<any, any>>(schema: T) {
  return class extends QueryStringBuilderConstructor<T> {
    static readonly schema = schema;
  };
}
