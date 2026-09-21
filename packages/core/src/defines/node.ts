import { ClassConstructor, ClassType, Property, InstanceTarget } from "./types";
import type { AomCore } from "./core";
import { AomCallstack } from "./callstack";
import type { AomClass, OriginDescriptor } from "./internals";

/** An {@link OriginDescriptor} together with the node/meta-instance it was resolved to, as stored in `AomNode.origins`. */
type NodeOriginDescriptor<T extends AomCore> = { _: AomNode<T>; self: T } & OriginDescriptor;

/**
 * The service part of a meta-instance, reachable as `$._`. Every `AomCore`
 * instance owns exactly one `AomNode`, created by the registry
 * (`AomCore.instance`/`checkExists`) rather than by application code.
 *
 * This is where the mechanics application code actually touches live:
 * `$._.target`/`$._.property`/`$._.root` identify what was decorated,
 * `$._.callstack` holds the not-yet-run decorator calls, and `apply()`/
 * `inherit()` drive execution and metadata inheritance.
 */
export class AomNode<T extends AomCore> {
  private readonly __nominal?: T;

  /** The meta-class whose registry created this instance; used to call `base.instance(...)` for related lookups. */
  base: AomClass<T>;

  /** The owning constructor — always a constructor, whether this node describes the class itself, a static member, or an instance field. */
  target: ClassConstructor;

  /** The decorated property key, if this node describes a property/method rather than the class itself. */
  property?: Property;

  // root structure for the node
  /** The class-level meta-instance: for a property node, the meta-instance of `target` itself; for a class node, `self`. */
  root: T;

  /** The meta-instance this node belongs to. */
  self: T;

  /** What was actually decorated: the class (for statics) or its prototype (for instance members). */
  originInstance: InstanceTarget;

  /**
   * Decorated methods and instance fields collected on the root node only
   * (never on a property node). Populated when a property/method meta-instance
   * is created without an `enumerable` descriptor — i.e. everything except
   * enumerable static data fields, which live in `statics` instead. Consumed
   * by `apply()` and `inherit()` to reach every decorated member of the class.
   */
  origins: NodeOriginDescriptor<T>[];

  // parents whose calls have already been transferred onto this node: a repeated
  // inherit() call for the same parent must not re-run its FIRST queue
  private inherited: WeakSet<ClassType>;

  /** Synthetic meta-instances for instance fields that have no property descriptor of their own, keyed by property name. */
  properties: Map<Property, T>;

  /** Synthetic meta-instances for enumerable static data fields, keyed by property name. */
  statics: Map<Property, T>;

  // stack of calls that need to run
  /** This node's own queues of not-yet-run decorator calls, one per {@link ExecutionPhase}. */
  callstack: AomCallstack<T>;

  constructor(
    self: T,
    base: AomClass<any>,
    target: ClassConstructor,
    property?: Property,
    origin?: OriginDescriptor,
  ) {
    this.self = self;
    this.base = base;
    this.target = target;
    this.property = property;

    this.properties = new Map();
    this.statics = new Map();

    this.origins = [];
    this.inherited = new WeakSet();
    this.callstack = new AomCallstack(this);

    // if a specific property is given, record the link to it on the instance from the original constructor
    if (property) {
      this.root = this.base.instance(target);
      if (origin) {
        this.originInstance = origin.target;
        if (!origin.descriptor?.enumerable) {
          this.root._.origins.push({ _: this, self, ...origin });
        }
      }
    } else {
      this.root = this.self;
    }
  }

  /**
   * Runs every deferred (`LAST`/`DELAY`) decorator call collected on this
   * node and on every member it owns, in a fixed order: synthetic instance
   * field nodes (`properties`), then synthetic static field nodes
   * (`statics`), then decorated methods/fields (`origins`), and finally this
   * node's own queue. Call this on the root node — decorators declared with
   * `LAST`/`DELAY` never run unless something calls `apply()` on the class.
   *
   * @example
   * ```ts
   * import { AomCore, ExecutionPhase } from "@aom-js/core";
   *
   * class Meta extends AomCore {}
   * const Late = () => Meta.methodDecorator(($) => console.log("ran"), ExecutionPhase.LAST);
   *
   * class Service {
   *   \@Late()
   *   static run() {}
   * }
   *
   * Meta.instance(Service)._.apply(); // only now does "ran" print
   * ```
   */
  apply() {
    // run all deferred actions on own properties
    this.properties.forEach(($) => {
      $._.callstack.apply();
    });

    // run all deferred actions on static properties
    this.statics.forEach(($) => {
      $._.callstack.apply();
    });

    // walk everything by descriptor
    this.origins.forEach(({ _ }) => {
      // this.base.instance(descriptor.value)._.callstack.apply();
      _.callstack.apply();
    });

    // run this node's own deferred calls
    this.callstack.apply();
  }

  /**
   * Transfers `parent`'s decorator metadata onto this node's meta-instance,
   * so a subclass ends up carrying its parent's decorator behaviour. Two
   * things happen, in order:
   *
   * 1. `parent`'s own callstack is transferred to `this.self`
   *    (`AomCallstack.transferTo`): `FIRST` calls re-run immediately in the
   *    subclass's context, `LAST`/`DELAY` calls are queued for the
   *    subclass, and calls marked constructor-parameter are dropped if the
   *    subclass has its own decorated constructor parameters.
   * 2. Every decorated property/method in `parent._.origins` is transferred
   *    to the subclass, unless the subclass already owns that property
   *    (checked both physically via `Object.hasOwn` and via the
   *    `statics`/`properties` registry maps, since instance fields have no
   *    physical presence on the prototype). Transferring a method creates a
   *    curried copy on the subclass — a *different* function with its own
   *    meta-instance, so `Child.run !== Parent.run`; `this` inside the copy
   *    is whatever the copy itself was called with (the subclass for
   *    statics, the instance for prototype methods).
   *
   * Calling `inherit()` twice with the same `parent` is a no-op the second
   * time (tracked via `inherited`) — otherwise `FIRST` calls would fire
   * again on every repeated call.
   *
   * @param parent - the parent class (or function) whose metadata to transfer
   * @returns the parent's meta-instance, e.g. for chaining further calls to `parent`'s node
   *
   * @example
   * ```ts
   * import { AomCore } from "@aom-js/core";
   *
   * class Meta extends AomCore {}
   * const Mark = (label: string) => Meta.classDecorator(($) => console.log(label));
   *
   * \@Mark("parent")
   * class Base {}
   * class Controller extends Base {}
   *
   * Meta.instance(Controller)._.inherit(Base); // re-runs "parent" in Controller's context
   * ```
   */
  inherit(parent: ClassType) {
    const $parent = this.base.instance(parent);

    // a repeated inherit() call for the same parent must not re-run its FIRST queue
    if (this.inherited.has(parent)) {
      return $parent;
    }
    this.inherited.add(parent);

    // transfer the parent's own calls onto the final subclass
    $parent._.callstack.transferTo(this.self);

    const transferDescritorWithDecorators = (
      target: InstanceTarget,
      property: Property,
      source: T,
      descriptor?: PropertyDescriptor,
    ) => {
      if (descriptor && descriptor.value) {
        // currying is required here, otherwise the context of the original parent
        // class's descriptor would get overwritten
        // this is forwarded to the caller (not bound to null): for statics that's the
        // concrete class, for a prototype method the instance it was called on
        const curriedDescriptor = function (this: any, ...args: any[]) {
          return Reflect.apply(descriptor.value, this, args);
        };
        // define it
        Reflect.defineProperty(target, property, {
          ...descriptor,
          value: curriedDescriptor,
        });
      }
      const $childInstance = this.base.instance(target, property as string);
      // and here the corresponding transfer of all decorators must happen, by
      // transferring the relevant values in the callstack
      source._.callstack.transferTo($childInstance);
    };

    // console.log (this.properties);
    // transfer decorated data from static properties and methods
    $parent._.origins.forEach((origin) => {
      const $origin = origin.descriptor ? this.base.instance(origin.descriptor.value) : origin.self;
      const isClassOrigin = origin.target === $origin._.target;

      const property = $origin._.property!;

      // Transfer is blocked if the subclass already owns the property. There are two
      // checks, and both are needed: Object.hasOwn covers statics and prototype methods;
      // the AOM registry covers class fields (they don't exist on the prototype/constructor,
      // so the physical check can't see them). The reverse holds too: methods never end up
      // in the registry — instanceKey() keys them by descriptor.value and never touches the
      // statics/properties maps.
      if (
        isClassOrigin &&
        !Object.hasOwn(this.target, property) &&
        !this.root._.statics.get(property)
      ) {
        transferDescritorWithDecorators(this.target, property, $origin, origin.descriptor);
      } else if (
        !isClassOrigin &&
        !Object.hasOwn(this.target.prototype, property) &&
        !this.root._.properties.get(property)
      ) {
        // otherwise check that this is a property of the instance itself, and the corresponding transfers need to be created
        transferDescritorWithDecorators(
          this.target.prototype,
          property,
          $origin,
          origin.descriptor,
        );
      } else {
        // console.log(`same property exists ${this.target.name}.${origin.property.toString()}`);
        // errors.push(
        //   new Error(`same property exists ${this.target.name}.${origin.property.toString()}`),
        // );
      }
    });

    return $parent;
  }
}
