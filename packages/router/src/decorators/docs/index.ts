import { AomApi } from "../../common";

export function Title(value: string) {
  return AomApi.combinedDecorator(($) => {
    $.title = value;
  });
}

export function Description(value: string) {
  return AomApi.combinedDecorator(($) => {
    $.description = value;
  });
}
