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

/** Re-exported `openapi3-ts/oas31` document type — the shape `OpenApi`'s constructor and `toJSON()` accept/produce. */
export type { OpenAPIObject };

/**
 * Accumulates an OpenAPI 3.1 document while `Router` builds routes, then renders the
 * final JSON with `toJSON()`. Create one instance, pass it to `new Router(root, docs)`
 * (which calls `registerPath` for every built route), then call `docs.toJSON()` once
 * routing is set up.
 *
 * @example
 * ```ts
 * import { Router, OpenApi } from "@aom-js/router";
 *
 * const docs = new OpenApi({ openapi: "3.1.0", info: { title: "app", version: "1" } });
 * const router = new Router(RootController, docs);
 * const document = docs.toJSON(); // ready to serve at /openapi.json
 * ```
 */
export class OpenApi {
  /** Prefix used for component schema `$ref`s, e.g. `"#/components/schemas/ItemDto"`. */
  static readonly refPointerPrefix = "#/components/schemas/";

  /** String joining merged tag names when `@MergeNextTags` accumulates more than one, e.g. `"Section > Tag"`. */
  static tagsSeparator = " > ";

  private data: OpenAPIObject;

  private tagsSet = new Set<string>();

  private securityMap = new Map<string, OpenApiSecuritySchema>();

  private paths: PathsObject = {};

  private schemer = new Schemer(OpenApi.refPointerPrefix);

  private collector = new SchemasCollector(this.schemer);

  /**
   * @param initData - base OpenAPI document (info, servers, and optionally pre-existing
   *   `components`/`tags`/`paths` to merge with what gets generated — see `toJSON`)
   */
  constructor(initData: OpenAPIObject) {
    // ...
    this.data = initData;
  }

  /**
   * Turns one built `AomRoute` into an OpenAPI operation and stores it under
   * `paths[route.path][route.method]`. Called once per route by `Router`'s
   * constructor — application code normally doesn't call this directly.
   *
   * Walks the route's cursors in order and accumulates, across all of them:
   * - **tags** — the active `TagsRules` (set by `@UseTag` + `@ReplaceNextTags`/
   *   `@MergeNextTags`/`@IgnoreNextTags`) decides whether each tagged cursor replaces,
   *   merges into, or is dropped from the running tag list; the final list is joined
   *   with `OpenApi.tagsSeparator`;
   * - **path parameters** (`@PathParameters`) — the literal path segment key is
   *   replaced with `{name}` in the operation's path;
   * - **other parameters** (`@QueryParameters`/`@CookieParameters`/`@Parameters`);
   * - **responses** (`@Responses`) — keyed by HTTP status, so the last cursor with a
   *   given status wins; `isArray: true` wraps the schema as `{type: "array", items}`;
   * - **security** (`@Security`) — registered once per class name via
   *   `storeSecurityScheme`;
   * - **request body** (`@RequestBody`) — last cursor wins.
   *
   * Every schema passes through `schemaExtract`, which resolves `ThisRef`/`RouteRef`
   * containers and renders component classes to `{$ref}`.
   *
   * @param route - a route built by `Router`
   */
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
    // operation id

    const operationId = `${endpoint.$._.target.name}_${endpoint.$._.property?.toString()}`;
    // create a stub for the current method
    const currentMethod: OperationObject = {
      // carry over the description and title from the direct method
      operationId,
      summary: endpoint.$.title,
      description: endpoint.$.description,
      parameters: [],
      responses: {},
      security: [],
    };

    let tags: string[] = []; // tags to merge

    let nextTagRule = TagsRules.REPLACE; // tag-assembly rule, defaults to replace

    // let nextTagRule = constants.NEXT_TAGS_REPLACE; // tag-assembly rule, defaults to replace

    cursors.forEach((cursor: AomCursor) => {
      /*
      const { $ } = cursor;
      const { target, property } = $._;
      // this procedure exists so the delay stack isn't re-run on the same cursor —
      // i.e. within one isolated context it runs exactly once and is then removed from the queue
      if ($.openApi.delayStack.length) {
        while ($.openApi.delayStack.length) {
          const handler = $.openApi.delayStack.shift();
          // run the delayed actions
          if (handler instanceof FwdContainer) {
            Reflect.decorate([...handler.exec()], target, property!);
          } else if (handler instanceof ThisRefContainer) {
            Reflect.decorate([...handler.exec(cursor.$._.target)], target, property!);
          } else if (handler instanceof RouteRefContainer) {
            Reflect.decorate([...handler.exec(cursor.endpoint!.$._.target)], target, property!);
          }
        }
        // apply any pending delayed calls
        $._.apply();
      }
      */

      // console.log("delayStack success started");
      // collect the tags
      const { tag } = cursor.$.openApi;
      if (tag.$) {
        nextTagRule = tag.rule || nextTagRule;
        if (nextTagRule !== TagsRules.IGNORE) {
          const tagName = tag.$.title || tag.$._.target.name;
          // on a tag replacement, overwrite the last value
          if (nextTagRule === TagsRules.REPLACE) {
            tags[tags.length - 1 < 0 ? 0 : tags.length - 1] = tagName;
          } else if (nextTagRule === TagsRules.MERGE) {
            // otherwise append the tag to the list
            tags.push(tagName);
          }
        }
      }

      cursor.$.openApi.path.forEach((structure) => {
        Object.keys(structure).forEach((key) => {
          const value = structure[key];
          // replace the key's value in the path with the corresponding argument placeholder
          path = path.replace(key, `{${value.name}}`);
          const schema = this.schemaExtract(value.schema, cursor);
          // console.log("parse parameters", path, value, schema);
          // maybe this parameter should be checked for having already been processed in this request, to avoid re-adding it
          currentMethod.parameters!.push({ ...value, schema, in: "path", required: true });
        });
      });

      cursor.$.openApi.parameters.forEach((parameter) => {
        // this is where a generic schema parser that extracts and records the relevant values would go
        const schema = this.schemaExtract(parameter.schema, cursor);
        // console.log("parse parameters", parameter, schema);
        // maybe this parameter should be checked for having already been processed in this request, to avoid re-adding it
        currentMethod.parameters!.push({ ...parameter, schema });
      });

      cursor.$.openApi.responses.forEach((response) => {
        // this is where a generic schema parser would go
        const schema = this.schemaExtract(response.schema, cursor);
        const { contentType = "application/json", isArray, description } = response;

        // set the response status to the last value that actually gets returned
        currentMethod.responses![response.status] = {
          description,
          content: {
            [contentType]: { schema: isArray ? { type: "array", items: schema } : schema },
          },
        };
      });

      // if a security scheme is set
      if (cursor.$.openApi.security) {
        // store and extract it from the cursor
        const name = this.storeSecurityScheme(cursor);
        // and record it for the current method
        currentMethod.security!.push({ [name]: [] });
      }

      const { requestBody } = cursor.$.openApi;
      // if the cursor's context expects a request body, record the relevant value
      if (requestBody) {
        const { contentType = "application/json", description } = requestBody;
        const schema = this.schemaExtract(requestBody.schema, cursor);
        currentMethod.requestBody = { description, content: { [contentType]: { schema } } };
      }
    });

    // if any tags were collected
    if (tags.length) {
      // record them for the current method, joined with the separator
      currentMethod.tags = [tags.join(OpenApi.tagsSeparator)];
      // and store into the matching set
      this.tagsSet.add(currentMethod.tags[0]);
    }

    // make sure the path exists
    if (!this.paths[path]) this.paths[path] = {} as HttpMethodOperations;
    // finally add the path and method to the overall list
    Object.assign(this.paths[path], { [method]: currentMethod });
  }

  /** Registers `cursor`'s `@Security` schema once per class name and returns that name for use as the security requirement key. */
  private storeSecurityScheme(cursor: AomCursor): string {
    const { name } = cursor.$._.target;
    if (!this.securityMap.get(name)) {
      this.securityMap.set(name, cursor.$.openApi.security!);
    }
    return name;
  }

  /**
   * Resolves a schema declaration to its rendered form: executes a `ThisRef`/`RouteRef`
   * container if present, then hands the result to `SchemasCollector.extract` (from
   * `@aom-js/schemer`), which turns a component class into `{$ref}` and records its
   * rendered shape in `components.schemas`, or passes a plain schema object through.
   */
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

    // component classes and their cascade of relations are collected by schemer's shared collector
    return this.collector.extract(schema);
  }

  // JSON generator of complete documentation
  /**
   * Renders the final OpenAPI document by merging everything generated from routes
   * with the `initData` passed to the constructor:
   *
   * - **components**: `securitySchemes`/`schemas` from `initData.components` are kept,
   *   generated entries with the same key overwrite them;
   * - **tags**: a tag from `initData` with the same name keeps its `description`;
   *   newly generated tags are appended;
   * - **paths**: methods from `initData.paths` at a path are preserved; a generated
   *   method for the same path+method wins over the one from `initData`.
   *
   * @returns a plain, JSON-serializable OpenAPI document (round-tripped through
   *   `JSON.stringify`/`JSON.parse` to strip any non-serializable leftovers)
   */
  toJSON(): OpenAPIObject {
    // components/tags/paths from initData are merged with the generated ones, on a clash
    // the generated one wins: components — by name, tags — by tag fields, paths — by method
    const { components = {}, tags: initTags = [], paths: initPaths = {} } = this.data;
    // add tags data: a tag's description from initData is kept, new tags are appended
    const tagsMap = new Map(initTags.map((tag) => [tag.name, tag]));
    this.tagsSet.forEach((name) => tagsMap.set(name, { ...tagsMap.get(name), name }));
    const tags: TagObject[] = [...tagsMap.values()];
    // methods from initData at a matching path are kept, a matched method is the generated one
    const paths: PathsObject = { ...initPaths };
    Object.keys(this.paths).forEach((path) => {
      paths[path] = { ...initPaths[path], ...this.paths[path] };
    });
    // add security schemas
    const securitySchemes = { ...components.securitySchemes };
    this.securityMap.forEach((schema, name: string) =>
      Object.assign(securitySchemes, {
        [name]: schema,
      }),
    );
    const schemas = { ...components.schemas };
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
          ...components,
          securitySchemes,
          schemas,
        },
        tags,
        paths,
      }),
    );
  }
}
