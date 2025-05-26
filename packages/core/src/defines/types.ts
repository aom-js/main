export declare type ClassConstructor<T extends any = {}> = new (...args: any[]) => T;
export declare type Constructor = ClassConstructor | Function;
export declare type Property = string | symbol;

export declare type InstanceTarget = Constructor | object;

/** комбинированый декоратор: для статичного метода или для класса */
export declare type CombinedDecorator = <T>(
  target: Constructor,
  propertyKey?: string | symbol,
  descriptor?: TypedPropertyDescriptor<T>
) => void;

export enum DecoratorsQueueStore {
  INSTANT = "instant",
  FIRST = "first",
  LAST = "last",
  DELAY = "delay",
  // TRIGGER = "trigger",
}
