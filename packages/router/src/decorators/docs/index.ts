import { AomHttp } from "../../common";

export function Title(value: string) {
  return AomHttp.combinedDecorator(($) => {
    $.title = value;
  });
}

export function Description(value: string) {
  return AomHttp.combinedDecorator(($) => {
    $.description = value;
  });
}
