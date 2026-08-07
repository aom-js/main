import _ from "es-toolkit/compat";

import { type CombinedDecorator } from "@aom-js/core";
import { Before, This, type HandlerFunction, UseMarker, After } from "@aom-js/router";
import { AomRoute, AomApi, AomCursor, Marker, Cursor, Route } from "@aom-js/router";
import { Responses, Middleware, Controller } from "@aom-js/router";

//
import { messages } from "../../constants";
import { AccessDenyResponse } from "../../responses";

import { type ActiveAccessTypes, AomAccessCore, type IAomAccessPoint, AomAccessMapStructure } from "./types";
import { AomAccessMarkerElement, AomAccessIdentElement, AomAccessToModulesStructure } from "./schemas";
import { AccessTypes } from "./init";



@Controller()
export class AccessController {

  static readonly markerName: string;

  static readonly allowedAccessTypes: AccessTypes[] | string[];

  static readonly AccessMarker: typeof AomAccessMarkerElement;

  static readonly AccessCore: typeof AomAccessCore;

  moduleIdent!: string;

  accessMap!: AomAccessMapStructure; // карта доступов

  activeAccessTypes: ActiveAccessTypes = {};

  enabled!: boolean;

  // проверим валидность доступа к идентификатору в точке  маршрута
  checkAccessPoint(ident: string, accessMarker: AomAccessMarkerElement): boolean {
    // возьмем существующие данные о доступах пользователя
    const { accessMap, activeAccessTypes } = this;

    // если контроль доступа не активен, то доступ всегда разрешен
    // используется для ситуации, когда методы под контролем доступа используются, например, в API только для пользователей
    let isAllowed = !this.enabled;

    // проверка доступа - это проверка наличия активных разрешений среди тех типов доступа, которые предоставлены точке доступа
    // которые должны быть в текущем наборе разрешенных типов
    const { accessTypes } = accessMarker;
    _.each(accessTypes, (accessType) => {
      const typeIsActive = activeAccessTypes[<string>accessType];
      // откроем доступ, если для текущего типа доступа был разрешен полный доступ, или нужная точка есть в структуре
      if (typeIsActive) {
        isAllowed = isAllowed || accessMap.fullAccess || !!accessMap.structure[ident];
      }
    });

    return isAllowed;
  }

  generateAccessMap(allowedAccessTypes: string[], userRoles: AomAccessToModulesStructure[]) {

    // установим разрешенный набор из переданных значений
    allowedAccessTypes.forEach((accessType) => {
      this.activeAccessTypes[accessType] = true;
    });

    // создадим карту доступов
    this.accessMap = new AomAccessMapStructure();

    // из списка полученных ролей извлечем типы, к которым они относятся
    // и составим полные карты доступа согласно этим типам
    userRoles.forEach((role) => {
      // установим, что в текущем контексте пользователь имеет полный доступ
      this.accessMap.fullAccess = this.accessMap.fullAccess || role.fullAccess;
      // развернем значение `role.modulesAccess` так, чтобы получить совместимую конструкцию с `structure`
      this.accessMap.structure = _.merge(
        { ...this.accessMap.structure },
        {
          ..._.keyBy(
            _.reduce(
              role.modulesAccess,
              (result: AomAccessIdentElement[], value) =>
                result.concat(value.moduleIdent === this.moduleIdent ? value.elements : []),
              [],
            ),
            "ident",
          ),
        },
      );
    });
  }

  @Middleware()
  static async Init(@This() self: AccessController,): Promise<void> {
    self.enabled = true;
  }

  static TypesRequired(...accessTypes: typeof this.allowedAccessTypes): CombinedDecorator {
    if (!accessTypes.length) {
      throw new Error(messages.CONTROLLERS_ACCESS_TYPES_REQUIRED);
    }

    const diff = _.difference(<string[]>accessTypes, <string[]>this.allowedAccessTypes);
    if (diff.length) {
      throw new Error(`${messages.CONTROLLERS_ACCESS_TYPES_MISMATCH}: ${diff}`);
    }

    return this.AccessCore.combinedDecorator(($) => {
      $.accessTypes.push(...accessTypes as never[]);
      const { target, property } = $._;
      Reflect.decorate([Before(this.Required) as MethodDecorator], target, property!);
    });
  }

  // проверка, что указанная функция является слоем доступа
  private static IsExtraAccess(handler: HandlerFunction) {
    const handlerInstance = this.AccessCore.checkExists(handler);
    // const { constructor, property } = ; restoreReverseMetadata(handler);
    return handlerInstance && handlerInstance.extraAccess;
  }

  // определить middleware как слой доступа
  static SetExtraAccess(...accessTypes: typeof this.allowedAccessTypes): MethodDecorator {

    const diff = _.difference(<string[]>accessTypes, <string[]>this.allowedAccessTypes);
    if (diff.length) {
      throw new Error(`${messages.CONTROLLERS_ACCESS_TYPES_MISMATCH}: ${diff}`);
    }

    return this.AccessCore.methodDecorator(($) => {
      $.extraAccess = true;
      $.accessTypes.push(...accessTypes as never[]);
      const { target, property } = $._;
      Reflect.decorate(
        [Before(this.CheckLayerPass) as MethodDecorator],
        target,
        property!,
      );
    });
  }

  // признак того, что последний используемый слой был пройден
  layerPassed!: boolean;

  @Middleware()
  static async CheckLayerPass(
    @Cursor() cursor: AomCursor,
    @Route() route: AomRoute,
    @This() self: AccessController,
  ) {
    // слой считается пройденным, если роль с полным доступ без указания типа
    const { accessMap, activeAccessTypes: permissions } = self;
    self.layerPassed = false; // self.accessMap.get(null)?.fullAccess;
    const { index } = cursor; // для текущего курсора возьмем позицию, чтобы однозачно найти релевантный ему origin
    // используется для того, чтобы в случае повторений конструкций не было бага "тут можно, там нельзя"
    // cursor.origin - это конструкция, которая является слоем, наличие её ident надо проверить в структуре
    // у той middleware, к которой крепятся указанные access-layer-ы
    // внимание вопрос: как это сделать?!
    // у текущего курсора (который CheckLayerPass) найдем место его прикрепления - то есть access-layer конструкцию
    const { target, property } = cursor.origin._;
    // затем для текущего маршрута в списке курсоров ближайший, который соответствуют текущему access-layer
    const [extraCursor] = route.cursors.filter(
      (cursor) =>
        cursor.index > index && cursor.$._.target === target && cursor.$._.property === property,
    );
    // их чисто технически может быть несколько, и крепиться они могут к разным конструкциям
    // поэтому переберем их все, и зафиксируем хотя бы одно прохождение слоя
    // здесь, впрочем, следует внимательно изучить, какие могут быть ошибки у такого подхода
    if (extraCursor) {
      const extraIdent = extraCursor.$.toString();

      // и для него возьмем точку его прикрепления, и ее идентификатор
      const originIdent = extraCursor.origin.toString();

      // найдем в данных маршрута информацию о текущей контрольной точке
      const routeAccessControl: AomAccessMarkerElement = route.markers[this.markerName];

      const [{ extra = [] }] = routeAccessControl.accessPoints.filter((value) => {
        return value.ident === originIdent;
      });

      // найдем среди них те, которые соответствуют данной extra-point
      const [{ accessTypes }] = extra.filter((value) => value.ident === extraIdent);

      accessTypes.forEach((accessType) => {
        // если текущие типы входят в допустимые для организации
        const typeAllowed = permissions[accessType];
        if (typeAllowed) {
          // считаем дополнительный слой пройденным, если для него есть полный доступ
          // или в списке расширений указан специальный слой
          const extraIdentPassed =
            accessMap.fullAccess || accessMap.structure[originIdent]?.extra.includes(extraIdent);
          self.layerPassed = self.layerPassed || extraIdentPassed;
        }
      });
    }
  }

  // использовать слои доступа
  static ExtraAccess(...middlewares: HandlerFunction[]): CombinedDecorator {
    //

    // здесь можно раскрыть
    if (!middlewares.length) {
      throw new Error(messages.CONTROLLERS_ACCESS_MIDDLEWARES_REQUIRED);
    }

    // проверим, чтобы каждая миддлварь была корректным слоем
    middlewares.forEach((middleware) => {
      if (!this.IsExtraAccess(middleware)) {
        const aomMiddleware = AomApi.instance(middleware);
        throw new Error(
          `${messages.CONTROLLERS_ACCESS_WRONG_MIDDLEWARE_ACCESS_LAYER}: ${aomMiddleware.toString()}`,
        );
      }
    });

    return this.AccessCore.combinedDecorator(($) => {
      //
      $.extraAccessMiddlewares.push(...middlewares);
      const { target, property } = $._;
      Reflect.decorate([Before(...middlewares) as MethodDecorator], target, property!);
    });
  }

  @UseMarker(AccessController.setAccessMark)
  @Middleware()
  @Responses(AccessDenyResponse.JSONSchema())
  static async Required(
    @This() self: AccessController,
    @Cursor() cursor: AomCursor,
    @Route() route: AomRoute,
  ): Promise<void | Error> {
    // ...
    const cursorIsEndpoint = route.endpoint.$ === cursor.$;

    const markName = this.markerName;
    const origin = cursorIsEndpoint ? route.endpoint.$ : cursor.origin;

    const ident = origin.toString();

    if (!self.checkAccessPoint(ident, route.markers[markName])) {
      throw new AccessDenyResponse(messages.ERROR_ACCESS_DENY);
    }
  }


  // установить типичный доступ с учетом требований к конкретным типам партнерств
  @Marker()
  static setAccessMark(route: AomRoute, cursor: AomCursor): void {
    const markName = this.markerName;

    let currentAccessControl: InstanceType<typeof this.AccessMarker>;
    if (!route.markers[markName]) {
      currentAccessControl = new this.AccessMarker();
    } else {
      currentAccessControl = route.markers[markName];
    }

    // важна информация из точки "прикрепления" курсора
    const { target, property } = cursor.origin._;

    const extaAccessInstance = this.AccessCore.instance(target, property);

    // если не указаны конкретные значения, то возьмем их из текущего значения на курсоре
    // это надо для того, чтобы один раз установив ограничения на уровне выше впоследствии использовать только
    // @Before(AccessAdmin.Required) для уточнения доступо в к более глубоким элементам
    // также добавим ограничение, что если установлен признак "только для администраторов"
    const extraAccessTypes = extaAccessInstance.accessTypes.length
      ? extaAccessInstance.accessTypes
      : currentAccessControl.accessTypes;

    // если ранее были обозначены доступы, то надо сделать так, чтобы на более глубоком уровне не было обогащания списка
    // а только его вероятное обрезание за счет новых значений
    // при этом в идеале следует выдать предупреждение, что входящий список содержит некорректные значения
    const newAccessTypes = currentAccessControl.accessTypes.length
      ? _.intersection(<string[]>currentAccessControl.accessTypes, <string[]>extraAccessTypes)
      : extraAccessTypes;

    // если новый список оказался пустым, то перенесем старые значения, и в идеале следует показать предупреждение о том
    // что произошел конфликт поиска значений
    currentAccessControl.accessTypes = newAccessTypes.length
      ? newAccessTypes
      : currentAccessControl.accessTypes;

    const controlForEndpoint = cursor.origin === route.endpoint.$;
    // cursor.origin.constructor === route.constructor && cursor.origin.property === route.property;

    const dataElem = controlForEndpoint ? route.endpoint.$ : cursor.origin;

    const { prefix, method, path } = <IAomAccessPoint>(controlForEndpoint ? route : cursor);

    const ident = dataElem.toString();
    const title = dataElem.title || ident;
    const layersMiddlewares = extaAccessInstance.extraAccessMiddlewares;

    // соберем список дополнительных слоев, которые могут доступны
    const extra = layersMiddlewares.map((middleware) => {
      const httpInstance = AomApi.instance(middleware);
      const extraAccessInstance = this.AccessCore.instance(middleware);

      const ident = httpInstance.toString();
      const title = httpInstance.title || ident;

      const extraPermissionsTypes = extraAccessInstance.accessTypes;

      const accessTypes = currentAccessControl.accessTypes.length
        ? _.intersection(<string[]>currentAccessControl.accessTypes, <string[]>extraPermissionsTypes)
        : extraPermissionsTypes;

      return { ident, title, accessTypes };
    });

    // проверим, что данный идентификатор еще не входит в список требований
    const accessPoint = { ident, title, extra, method, path: path || prefix };
    if (
      !currentAccessControl.accessPoints.filter((value) => value.ident === accessPoint.ident).length
    ) {
      // и добавим его
      currentAccessControl.accessPoints.push(accessPoint);
    }
    // добавим маркер
    route.markers[markName] = currentAccessControl;
  }

  static toString(): string {
    return this.name;
  }
  // */
}
