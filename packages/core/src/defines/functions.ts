import { ClassType, InstanceTarget, Property } from "./types";

export function isClass(value: InstanceTarget) {
  return (
    typeof value === "function" && /^class[\s\{]/.test(Function.prototype.toString.call(value))
  );
}

export function hasOwnProperty(target: ClassType, property: Property): boolean {
  return Object.prototype.hasOwnProperty.call(target, property);
}
