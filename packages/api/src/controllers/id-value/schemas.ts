interface IParamIDSchema {
  // regular expression used to validate the value
  regexp: string;

  // data schema
  schema: () => { type: string; minLength: number; maxLength: number; pattern: string };

  // returns the formatted parameter value
  format: (name: string) => string;

  // returns the typed value
  value: (value: string) => any;
}

/**
 * Base ID format template used by `IDController`/`IDValue`: a regexp, an OpenAPI schema
 * fragment derived from it, and a value/format conversion. Subclass to define a new ID format,
 * or use one of the ready-made formats below (`UUIDSchema`, `MongoIDSchema`, `NanoIDSchema`,
 * `NumberIDSchema`).
 */
export class ParamIDSchema implements IParamIDSchema {
  regexp!: string;

  schema!: () => { type: string; minLength: number; maxLength: number; pattern: string };

  format = (name: string) => `:${name}(${this.regexp})`;

  value = (value: string) => value;
}

/* parametric block for handling numeric identifiers */
/** ID format for a numeric identifier, 1 to 12 digits (`[0-9]{1,12}`). */
export class NumberIDSchema extends ParamIDSchema {
  regexp = "[0-9]{1,12}";

  schema = () => ({
    type: "string",
    minLength: 1,
    maxLength: 12,
    pattern: `^${this.regexp}$`,
  });
}

/* parametric block for handling mongoDB identifiers */
/** ID format for a MongoDB `ObjectId`: 24 hex characters. */
export class MongoIDSchema extends ParamIDSchema {
  regexp = "[0-9a-fA-F]{24}";

  schema = () => ({
    type: "string",
    minLength: 24,
    maxLength: 24,
    pattern: `^${this.regexp}$`,
  });
}

/** ID format for a NanoID: 21 URL-safe characters. */
export class NanoIDSchema extends ParamIDSchema {
  regexp = "[0-9a-zA-Z-_]{21}";

  schema = () => ({
    type: "string",
    minLength: 21,
    maxLength: 21,
    pattern: `^${this.regexp}$`,
  });
}

/** ID format for a UUID (36 characters, standard dashed hex form). */
export class UUIDSchema extends ParamIDSchema {
  regexp = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

  schema = () => ({
    type: "string",
    minLength: 36,
    maxLength: 36,
    pattern: `^${this.regexp}$`,
  });
}
