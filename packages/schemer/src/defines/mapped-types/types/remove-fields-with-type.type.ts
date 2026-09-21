type KeysWithType<T, Type> = {
  [K in keyof T]: T[K] extends Type ? K : never;
}[keyof T];

/**
 * Used by the mapped-type helpers to drop `Function`-typed keys (e.g. TS's own `Function` fallback
 * for method-shaped members) from their generated return types, so the inferred DTO type only lists
 * real data properties.
 */
export type RemoveFieldsWithType<T, Type> = Exclude<T, KeysWithType<T, Type>>;
