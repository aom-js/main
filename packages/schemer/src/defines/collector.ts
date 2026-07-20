import { Schemer, AomSchemas } from "./module";

/**
 * Сборщик компонентных схем: превращает ComponentSchema-классы в $ref-ссылки,
 * рекурсивно собирая каскад связанных схем (connections) в словарь components.
 * Используется генерацией OpenAPI (router) и дистрибуцией изоляторов (transfer).
 */
export class SchemasCollector {
  readonly components = new Map<string, any>();

  private schemer: Schemer;

  constructor(schemer: Schemer) {
    this.schemer = schemer;
  }

  extract(schema: any): any {
    const saved = AomSchemas.checkExists(schema);
    if (saved && saved.isComponentSchema) {
      const { name } = saved._.target;
      if (!this.components.has(name)) {
        // сначала фиксируем рендер (защита от циклов), затем обходим связи
        this.components.set(name, this.schemer.render(schema));
        saved.connections.forEach((connection) => {
          this.extract(Reflect.apply(connection, null, []));
        });
      }
      return { $ref: `${this.schemer.refPointerPrefix}${name}` };
    }
    return schema;
  }
}
