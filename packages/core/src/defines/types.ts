export declare type ClassConstructor<T extends any = {}> = new (...args: any[]) => T;
export declare type ClassType = ClassConstructor | Function;
export declare type Property = string | symbol;

export declare type InstanceTarget = ClassType | InstanceType<ClassConstructor>;

/** комбинированый декоратор: для статичного метода или для класса */
export declare type CombinedDecorator = <T>(
  target: ClassType,
  propertyKey?: Property,
  descriptor?: TypedPropertyDescriptor<T>,
) => void;

export enum ExecutionPhase {
  INSTANT = "instant",
  FIRST = "first",
  LAST = "last",
  DELAY = "delay",
  // TRIGGER = "trigger",
}
