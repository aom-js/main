import { ComponentSchema, PropertySchema } from "@aom-js/schemer";
import { AccessTypes } from "./init";

/** One granted access element: a route/entity identifier plus its optional extra-layer grants. */
@ComponentSchema({ description: "Доступ к элементу маршрута" })
export class AomAccessIdentElement {
  @PropertySchema.String({ description: "Идентификатор маршрута" })
  ident!: string;

  @PropertySchema.String({ isOptional: true, isArray: true, description: "Дополнительные доступы" })
  extra?: string[];
}

/** Access grants scoped to one module: the module's identifier and its list of granted elements. */
@ComponentSchema({ description: "Доступы в модуле" })
export class AomAccessModuleElements {
  @PropertySchema.String({ description: "Идентификатор модуля" })
  moduleIdent!: string;

  @PropertySchema.Type({
    value: () => AomAccessIdentElement,
    isArray: true,
    description: "Значения доступов",
  })
  elements: AomAccessIdentElement[] = [];
}

/**
 * Shape a role/permission grants across modules: full-access flag plus a per-module breakdown.
 * Passed to `BaseAccessController.generateAccessMap` as one entry of `userRoles`.
 */
@ComponentSchema({ description: "Структура доступа к модулям" })
export class AomAccessToModulesStructure {
  @PropertySchema.Boolean({ description: "Признак полного доступа" })
  fullAccess!: boolean;

  @PropertySchema.Type({
    value: () => AomAccessModuleElements,
    isArray: true,
    description: "Доступ к модулям",
  })
  modulesAccess: AomAccessModuleElements[] = [];
}

@ComponentSchema({ description: "Идентификатор точка доступа" })
class AomAccessIdentPoint {
  @PropertySchema.String({ description: "Название" })
  title!: string;

  @PropertySchema.String({ description: "Идентификатор" })
  ident!: string;
}

@ComponentSchema({ description: "Дополнительная точка доступа" })
class AomAccessExtraPoint extends AomAccessIdentPoint {
  @PropertySchema.Enum({
    value: AccessTypes,
    isArray: true,
    description: "Доступность типам разрешений",
  })
  accessTypes: AccessTypes[] | string[] = [];
}

@ComponentSchema({ description: "Точка доступа к маршруту" })
class AomAccessPoint extends AomAccessIdentPoint {
  @PropertySchema.String({ isOptional: true, description: "Путь" })
  path?: string;

  @PropertySchema.String({ isOptional: true, description: "Метод" })
  method?: string;

  @PropertySchema.Type({
    value: () => AomAccessExtraPoint,
    isArray: true,
    description: "Дополнительные слои",
  })
  extra?: AomAccessExtraPoint[];
}

/**
 * Access marker accumulated on a route by `BaseAccessController.SetAccessMark`: every access
 * point reachable through the route, plus the access types recognized at the point where the
 * marker is read. `BaseAccessController.AccessMarker` should point at this class or a subclass.
 */
@ComponentSchema({ description: "Элемент маркирования доступа" })
export class AomAccessMarkerElement {
  @PropertySchema.Type({
    value: () => AomAccessPoint,
    isArray: true,
    description: "Требования элементов доступа",
  })
  accessPoints: AomAccessPoint[] = [];

  @PropertySchema.Enum({
    value: AccessTypes,
    isArray: true,
    description: "Доступность типам разрешений",
  })
  accessTypes: AccessTypes[] | string[] = Object.values(AccessTypes);
}
