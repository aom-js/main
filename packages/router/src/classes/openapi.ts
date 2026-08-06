import { Schemer, SchemasCollector } from "@aom-js/schemer";

import type { OpenAPIObject, OperationObject, PathsObject, TagObject } from "openapi3-ts/oas31";
import {
  FwdContainer,
  ThisRefContainer,
  RouteRefContainer,
  AomRoute,
  AomCursor,
  TagsRules,
  OpenApiPossibleSchema,
  OpenApiSecuritySchema,
  HTTPMethods,
} from "../common";

type HttpMethodOperations = Record<HTTPMethods, OperationObject>;

export type { OpenAPIObject };

export class OpenApi {
  static readonly refPointerPrefix = "#/components/schemas/";

  static tagsSeparator = " > ";

  private data: OpenAPIObject;

  private tagsSet = new Set<string>();

  private securityMap = new Map<string, OpenApiSecuritySchema>();

  private paths: PathsObject = {};

  private schemer = new Schemer(OpenApi.refPointerPrefix);

  private collector = new SchemasCollector(this.schemer);

  constructor(initData: OpenAPIObject) {
    // ...
    this.data = initData;
  }

  registerPath(route: AomRoute): void {
    const { endpoint, cursors } = route;
    let { method, path } = route;
    // const idParts = [];
    // console.log(
    //   "build route openapi",
    //   route.endpoint.$._.target.name,
    //   route.endpoint.$._.property?.toString(),
    //   route.path,
    //   route.method
    // );
    // console.log("================");
    // id операции

    const operationId = `${endpoint.$._.target.name}_${endpoint.$._.property?.toString()}`;
    // создадим заглушку для текущего метода
    const currentMethod: OperationObject = {
      // перенесем из непосредственного метода его описание и название
      operationId,
      summary: endpoint.$.title,
      description: endpoint.$.description,
      parameters: [],
      responses: {},
      security: [],
    };

    let tags: string[] = []; // теги для слияния

    let nextTagRule = TagsRules.REPLACE; // правило сборки тегов, по умолчанию - замена

    // let nextTagRule = constants.NEXT_TAGS_REPLACE; // правило сборки тегов, по умолчанию - замена

    cursors.forEach((cursor: AomCursor) => {
      const { $ } = cursor;

      const { target, property } = $._;
      // такая процедура используется для того, чтобы на одном и том же курсоре не вызывать повторно отложенный стек
      // то есть в изолированном контексте он вызывается однократно, а затем удаляется из очереди
      if ($.openApi.delayStack.length) {
        while ($.openApi.delayStack.length) {
          const handler = $.openApi.delayStack.shift();
          // вызовем отложенные действия
          if (handler instanceof FwdContainer) {
            Reflect.decorate([...handler.exec()], target, property!);
          } else if (handler instanceof ThisRefContainer) {
            Reflect.decorate([...handler.exec(cursor.$._.target)], target, property!);
          } else if (handler instanceof RouteRefContainer) {
            Reflect.decorate([...handler.exec(cursor.endpoint!.$._.target)], target, property!);
          }
        }
        // применим вероятные отложенные вызовы
        $._.apply();
      }

      // console.log("delayStack success started");
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
          // console.log("parse parameters", path, value, schema);
          // возможно тут следует включить проверку на то, что данный параметр уже обработан в данном запросе, и его повторно включать не надо
          currentMethod.parameters!.push({ ...value, schema, in: "path", required: true });
        });
      });

      cursor.$.openApi.parameters.forEach((parameter) => {
        // вот тут нужен универсальный разбор схем, который будет извлекать соответствующие значения и фиксировать их
        const schema = this.schemaExtract(parameter.schema, cursor);
        // console.log("parse parameters", parameter, schema);
        // возможно тут следует включить проверку на то, что данный параметр уже обработан в данном запросе, и его повторно включать не надо
        currentMethod.parameters!.push({ ...parameter, schema });
      });

      cursor.$.openApi.responses.forEach((response) => {
        // вот тут нужен универсальный разбор схем
        const schema = this.schemaExtract(response.schema, cursor);
        const { contentType = "application/json", isArray, description } = response;

        // установим соответствующий статус ответа последним значением, которое в принципе вернётся
        currentMethod.responses![response.status] = {
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
        currentMethod.security!.push({ [name]: [] });
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
      currentMethod.tags = [tags.join(OpenApi.tagsSeparator)];
      // и сохраним в соответствующем сете
      this.tagsSet.add(currentMethod.tags[0]);
    }

    // проверим существование путей
    if (!this.paths[path]) this.paths[path] = {} as HttpMethodOperations;
    // в конце добавим путь и метод в общий список
    Object.assign(this.paths[path], { [method]: currentMethod });
  }

  private storeSecurityScheme(cursor: AomCursor): string {
    const { name } = cursor.$._.target;
    if (!this.securityMap.get(name)) {
      this.securityMap.set(name, cursor.$.openApi.security!);
    }
    return name;
  }

  private schemaExtract(value: OpenApiPossibleSchema, cursor: AomCursor) {
    //
    let schema: any;
    if (value instanceof ThisRefContainer) {
      schema = value.exec(cursor.$._.target);
    } else if (value instanceof RouteRefContainer) {
      schema = value.exec(cursor.endpoint!.$._.target);
    } else {
      schema = value;
    }

    // компонентные классы и их каскад связей собирает общий сборщик из schemer
    return this.collector.extract(schema);
  }

  // JSON generator of complete documentation
  toJSON(): OpenAPIObject {
    // add tags data
    const tags: TagObject[] = [];
    this.tagsSet.forEach((tag) => tags.push({ name: tag }));
    // add security schemas
    const securitySchemes = {};
    this.securityMap.forEach((schema, name: string) =>
      Object.assign(securitySchemes, {
        [name]: schema,
      }),
    );
    const schemas = {};
    this.collector.components.forEach((component, name: string) =>
      Object.assign(schemas, {
        [name]: component,
      }),
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
      }),
    );
  }
}
