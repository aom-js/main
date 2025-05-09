import { AomSchemas } from "@aom/schemer";
import { isClass } from "@aom/core";

// import * as constants from "../common/constants";
// import { Constructor, ICursor, IRoute } from "../common/declares";
// import { getOpenAPIMetadata } from "../common/functions";
// import { getComponentsSchemas, componentsSet, refPointerPrefix } from "./component-schema";
import { OpenAPIObject, OperationObject, PathsObject } from "openapi3-ts/oas31";
import {
  FwdContainer,
  ThisRefContainer,
  RouteRefContainer,
  AomRoute,
  AomCursor,
  TagsRules,
  OpenApiPossibleSchema,
  OpenApiSecuritySchema,
} from "../../common";

// import { toJSONSchema } from "./functions";
// import { getDisplayName } from "../special/display-name";

export class OpenApi {
  static readonly refPointerPrefix = "#/components/schemas/";

  private tagsSeparator = " > ";
  private data: OpenAPIObject;

  private tagsSet = new Set<string>();

  private securityMap = new Map<string, OpenApiSecuritySchema>();

  private componentsMap = new Map();

  private paths: PathsObject = {};

  constructor(initData: OpenAPIObject) {
    // ...
    this.data = initData;
  }

  registerPath(route: AomRoute): void {
    const { endpoint, cursors } = route;
    const { method } = endpoint;
    let { path } = endpoint;
    const idParts = [];

    // id операции
    const operationId = `${endpoint.$._.target.name}_${endpoint.$._.property?.toString()}`;
    // создадим заглушку для текущего метода
    const currentMethod: OperationObject = { operationId };

    // перенесем из непосредственного метода его описание и название
    currentMethod.summary = endpoint.$.title;
    currentMethod.description = endpoint.$.description;
    currentMethod.parameters = [];
    currentMethod.responses = {};
    currentMethod.security = [];

    let tags: string[] = []; // теги для слияния

    let nextTagRule = TagsRules.REPLACE; // правило сборки тегов, по умолчанию - замена

    // let nextTagRule = constants.NEXT_TAGS_REPLACE; // правило сборки тегов, по умолчанию - замена

    cursors.forEach((cursor: AomCursor) => {
      const { $ } = cursor;

      const { target, property } = $._;
      // вызовем отложенные действия
      $.openApi.delayStack.forEach((handler) => {
        if (handler instanceof FwdContainer) {
          Reflect.decorate([...handler.exec()], target, property);
        } else if (handler instanceof ThisRefContainer) {
          Reflect.decorate([...handler.exec(cursor.$._.target)], target, property);
        } else if (handler instanceof RouteRefContainer) {
          Reflect.decorate([...handler.exec(cursor.endpoint.$._.target)], target, property);
        }
      });

      // соберем теги
      const { tag } = cursor.$.openApi;
      if (tag.$) {
        nextTagRule = tag.rule || nextTagRule;
        if (nextTagRule !== TagsRules.IGNORE) {
          const tagName = tag.$.title || tag.$._.target.name;
          // если замена тега, то меняем последнее значение
          if (nextTagRule === TagsRules.REPLACE) {
            tags[tags.length - 1 < 0 ? 0 : tags.length - 1] = tagName;
          } else if (nextTagRule === TagsRules.MERGE) {
            // иначе добавляем теги в список
            tags.push(tagName);
          }
        }
      }

      cursor.$.openApi.path.forEach((structure) => {
        Object.keys(structure).forEach((key) => {
          const value = structure[key];
          // заменим в ссылке значение по ключу на соответствующий формат аргумента
          path = path.replace(key, `{${value.name}}`);
          const schema = this.schemaExtract(value.schema, cursor);
          // возможно тут следует включить проверку на то, что данный параметр уже обработан в данном запросе, и его повторно включать не надо
          currentMethod.parameters.push({ ...value, schema, in: "path", required: true });
        });
      });

      cursor.$.openApi.parameters.forEach((parameter) => {
        // вот тут нужен универсальный разбор схем, который будет извлекать соответствующие значения и фиксировать их
        const schema = this.schemaExtract(parameter.schema, cursor);
        // возможно тут следует включить проверку на то, что данный параметр уже обработан в данном запросе, и его повторно включать не надо
        currentMethod.parameters.push({ ...parameter, schema });
      });

      cursor.$.openApi.responses.forEach((response) => {
        // вот тут нужен универсальный разбор схем
        const schema = this.schemaExtract(response.schema, cursor);
        const { contentType = "application/json", isArray, description } = response;

        // установим соответствующий статус ответа последним значением, которое в принципе вернётся
        currentMethod.responses[response.status] = {
          description,
          content: {
            [contentType]: { schema: isArray ? { type: "array", items: schema } : schema },
          },
        };
      });

      // если установлена протокол безопасности
      if (cursor.$.openApi.security) {
        // сохраним извлечем его из курсора
        const name = this.storeSecurityScheme(cursor);
        // и сохраним для текущего метода
        currentMethod.security.push({ [name]: [] });
      }

      const { requestBody } = cursor.$.openApi;
      // если в контексте курсора установлено ожидание данных в теле запроса, то зафиксируем релевантное значение
      if (requestBody) {
        const { contentType = "application/json", description } = requestBody;
        const schema = this.schemaExtract(requestBody.schema, cursor);
        currentMethod.requestBody = { description, content: { [contentType]: { schema } } };
      }
    });

    // если набраны теги
    if (tags.length) {
      // то зафиксируем их для текущего метода, используя разделитель
      currentMethod.tags = [tags.join(this.tagsSeparator)];
      // и сохраним в соответствующем сете
      this.tagsSet.add(currentMethod.tags[0]);
    }

    // в конце добавим путь и метод в общий список
    if (!this.paths[path]) this.paths[path] = {};
    this.paths[path][method] = currentMethod;
  }

  private storeSecurityScheme(cursor: AomCursor): string {
    const { name } = cursor.$._.target;
    if (!this.securityMap.get(name)) {
      this.securityMap.set(name, cursor.$.openApi.security);
    }
    return name;
  }

  private schemaExtract(value: OpenApiPossibleSchema, cursor: AomCursor) {
    //
    let schema: any;
    if (value instanceof ThisRefContainer) {
      schema = value.exec(cursor.$._.target);
    } else if (value instanceof RouteRefContainer) {
      schema = value.exec(cursor.endpoint.$._.target);
    } else {
      schema = value;
    }

    // проверим, что данная схема существует в качестве сохраненного значения в компонентной базе
    const savedComponentSchema = AomSchemas.checkExists(schema);
    if (savedComponentSchema && savedComponentSchema.schemer) {
      const { name } = savedComponentSchema._.target;
      if (!this.componentsMap.get(name)) {
        this.componentsMap.set(name, savedComponentSchema.schemer.render(schema));
        // пройдёмся по всем собственным соединениям, и добавим в схемы соответствующие значения
        savedComponentSchema.connections.forEach((schema) => {
          // если схема не является классом, значит эт функция, и для её получения надо её запустить
          if (!isClass(schema)) {
            schema = Reflect.apply(schema, null, []);
          }
          // далее рекурсивно применим ту же самую процедуру, чтобы зафиксировать соответствующее значение в карте
          // результат никак не обрабатываем, подразумеваем, что он будет в схемах, которые отрендерятся стандартным образом
          this.schemaExtract(schema, cursor);
        });
      }
      return { $ref: `${OpenApi.refPointerPrefix}${name}` };
    } else {
      return schema;
    }
  }

  /*
 
  buildParameter(parameter, cursor, route) {
    const result = parameter;

    let schema;
    if (parameter.schema instanceof ThisRefContainer) {
      schema = parameter.schema.exec(cursor.constructor);
    } else if (parameter.schema instanceof RouteRefContainer) {
      schema = parameter.schema.exec(route.constructor);
    } else {
      schema = parameter.schema;
    }
    return { ...result, schema };
  }

  buildResponses(responses) {
    const result = {};
    responses.forEach((responseData) => {
      const { response, cursor, route } = responseData;
      const { status, description, isArray = false } = response;
      const { contentType = "application/json" } = response;
      const contentSchema = {};
      let schema;
      if (response.schema instanceof ThisRefContainer) {
        schema = response.schema.exec(cursor.constructor);
      } else if (response.schema instanceof RouteRefContainer) {
        schema = response.schema.exec(route.constructor);
      } else {
        schema = response.schema;
      }

      if (componentsSet.has(schema)) {
        // const { name } = schema;
        const name = getDisplayName(schema);
        const $ref = `${refPointerPrefix}${name}`;
        if (isArray) {
          Object.assign(contentSchema, {
            schema: { type: "array", items: { $ref } },
          });
        } else {
          Object.assign(contentSchema, { schema: { $ref } });
        }
      } else {
        if (isArray) {
          Object.assign(contentSchema, {
            schema: { type: "array", items: toJSONSchema(schema) },
          });
        } else {
          Object.assign(contentSchema, { schema: toJSONSchema(schema) });
        }
      }

      const content = { [contentType]: contentSchema };
      result[status] = { description, content };
    });

    return result;
    // return undefined;
  }

  buildRequestBody(requestBody, cursor, route) {
    const result = {};

    const { contentType = "application/json", description } = requestBody;

    let schema;
    if (requestBody.schema instanceof ThisRefContainer) {
      schema = requestBody.schema.exec(cursor.constructor);
    } else if (requestBody.schema instanceof RouteRefContainer) {
      schema = requestBody.schema.exec(route.constructor);
    } else {
      schema = requestBody.schema;
    }

    const contentSchema = {};
    // Object.assign(contentSchema, { schema });
    // 
    // if (componentsSet.has(schema)) {
    //   // const { name } = schema;
    //   const name = getDisplayName(schema);
    //   Object.assign(contentSchema, {
    //     schema: { $ref: `${refPointerPrefix}${name}` },
    //   });
    // } else {
    //   Object.assign(contentSchema, { schema: toJSONSchema(schema) });
    // }
    // 
    const content = { [contentType]: contentSchema };
    Object.assign(result, { content });
    if (description) {
      Object.assign(result, { description });
    }
    return result;
    // return undefined;
  }
    */

  // JSON generator of complete documentation
  toJSON() {
    // add tags data
    const tags = [];
    this.tagsSet.forEach((tag) => tags.push({ name: tag }));
    // add security schemas
    const securitySchemes = {};
    this.securityMap.forEach((schema, name: string) =>
      Object.assign(securitySchemes, {
        [name]: schema,
      })
    );
    const schemas = {};
    this.componentsMap.forEach((component, name: string) =>
      Object.assign(schemas, {
        [name]: component,
      })
    );
    //
    return JSON.parse(
      JSON.stringify({
        ...this.data,
        components: {
          securitySchemes,
          schemas,
        },
        tags,
        paths: this.paths,
      })
    );
  }
}
