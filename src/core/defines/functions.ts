import { Constructor, Property } from "../../common/types";
import * as constants from "../constants";

export function checkConstructorProperty(constructor: Constructor, property?: Property) {
  if (typeof constructor !== "function") {
    throw new Error(constants.CONSTRUCTOR_TYPE_ERROR);
  }
  if (property && typeof constructor[property] !== "function") {
    throw new Error(constants.CONSTRUCTOR_PROPERTY_TYPE_ERROR);
  }
}
