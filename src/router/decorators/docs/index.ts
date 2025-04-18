import { AomHttp } from "../../common";

export function Title(value: string) {
  return AomHttp.staticDecorator(($) => {
    $.title = value;
  });
}

export function Description(value: string) {
  return AomHttp.staticDecorator(($) => {
    $.description = value;
  });
}
