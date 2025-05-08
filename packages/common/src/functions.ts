import { Constructor } from "./types";

export function isClass(value: Constructor) {
  return typeof value === "function" && /^class\s/.test(Function.prototype.toString.call(value));
}
