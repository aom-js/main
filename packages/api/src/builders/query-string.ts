import { type RefFunction, Controller, DelayRefStack } from "@aom-js/router";
import { Query, ThisRef, This, Middleware, QueryParameters, Responses } from "@aom-js/router";
//
import { type ClassConstructor } from "../types";
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
  T extends ClassConstructor,
  R = InstanceType<T>,
> extends QueryStringJSONSchema {
  static readonly schema: ClassConstructor;

  query!: R;

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

export function QueryStringBuilder<T extends ClassConstructor>(schema: T): typeof QueryStringBuilderConstructor<T> {
  return class extends QueryStringBuilderConstructor<T> {
    static readonly schema = schema;
  };
}
