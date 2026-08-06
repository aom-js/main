import { ClassConstructor, ClassType, InstanceTarget, Property } from "./types";

export function isClass(value: InstanceTarget) {
  return (
    typeof value === "function" && /^class[\s\{]/.test(Function.prototype.toString.call(value))
  );
}
