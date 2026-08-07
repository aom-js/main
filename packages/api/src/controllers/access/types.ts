import { type HandlerFunction } from "@aom-js/router";
import { AomCore } from "@aom-js/core";
//
import { AccessTypes } from "./init";
//
export class AomAccessCore extends AomCore {
  extraAccess!: boolean;

  extraAccessMiddlewares: HandlerFunction[] = [];

  accessTypes: AccessTypes[] | string[] = [];
}

// таблица заполняется по мере разбора ролей, ключи приходят строками — Partial, а не полный Record
export type ActiveAccessTypes = Partial<Record<AccessTypes | string, boolean>>;

export type IAomAccessPoint = { prefix?: string; method?: string; path?: string };

export type AomAccessPlainStructure = Record<string, { extra: string[] }>;

export class AomAccessMapStructure {
  fullAccess: boolean = false;

  structure: AomAccessPlainStructure = {};
}
