import { Type } from "./type.interface";


/**
 * @publicApi
 */
export interface MappedType<T> extends Type<T> {
  new (): T;
}
