import type { CombinedDecorator } from "@aom-js/core";
import { AomApi } from "../../common";

// Возвращаемый тип аннотирован явно: без этого declaration emit не может именовать
// CombinedDecorator и падает с TS2883 (тип пришёл бы транзитом из @aom-js/core).
export function Title(value: string): CombinedDecorator {
  return AomApi.combinedDecorator(($) => {
    $.title = value;
  });
}

export function Description(value: string): CombinedDecorator {
  return AomApi.combinedDecorator(($) => {
    $.description = value;
  });
}
