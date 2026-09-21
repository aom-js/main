/** A constructor for `T` — the shape every mapped-type helper accepts as its class reference argument. */
export type Type<T = any> = new (...args: any[]) => T;
