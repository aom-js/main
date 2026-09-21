import { ClassConstructor, InstanceTarget, Property } from "./types";
import type { AomCore } from "./core";

/** Handler signature for {@link AomCore.classDecorator}: receives the class's meta-instance. */
export declare type AomHandler<T extends AomCore> = ($: T) => void;

/** Handler signature for {@link AomCore.combinedDecorator}: `descriptor` is set only for methods. */
export declare type AomCombinedHandler<T extends AomCore> = (
  $: T,
  descriptor?: PropertyDescriptor,
) => void;

/** Handler signature for {@link AomCore.methodDecorator}: always called with the method's descriptor. */
// the handler's return value goes nowhere: add() in core.ts calls it only for its
// side effect, the value from run() is unused
export declare type AomMethodHandler<T extends AomCore> = (
  $: T,
  descriptor: PropertyDescriptor,
) => void;

/** Handler signature for {@link AomCore.propertyDecorator}. */
export declare type AomPropertyHandler<T extends AomCore> = ($: T) => void;

/** Handler signature for {@link AomCore.parameterDecorator}: `parameterIndex` is the constructor/method parameter position. */
export declare type AomParameterHandler<T extends AomCore> = ($: T, parameterIndex: number) => void;

// Helper type combining the constructor signature and AOM's static methods
/** A meta-class: a concrete `AomCore` subclass constructor together with `AomCore`'s static registry/factory methods. */
export type AomClass<T extends AomCore> = ClassConstructor<T> & typeof AomCore;

/** What was actually decorated: the target, the property key, and its descriptor (if any existed yet). */
export type OriginDescriptor = {
  target: InstanceTarget;
  property: Property;
  // descriptor may be absent: class fields don't have one yet at decoration time
  descriptor?: PropertyDescriptor;
};
