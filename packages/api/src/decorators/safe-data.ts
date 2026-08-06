import { Class } from "type-fest";
import { Body, OpenApi, Query } from "@aom-js/router";
import { Schemer } from "@aom-js/schemer";
//
import { messages } from "../constants";
import { WrongDataResponse } from "../responses";

const schemer = new Schemer(OpenApi.refPointerPrefix);

export function SafeBody<T extends Class<any>>(constructor: T): ParameterDecorator {
  return Body(SafeData(constructor));
}

export function SafeQuery<T extends Class<any>>(constructor: T): ParameterDecorator {
  return Query(SafeData(constructor));
}

export function SafeData<T extends Class<any>>(constructor: T): Function {
  const handler = async (data: object) => {
    const { values, errors } = schemer.validate(constructor, data);

    if (errors.length) {
      // возвращает код 400, если форма не прошла проверку
      throw new WrongDataResponse(messages.ERROR_WRONG_DATA, errors);
    }
    return values;
  };
  return handler;
}
