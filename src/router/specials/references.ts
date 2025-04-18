import {
  FwdContainer,
  FwdFunction,
  RefFunction,
  RouteRefContainer,
  ThisRefContainer,
} from "../common";

export function FwdRef(fn: FwdFunction): FwdContainer {
  return new FwdContainer(fn);
}

export function ThisRef(fn?: RefFunction): ThisRefContainer {
  return new ThisRefContainer(fn);
}

export function RouteRef(fn?: RefFunction): RouteRefContainer {
  return new RouteRefContainer(fn);
}
