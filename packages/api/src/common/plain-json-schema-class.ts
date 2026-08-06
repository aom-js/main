import { pathVariants, plainJsonSchema } from "../functions";

class PlainJSONSchema {
  static readonly _path: pathVariants;
  static JSONSchema(): ReturnType<typeof plainJsonSchema> {
    return plainJsonSchema(this, this._path);
  }
}

export class HeaderJSONSchema extends PlainJSONSchema {
  static readonly _path = "header";
}

export class QueryStringJSONSchema extends PlainJSONSchema {
  static readonly _path = "query";
}

export class CookieJSONSchema extends PlainJSONSchema {
  static readonly _path = "cookie";
}
