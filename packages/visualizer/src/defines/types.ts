import type { HTTPMethods } from "@aom-js/router";

/** Роль узла в цепочке курсоров: тем же словарём подписаны блоки в HTML */
export type VisualNodeKind =
  "controller" | "middleware" | "endpoint" | "websocket" | "nextpoint" | "marker" | "hook";

/** Где объявлен параметр запроса — совпадает с `in` из OpenAPI */
export type VisualParameterIn = "path" | "query" | "header" | "cookie";

/** Ссылка на компонентную схему либо инлайн-описание типа */
export interface VisualSchemaRef {
  /** имя компонентной схемы, если значение свелось к `$ref` */
  ref?: string;
  /** краткая подпись типа для инлайновых схем: `string`, `array<Foo>`, `object` */
  label: string;
  isArray?: boolean;
}

export interface VisualParameter {
  name: string;
  in: VisualParameterIn;
  required?: boolean;
  description?: string;
  schema: VisualSchemaRef;
}

export interface VisualResponse {
  status: string;
  description?: string;
  contentType: string;
  schema: VisualSchemaRef;
}

export interface VisualRequestBody {
  description?: string;
  contentType: string;
  schema: VisualSchemaRef;
}

/** Звено цепочки исполнения маршрута — один курсор роутера */
export interface VisualChainItem {
  /** `Class.method` — совпадает с `AomApi.toString()` */
  id: string;
  cls: string;
  method?: string;
  kind: VisualNodeKind;
  /** класс, в котором курсор был прицеплен к маршруту (`AomCursor.origin`) */
  origin: string;
  prefix: string;
  index: number;
  title?: string;
  description?: string;
}

export interface VisualRoute {
  /** `get /api/orgs/:id` */
  id: string;
  method: HTTPMethods;
  path: string;
  operationId: string;
  title?: string;
  description?: string;
  tags: string[];
  /** контроллер, объявивший endpoint */
  controller: string;
  endpoint: string;
  isWebsocket: boolean;
  chain: VisualChainItem[];
  parameters: VisualParameter[];
  requestBody?: VisualRequestBody;
  responses: VisualResponse[];
  security: string[];
  /** имена компонентных схем, задействованных маршрутом */
  schemas: string[];
  /** данные маркеров маршрута (`AomRoute.markers`), сериализованные как есть */
  markers: Record<string, unknown>;
}

export interface VisualBridge {
  prefix: string;
  target: string;
  /** middleware, обёрнутая вокруг бриджа (`@Bridge` на методе), если есть */
  via?: string;
}

/** Декорированный член контроллера — в том числе не подключённый ни к одному маршруту */
export interface VisualMember {
  id: string;
  method: string;
  kind: VisualNodeKind;
  title?: string;
}

export interface VisualController {
  id: string;
  title?: string;
  description?: string;
  /** класс-родитель, если он тоже контроллер */
  parent?: string;
  /** все префиксы, по которым контроллер смонтирован */
  prefixes: string[];
  bridges: VisualBridge[];
  /** контроллеры, из которых сюда ведут бриджи */
  parents: string[];
  pre: string[];
  post: string[];
  hooks: string[];
  markers: string[];
  /** id маршрутов, объявленных непосредственно в этом контроллере */
  routes: string[];
  /** все декорированные члены класса, включая неподключённые */
  members: VisualMember[];
  /** глубина в дереве бриджей от корня визуализации */
  depth: number;
}

export interface VisualMiddleware {
  id: string;
  cls: string;
  method?: string;
  kind: VisualNodeKind;
  title?: string;
  description?: string;
  /** id маршрутов, в цепочку которых входит это звено */
  usedBy: string[];
  /** контроллеры, в которых звено прицеплено */
  origins: string[];
  /** схемы, объявленные декораторами на самом звене */
  schemas: string[];
  security: string[];
}

export interface VisualSchemaProperty {
  name: string;
  /** подпись типа для колонки таблицы */
  type: string;
  format?: string;
  description?: string;
  required: boolean;
  isArray: boolean;
  nullable?: boolean;
  /** имя связанной компонентной схемы — ребро ER-диаграммы */
  ref?: string;
  enum?: string[];
}

export interface VisualSchema {
  id: string;
  description?: string;
  properties: VisualSchemaProperty[];
  /** исходящие связи: свойство → схема */
  refs: Array<{ property: string; target: string }>;
  /** схемы, ссылающиеся на эту */
  referencedBy: string[];
  /** маршруты, в которых схема встречается */
  usedBy: string[];
}

export interface VisualGraph {
  /** класс, от которого построен граф */
  root: string;
  title: string;
  /** момент сборки в ISO — заполняется на стороне сборщика */
  builtAt: string;
  controllers: VisualController[];
  routes: VisualRoute[];
  middlewares: VisualMiddleware[];
  schemas: VisualSchema[];
  /** имена всех контроллеров, пригодные как значение `root` для пересборки */
  roots: string[];
  stats: {
    controllers: number;
    routes: number;
    websockets: number;
    middlewares: number;
    schemas: number;
    /** звенья, встречающиеся более чем в одном маршруте */
    shared: number;
  };
  warnings: string[];
}

export interface BuildGraphOptions {
  /** заголовок документа; по умолчанию — имя корневого класса */
  title?: string;
  /** базовый OpenAPI-документ для сборщика схем */
  info?: { title?: string; version?: string };
  /** не разбирать маркеры маршрутов (они могут быть тяжёлыми) */
  skipMarkers?: boolean;
}

export interface RenderOptions {
  /** сколько маршрутов должно использовать звено, чтобы считаться общим */
  sharedThreshold?: number;
}
