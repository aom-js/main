import { Constructor } from "@aom/common";
import { ContainerFunction, FwdFunction, RefFunction } from "./types";

class RefContainer {
  protected fn: ContainerFunction;
  constructor(fn: RefFunction = RefContainer.default) {
    this.fn = fn;
  }

  exec(constructor: Constructor) {
    return Reflect.apply(this.fn, constructor, [constructor]);
  }

  static default: RefFunction = (constructor: Constructor) => constructor;
}

export class FwdContainer extends RefContainer {
  constructor(fn: FwdFunction = FwdContainer.default) {
    super(fn);
    this.fn = fn;
  }

  exec() {
    return Reflect.apply(this.fn, undefined, []);
  }

  static default: FwdFunction = () => new Function();
}

export class ThisRefContainer extends RefContainer {}

export class RouteRefContainer extends RefContainer {}
