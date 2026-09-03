import type { ClassType } from "@aom-js/core";
import { AomApi, AomCursor, AomRoute, OpenApi, Router } from "@aom-js/router";

import type {
  BuildGraphOptions,
  VisualChainItem,
  VisualController,
  VisualGraph,
  VisualMiddleware,
  VisualNodeKind,
  VisualParameter,
  VisualRequestBody,
  VisualResponse,
  VisualRoute,
  VisualSchema,
  VisualSchemaProperty,
  VisualSchemaRef,
  VisualMember,
} from "./types";

const REF_PREFIX = "#/components/schemas/";

/** Роль звена по флагам `AomApiElement`: те же признаки, что расставляют декораторы роутера */
function nodeKind($: AomApi): VisualNodeKind {
  const { element } = $;
  if (element.isEndpoint) return "endpoint";
  if (element.isWebsocket) return "websocket";
  if (element.isNextpoint) return "nextpoint";
  if (element.isMarker) return "marker";
  if (element.isInstance) return "hook";
  if (element.isMiddleware) return "middleware";
  // курсор без флагов — это метод, поднятый в цепочку декоратором `@Bridge`
  return $._.property ? "middleware" : "controller";
}

/**
 * Путь маршрута в нотации OpenAPI. Повторяет подстановку из `OpenApi.registerPath`:
 * иначе операцию из готового документа не найти по маршруту роутера.
 */
function openApiPath(route: AomRoute): string {
  let path = route.path;
  route.cursors.forEach((cursor) => {
    cursor.$.openApi.path.forEach((structure) => {
      Object.keys(structure).forEach((key) => {
        path = path.replace(key, `{${structure[key].name}}`);
      });
    });
  });
  return path;
}

function refName(ref: unknown): string | undefined {
  return typeof ref === "string" && ref.startsWith(REF_PREFIX)
    ? ref.slice(REF_PREFIX.length)
    : undefined;
}

/**
 * Краткое описание JSON Schema: имя связанной компоненты (ребро ER) и подпись типа.
 * Разбирается ровно то, что реально эмитят `Schemer` и декораторы роутера.
 */
function describeSchema(value: any): VisualSchemaRef {
  if (!value || typeof value !== "object") return { label: "any" };

  const direct = refName(value.$ref);
  if (direct) return { ref: direct, label: direct };

  for (const key of ["allOf", "anyOf", "oneOf"] as const) {
    const variants: any[] = Array.isArray(value[key]) ? value[key] : [];
    if (!variants.length) continue;
    const described = variants.map(describeSchema).filter((item) => item.label !== "null");
    const withRef = described.find((item) => item.ref);
    if (withRef) return withRef;
    if (described.length) {
      return { label: described.map((item) => item.label).join(" | ") };
    }
  }

  if (value.type === "array" || (Array.isArray(value.type) && value.type.includes("array"))) {
    const items = describeSchema(value.items);
    return { ref: items.ref, isArray: true, label: `${items.label}[]` };
  }

  if (Array.isArray(value.enum) && value.enum.length) {
    return { label: `enum(${value.enum.length})` };
  }

  if (Array.isArray(value.type)) {
    const named = value.type.filter((one: string) => one !== "null");
    return { label: named.join(" | ") || "null" };
  }

  if (typeof value.type === "string") {
    return { label: value.format ? `${value.type}<${value.format}>` : value.type };
  }

  return { label: value.properties ? "object" : "any" };
}

/** Свойство компонентной схемы в виде строки ER-таблицы */
function describeProperty(name: string, value: any, required: string[]): VisualSchemaProperty {
  const described = describeSchema(value);
  const types = Array.isArray(value?.type) ? value.type : [value?.type];
  return {
    name,
    type: described.label,
    format: typeof value?.format === "string" ? value.format : undefined,
    description: typeof value?.description === "string" ? value.description : undefined,
    required: required.includes(name),
    isArray: !!described.isArray,
    nullable: value?.nullable === true || types.includes("null") || undefined,
    ref: described.ref,
    enum: Array.isArray(value?.enum) ? value.enum.map(String) : undefined,
  };
}

/**
 * Декорированные члены класса. Реестр мета-инстансов не перечисляется снаружи,
 * но у узла класса есть `_.origins` — список дескрипторов, зарегистрированных
 * декораторами. Через него видно и те звенья, что нигде не подключены.
 */
function declaredMembers($: AomApi): VisualMember[] {
  const origins: any[] = Array.isArray(($._ as any).origins) ? ($._ as any).origins : [];
  const members = new Map<string, VisualMember>();
  origins.forEach((origin) => {
    const self: AomApi | undefined = origin?.self;
    if (!self || !self._?.property) return;
    const id = self.toString();
    if (members.has(id)) return;
    members.set(id, {
      id,
      method: String(self._.property),
      kind: nodeKind(self),
      title: self.title,
    });
  });
  return [...members.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Все контроллеры, достижимые от указанного класса по бриджам.
 * Тот же обход, что делает `Router.build`, но без построения маршрутов —
 * нужен, чтобы разрешить имя корня из query-параметра и наполнить селектор.
 */
export function collectControllers(target: ClassType): Map<string, ClassType> {
  const found = new Map<string, ClassType>();
  const seen = new Set<AomApi>();

  const walk = ($: AomApi) => {
    if (seen.has($)) return;
    seen.add($);
    found.set($._.target.name, $._.target);
    $.element.bridges.forEach((bridge) => walk(bridge.next));
  };

  walk(AomApi.instance(target));
  return found;
}

/**
 * Собрать граф API от указанного контроллера (в общем случае — корневого).
 *
 * Источником может быть живой `Router` — тогда берётся его корень. Дерево всё равно
 * пересобирается на собственном документе OpenApi: у роутера приложения сборщик схем
 * общий на весь модуль, и от него не отделить поддерево, а декларации курсоров
 * материализуются только в момент сборки маршрутов.
 */
export function buildVisualGraph(
  source: ClassType | Router,
  options: BuildGraphOptions = {},
): VisualGraph {
  const target: ClassType = source instanceof Router ? source.root : source;
  const warnings: string[] = [];

  const docs = new OpenApi({
    openapi: "3.1.0",
    info: {
      title: options.info?.title ?? target.name,
      version: options.info?.version ?? "0.0.0",
    },
    paths: {},
  });

  const router = new Router(target, docs);
  // `Router` регистрирует в документе только http-маршруты; сокеты добавим сами,
  // иначе их схемы не попадут в общий сборщик компонент
  router.sockets.forEach((route) => {
    try {
      docs.registerPath(route);
    } catch (error) {
      warnings.push(`websocket ${route.path}: ${(error as Error).message}`);
    }
  });

  const document: any = docs.toJSON();
  const components: Record<string, any> = document.components?.schemas ?? {};

  // операции документа по ключу `method:path` — так их находит маршрут роутера
  const operations = new Map<string, any>();
  Object.entries(document.paths ?? {}).forEach(([path, methods]) => {
    Object.entries(methods as Record<string, any>).forEach(([method, operation]) => {
      operations.set(`${method}:${path}`, operation);
    });
  });

  const controllers = new Map<string, VisualController>();
  const middlewares = new Map<string, VisualMiddleware>();
  const routes: VisualRoute[] = [];

  const controllerNode = ($: AomApi, depth: number): VisualController => {
    const id = $._.target.name;
    let node = controllers.get(id);
    if (!node) {
      const parent = Object.getPrototypeOf($._.target);
      const parentIsController =
        typeof parent === "function" && !!AomApi.checkExists(parent)?.element.isController;
      node = {
        id,
        title: $.title,
        description: $.description,
        parent: parentIsController ? parent.name : undefined,
        prefixes: [],
        bridges: [],
        parents: [],
        pre: $.element.pre_middlewares.map((one) => one.toString()),
        post: $.element.post_middlewares.map((one) => one.toString()),
        hooks: $.element.instanceHooks.map((one) => one.toString()),
        markers: $.element.markers.map((one) => one.toString()),
        routes: [],
        members: declaredMembers($),
        depth,
      };
      controllers.set(id, node);
    }
    node.depth = Math.min(node.depth, depth);
    return node;
  };

  // обход дерева бриджей — источник иерархии контроллеров и их префиксов
  const walk = ($: AomApi, prefix: string, depth: number, stack: Set<string>) => {
    const node = controllerNode($, depth);
    if (!node.prefixes.includes(prefix)) node.prefixes.push(prefix);

    if (stack.has(node.id)) {
      warnings.push(`цикл бриджей на контроллере ${node.id} — ветка не раскрыта`);
      return;
    }
    const nextStack = new Set(stack).add(node.id);

    $.element.bridges.forEach((bridge) => {
      const targetId = bridge.next._.target.name;
      const via = bridge.$._.property ? bridge.$.toString() : undefined;
      if (!node.bridges.some((one) => one.target === targetId && one.prefix === bridge.prefix)) {
        node.bridges.push({ prefix: bridge.prefix, target: targetId, via });
      }
      const nextPrefix = joinPrefix(prefix, bridge.prefix);
      walk(bridge.next, nextPrefix, depth + 1, nextStack);
      const child = controllers.get(targetId);
      if (child && !child.parents.includes(node.id)) child.parents.push(node.id);
    });
  };

  walk(AomApi.instance(target), "/", 0, new Set());

  const chainItem = (cursor: AomCursor): VisualChainItem => ({
    id: cursor.$.toString(),
    cls: cursor.$._.target.name,
    method: cursor.$._.property ? String(cursor.$._.property) : undefined,
    kind: nodeKind(cursor.$),
    origin: cursor.origin.toString(),
    prefix: cursor.prefix,
    index: cursor.index,
    title: cursor.$.title,
    description: cursor.$.description,
  });

  const registerRoute = (route: AomRoute, isWebsocket: boolean) => {
    const path = openApiPath(route);
    const operation = operations.get(`${route.method}:${path}`) ?? {};
    const chain = route.cursors.map(chainItem);
    const endpoint = route.endpoint.$;
    const controllerId = endpoint._.target.name;

    const parameters: VisualParameter[] = (operation.parameters ?? []).map((parameter: any) => ({
      name: parameter.name,
      in: parameter.in,
      required: parameter.required,
      description: parameter.description,
      schema: describeSchema(parameter.schema),
    }));

    const responses: VisualResponse[] = Object.entries(operation.responses ?? {}).map(
      ([status, response]: [string, any]) => {
        const [contentType = "application/json", body] = Object.entries(
          response?.content ?? {},
        )[0] ?? ["application/json", undefined];
        return {
          status,
          description: response?.description,
          contentType,
          schema: describeSchema((body as any)?.schema),
        };
      },
    );

    let requestBody: VisualRequestBody | undefined;
    if (operation.requestBody?.content) {
      const [contentType, body] = Object.entries(operation.requestBody.content)[0] ?? [];
      requestBody = {
        description: operation.requestBody.description,
        contentType: contentType ?? "application/json",
        schema: describeSchema((body as any)?.schema),
      };
    }

    const id = `${route.method} ${path}`;
    const schemas = new Set<string>();
    parameters.forEach((one) => one.schema.ref && schemas.add(one.schema.ref));
    responses.forEach((one) => one.schema.ref && schemas.add(one.schema.ref));
    if (requestBody?.schema.ref) schemas.add(requestBody.schema.ref);

    const visual: VisualRoute = {
      id,
      method: route.method,
      path,
      operationId: operation.operationId ?? endpoint.toString(),
      title: operation.summary ?? endpoint.title,
      description: operation.description ?? endpoint.description,
      tags: operation.tags ?? [],
      controller: controllerId,
      endpoint: endpoint.toString(),
      isWebsocket,
      chain,
      parameters,
      requestBody,
      responses,
      security: (operation.security ?? []).flatMap((one: any) => Object.keys(one)),
      schemas: [...schemas],
      markers: options.skipMarkers ? {} : safeMarkers(route, warnings),
    };

    routes.push(visual);

    const controller = controllers.get(controllerId);
    if (controller) {
      if (!controller.routes.includes(id)) controller.routes.push(id);
    } else {
      // endpoint объявлен в классе, до которого не ведёт ни один бридж от корня —
      // такое бывает при наследовании контроллеров, фиксируем как отдельный узел
      const node = controllerNode(AomApi.instance(endpoint._.target), 0);
      node.routes.push(id);
    }

    chain.forEach((item) => {
      if (item.kind === "endpoint" || item.kind === "websocket") return;
      let node = middlewares.get(item.id);
      if (!node) {
        node = {
          id: item.id,
          cls: item.cls,
          method: item.method,
          kind: item.kind,
          title: item.title,
          description: item.description,
          usedBy: [],
          origins: [],
          schemas: [],
          security: [],
        };
        middlewares.set(item.id, node);
      }
      if (!node.usedBy.includes(id)) node.usedBy.push(id);
      if (!node.origins.includes(item.origin)) node.origins.push(item.origin);
    });
  };

  router.routes.forEach((route) => registerRoute(route, false));
  router.sockets.forEach((route) => registerRoute(route, true));

  // декларации, объявленные на самих звеньях: их видно только в мета-инстансе курсора
  router.routes.concat(router.sockets).forEach((route) => {
    route.cursors.forEach((cursor) => {
      const node = middlewares.get(cursor.$.toString());
      if (!node) return;
      const { security } = cursor.$.openApi;
      if (security) {
        const name = cursor.$._.target.name;
        if (!node.security.includes(name)) node.security.push(name);
      }
      cursor.$.openApi.responses.forEach((response) => {
        const ref = describeSchema(response.schema).ref;
        if (ref && !node.schemas.includes(ref)) node.schemas.push(ref);
      });
    });
  });

  const schemas: VisualSchema[] = Object.entries(components).map(([id, value]) => {
    const required: string[] = Array.isArray(value?.required) ? value.required : [];
    const properties = Object.entries(value?.properties ?? {}).map(([name, property]) =>
      describeProperty(name, property, required),
    );
    return {
      id,
      description: typeof value?.description === "string" ? value.description : undefined,
      properties,
      refs: properties
        .filter((property) => property.ref)
        .map((property) => ({ property: property.name, target: property.ref! })),
      referencedBy: [],
      usedBy: [],
    };
  });

  const schemaIndex = new Map(schemas.map((schema) => [schema.id, schema]));
  schemas.forEach((schema) => {
    schema.refs.forEach((edge) => {
      const target = schemaIndex.get(edge.target);
      if (target && !target.referencedBy.includes(schema.id)) target.referencedBy.push(schema.id);
    });
  });
  routes.forEach((route) => {
    route.schemas.forEach((name) => {
      const schema = schemaIndex.get(name);
      if (schema && !schema.usedBy.includes(route.id)) schema.usedBy.push(route.id);
    });
  });

  const controllerList = [...controllers.values()].sort(
    (a, b) => a.depth - b.depth || a.id.localeCompare(b.id),
  );

  return {
    root: target.name,
    title: options.title ?? target.name,
    builtAt: new Date().toISOString(),
    controllers: controllerList,
    routes: routes.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method)),
    middlewares: [...middlewares.values()].sort((a, b) => b.usedBy.length - a.usedBy.length),
    schemas: schemas.sort((a, b) => a.id.localeCompare(b.id)),
    roots: controllerList.map((one) => one.id),
    stats: {
      controllers: controllerList.length,
      routes: routes.filter((route) => !route.isWebsocket).length,
      websockets: routes.filter((route) => route.isWebsocket).length,
      middlewares: middlewares.size,
      schemas: schemas.length,
      shared: [...middlewares.values()].filter((one) => one.usedBy.length > 1).length,
    },
    warnings,
  };
}

/** `resolve(join(prefix, next))` роутера, но без обращения к node:path */
function joinPrefix(prefix: string, next: string): string {
  const parts = `${prefix}/${next}`.split("/").filter(Boolean);
  return `/${parts.join("/")}`;
}

/**
 * Маркеры — прикладные структуры (например, карта доступов), их пишут сторонние
 * классы. Сериализуем защищённо: одна нештатная структура не должна ронять страницу.
 */
function safeMarkers(route: AomRoute, warnings: string[]): Record<string, unknown> {
  try {
    return JSON.parse(JSON.stringify(route.markers));
  } catch (error) {
    warnings.push(`маркеры ${route.method} ${route.path}: ${(error as Error).message}`);
    return {};
  }
}
