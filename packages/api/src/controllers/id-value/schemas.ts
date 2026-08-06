interface IParamIDSchema {
  // регулярное выражение для проверки значения
  regexp: string;

  // схема данных
  schema: () => { type: string; minLength: number; maxLength: number; pattern: string };

  // возвращает оформленное значение параметра
  format: (name: string) => string;

  // возвращает типированное значение
  value: (value: string) => any;
}

export class ParamIDSchema implements IParamIDSchema {
  regexp!: string;

  schema!: () => { type: string; minLength: number; maxLength: number; pattern: string };

  format = (name: string) => `:${name}(${this.regexp})`;

  value = (value: string) => value;
}

/* параметрический блок для обработки идентификаторов number */
export class NumberIDSchema extends ParamIDSchema {
  regexp = "[0-9]{1,12}";

  schema = () => ({
    type: "string",
    minLength: 1,
    maxLength: 12,
    pattern: `^${this.regexp}$`,
  });
}

/* параметрический блок для обработки идентификаторов mongoDB */
export class MongoIDSchema extends ParamIDSchema {
  regexp = "[0-9a-fA-F]{24}";

  schema = () => ({
    type: "string",
    minLength: 24,
    maxLength: 24,
    pattern: `^${this.regexp}$`,
  });
}

export class NanoIDSchema extends ParamIDSchema {
  regexp = "[0-9a-zA-Z-_]{21}";

  schema = () => ({
    type: "string",
    minLength: 21,
    maxLength: 21,
    pattern: `^${this.regexp}$`,
  });
}

export class UUIDSchema extends ParamIDSchema {
  regexp = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

  schema = () => ({
    type: "string",
    minLength: 36,
    maxLength: 36,
    pattern: `^${this.regexp}$`,
  });
}
