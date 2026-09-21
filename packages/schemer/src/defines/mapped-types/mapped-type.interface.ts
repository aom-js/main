import { Type } from "./type.interface";

/**
 * Return type shared by `PartialType`, `PickType`, `OmitType` and `IntersectionType`: a no-argument
 * constructible class for `T` that is also itself a `Type<T>` — usable directly as a base class
 * (`class X extends PickType(User, ["id"]) {}`) or as a `PropertySchema.Type` target once wrapped in
 * a named `\@ComponentSchema` subclass.
 */
export interface MappedType<T> extends Type<T> {
  new (): T;
}
