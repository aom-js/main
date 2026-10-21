import crypto from "node:crypto";
import { ClassType, ExecutionPhase, Property } from "@aom-js/core";
import {
  Schemer,
  SchemasCollector,
  AomSchemas,
  SCALAR_TYPE_SCHEMAS,
  foldSchemas,
  FoldedSchemas,
} from "@aom-js/schemer";

// local imports
import { Transfer, AomIsolator } from "./main";
import { RxTransfer } from "./rx-transfer";
import {
  IsolatorOptions,
  TopicSchemaArg,
  TopicSchemaType,
  TransferMethodDescriptor,
  TransferServiceDescriptor,
} from "./types";

/**
 * Binds a class to a transport and closes it: every method decorated with `\@ResponseTopic()`/
 * `\@CustomTopic()` gets a topic and a replacement body that publishes to the bus instead of
 * running the original code.
 *
 * Class decorator, phase INSTANT: it is an aggregator (`$._.apply()` runs its deferred LAST
 * queue right here), so unlike FIRST/LAST decorators it is not recorded in `fired` and is
 * **not** carried over to a subclass through `$._.inherit`. `options.distributed` is handled
 * strictly after `$._.apply()`, because the list of isolated methods (`$.isolatedMethods`) is
 * only populated by the deferred `DefineTopics` decorators that `apply()` runs.
 *
 * @param transfer - Configured `Transfer` instance this class publishes to and listens through.
 * @param options - `{ distributed: true }` additionally builds a `TransferServiceDescriptor`
 *   for this class and stores it in `transfer.registryMap`, so other nodes can discover and
 *   call it via `transfer.restore(...)` without importing the class.
 * @returns Class decorator.
 *
 * @example
 * ```ts
 * import { Isolator, ResponseTopic } from "@aom-js/transfer";
 * import transfer from "./transfer";
 *
 * \@Isolator(transfer)
 * export class GoodsService {
 *   \@ResponseTopic()
 *   static async save(id: string): Promise<void> {
 *     // body is never called — it only describes the interface, see \@ResponseTopic
 *   }
 * }
 * ```
 */
export function Isolator(transfer: Transfer, options: IsolatorOptions = {}): ClassDecorator {
  //
  return AomIsolator.classDecorator(($) => {
    $.transfer = transfer;
    $.rx = new RxTransfer(transfer);
    // now run the deferred computations that attach the matching instructions to the relevant properties
    $._.apply();
    // the descriptor is built after apply(): the list of isolated methods is filled by the deferred DefineTopics
    if (options.distributed) distribute($);
  }, ExecutionPhase.INSTANT);
}

/**
 * Marks an isolated method as a distributed queue: the underlying `subscriber` receives
 * `queue: true`, which — depending on the transport — asks the bus to deliver each message
 * to a single executor instead of broadcasting it to every subscribed instance.
 *
 * @returns Method decorator.
 *
 * @example
 * ```ts
 * import { Isolator, CustomTopic, IsQueue } from "@aom-js/transfer";
 * import transfer from "./transfer";
 *
 * \@Isolator(transfer)
 * class QueuedService {
 *   // only one of several running executors handles each call
 *   \@CustomTopic()
 *   \@IsQueue()
 *   static async work(): Promise<void> {}
 * }
 * ```
 */
// marks that a call to this method is a distributed queue (i.e. not handled by every executor)
export function IsQueue() {
  return AomIsolator.methodDecorator(($) => {
    $.queue = true;
  });
}

/**
 * Overrides, for one method, the `responseTimeout` configured on `new Transfer({ responseTimeout })`.
 *
 * The method's value always wins when it is set; the transport's `responseTimeout` is used
 * only when the method has no `\@TopicTimeout` at all — see `RxTransfer.request`, which reads
 * `$.responseTimeout ?? transfer.responseTimeout`. `0` means "wait without a limit" for this
 * method specifically, even if the transport has a finite timeout (and a finite value on the
 * method wins even if the transport's timeout is `0`). The value is stored on the method's
 * meta-instance and is inherited together with the method, like the rest of `AomIsolator`'s
 * fields.
 *
 * Validated at decoration time with the same rule as `Transfer({ responseTimeout })`: an
 * out-of-range or non-integer value throws immediately, rather than producing a `setTimeout`
 * that would fire almost instantly.
 *
 * @param responseTimeout - Response wait time in ms: integer `0…2147483647`. `0` disables the
 *   timeout for this method.
 * @returns Method decorator.
 * @throws {RangeError} When `responseTimeout` is not an integer in `0…2147483647`.
 *
 * @example
 * ```ts
 * import { Isolator, ResponseTopic, TopicTimeout } from "@aom-js/transfer";
 * import transfer from "./transfer"; // new Transfer({ ..., responseTimeout: 30_000 })
 *
 * \@Isolator(transfer)
 * class Orders {
 *   // shorter than the transport default — this call cannot wait as long as the rest
 *   \@TopicTimeout(2000)
 *   \@ResponseTopic()
 *   static async charge(orderId: string): Promise<void> {}
 * }
 * ```
 */
export function TopicTimeout(responseTimeout: number): MethodDecorator {
  // outside integer 0…2^31−1 ms setTimeout fires after 1 ms — the method would immediately fail with a timeout
  if (
    !Number.isInteger(responseTimeout) ||
    responseTimeout < 0 ||
    responseTimeout > 2_147_483_647
  ) {
    throw new RangeError(
      `@TopicTimeout: responseTimeout must be an integer 0…2147483647 ms, got ${responseTimeout}`,
    );
  }
  return AomIsolator.methodDecorator(($) => {
    $.responseTimeout = responseTimeout;
  });
}

/** Validates one `\@TopicSchema` type: a scalar name, a `\@ComponentSchema` class, or `[T]`. Throws on mismatch. */
// type check for @TopicSchema: a scalar name, a @ComponentSchema class, or [T]
function assertTopicSchemaType(type: TopicSchemaType, context: string): void {
  if (typeof type === "string") {
    if (!SCALAR_TYPE_SCHEMAS[type]) {
      throw new Error(
        `@TopicSchema ${context}: unknown scalar type "${type}" (allowed: ${Object.keys(SCALAR_TYPE_SCHEMAS).join(", ")})`,
      );
    }
    return;
  }
  if (Array.isArray(type)) {
    if (type.length !== 1) {
      throw new Error(
        `@TopicSchema ${context}: array type must hold exactly one element type, e.g. ["string"]`,
      );
    }
    assertTopicSchemaType(type[0], context);
    return;
  }
  if (typeof type === "function" && AomSchemas.checkExists(type)?.isComponentSchema) {
    return;
  }
  const shown = typeof type === "function" ? type.name : String(type);
  throw new Error(`@TopicSchema ${context}: "${shown}" is not a @ComponentSchema-decorated class`);
}

/**
 * Describes the argument and return signature of an isolated method for the service
 * descriptor built by `\@Isolator(transfer, { distributed: true })`.
 *
 * `args` is an array of `{ name: type }` pairs, exactly one per argument, in signature
 * order and with unique names — code generation rebuilds the parameter list from these
 * names. A type is a scalar name (`"string" | "number" | "integer" | "boolean" | "date"`),
 * a `\@ComponentSchema`-decorated class, or `[T]` for a single-element array type.
 *
 * There are three distinguishable method states: described (`args` is an array), explicitly
 * "no arguments" (`\@TopicSchema({})` → `args: []` in the descriptor), and "not described" (no
 * decorator at all → no `args` field in the descriptor whatsoever — a `console.warn` is
 * printed when the service is distributed). Consumers of the descriptor must treat these as
 * distinct states.
 *
 * All validation happens at decoration time, not later: an undecorated class, an unknown
 * scalar name, a duplicate argument name, or more than one pair per `args` entry throws
 * immediately with a `\@TopicSchema Class.method:` prefix.
 *
 * Deliberately a method decorator, not a per-parameter one, for compatibility with stage-3
 * decorators (which have no parameter decorators).
 *
 * @param schema - `args` — ordered argument types; `returns` — return type, omitted for `void`.
 * @returns Method decorator.
 * @throws {Error} When a type is invalid, an argument name repeats, or an `args` entry does
 *   not hold exactly one `{ name: type }` pair.
 *
 * @example
 * ```ts
 * import { Isolator, ResponseTopic, TopicSchema } from "@aom-js/transfer";
 * import { ComponentSchema, PropertySchema } from "@aom-js/schemer";
 * import transfer from "./transfer";
 *
 * \@ComponentSchema()
 * class GoodDto {
 *   \@PropertySchema.String({})
 *   name!: string;
 * }
 *
 * \@Isolator(transfer, { distributed: true })
 * class GoodsService {
 *   \@ResponseTopic()
 *   \@TopicSchema({ args: [{ good: GoodDto }], returns: GoodDto })
 *   static async save(good: GoodDto): Promise<GoodDto> {
 *     return undefined as never;
 *   }
 * }
 * ```
 */
export function TopicSchema(schema: {
  args?: TopicSchemaArg[];
  returns?: TopicSchemaType;
}): MethodDecorator {
  return AomIsolator.methodDecorator(($) => {
    const method = `${$._.target.name}.${String($._.property)}`;
    const args = schema.args || [];
    const seen = new Set<string>();
    args.forEach((entry) => {
      const pairs = Object.entries(entry);
      if (pairs.length !== 1) {
        throw new Error(
          `@TopicSchema ${method}: each args entry must hold exactly one { name: type } pair`,
        );
      }
      const [name, type] = pairs[0];
      if (seen.has(name)) {
        throw new Error(`@TopicSchema ${method}: duplicate argument name "${name}"`);
      }
      seen.add(name);
      assertTopicSchemaType(type, `${method}(${name})`);
    });
    if (schema.returns !== undefined) {
      assertTopicSchemaType(schema.returns, `${method} returns`);
    }
    $.argsSchemas = args;
    $.returnsSchema = schema.returns;
  });
}

/**
 * Builds the serializable service descriptor for a distributed isolator
 * (`\@Isolator(transfer, { distributed: true })`) and stores it in `transfer.registryMap`.
 *
 * Called synchronously by `Isolator`'s INSTANT handler, right after `$._.apply()` — by that
 * point `$.isolatedMethods` is populated by the deferred `DefineTopics` decorators. Component
 * schemas are rendered by `SchemasCollector`; a method without `\@TopicSchema` gets a
 * `console.warn` and no `args` field. `hash` is a sha256 of `{ methods, components, schemas }`.
 */
function distribute($: AomIsolator) {
  const { transfer } = $;
  const collector = new SchemasCollector(new Schemer(Transfer.refPointerPrefix));

  const methods = $.isolatedMethods.map((method$) => {
    const method: TransferMethodDescriptor = {
      name: String(method$._.property),
      topic: method$.topic,
      waitForResponse: !!method$.waitForResponse,
      singleton: !!method$.singletone,
      queue: !!method$.queue,
    };
    // args is written only for methods described via @TopicSchema: a missing field is
    // the "signature unknown" marker for consumers of the descriptor (code generation).
    // The wire format mirrors the decorator: [{ name: JSON Schema }]
    if (method$.argsSchemas) {
      method.args = method$.argsSchemas.map((entry) => {
        const [name, type] = Object.entries(entry)[0];
        return { [name]: collector.extract(type) };
      });
    } else {
      console.warn(`distributed method "${$._.target.name}.${method.name}" has no @TopicSchema`);
    }
    // returns is added only when present — the descriptor must round-trip through JSON without loss
    if (method$.returnsSchema) {
      method.returns = collector.extract(method$.returnsSchema);
    }
    return method;
  });

  const components: Record<string, any> = {};
  collector.components.forEach((schema, name) => {
    components[name] = schema;
  });

  // own schema format for codegen (KI-CODEGEN-01) — built from the same classes that produced components;
  // with no components it's an empty format 1, so the "new descriptor" marker is always present
  let schemas: FoldedSchemas;
  try {
    schemas = foldSchemas(collector.classes.values());
  } catch (error) {
    throw new Error(`distributed service "${$._.target.name}": ${(error as Error).message}`, {
      cause: error,
    });
  }

  const { instanceName, instanceKey } = transfer;
  const descriptor: TransferServiceDescriptor = {
    name: $._.target.name,
    origin: { instanceName, instanceKey },
    hash: crypto
      .createHash("sha256")
      .update(JSON.stringify({ methods, components, schemas }))
      .digest("hex"),
    methods,
    components,
    schemas,
  };

  transfer.registryMap.set(descriptor.name, descriptor);
}

/**
 * Turns a static method into a fire-and-forget isolated topic: the call publishes a message
 * and returns immediately (the returned `Promise` resolves to an rxjs `Subscription`, not a
 * result). The bus still sends a response behind the scenes so the request stream completes
 * and its callback/timer get cleaned up, but nothing surfaces it to the caller — an executor
 * error, a delivery failure or a response timeout all go to `transfer.defaultErrorHandler`
 * instead.
 *
 * The method body is never executed; the decorator replaces it with the publish/subscribe
 * logic (see `AutoTopic`). Values arriving on the reply topic (and, for the executor side of
 * this topic, the request itself) are applied to the handler without checking where the
 * message came from — see `RxTransfer.execHandler`.
 *
 * @param singletone - When true, concurrent calls with identical arguments to the same
 *   address are deduplicated into a single publish (see `RxTransfer.request`).
 * @returns Method decorator.
 *
 * @example
 * ```ts
 * import { Isolator, CustomTopic } from "@aom-js/transfer";
 * import transfer from "./transfer";
 *
 * \@Isolator(transfer)
 * export class IsolatedPusher {
 *   \@CustomTopic()
 *   static async SendMessage(loginId: string, message: string): Promise<void> {}
 * }
 * ```
 */
export function CustomTopic(singletone?: boolean): MethodDecorator {
  return AutoTopic(false, singletone);
}

/**
 * Turns a static method into a request/response isolated topic: the call publishes a message
 * and returns a `Promise` that resolves with the executor's result, or rejects with the
 * executor's error (re-thrown from the `{name, message, status, data}` envelope — see
 * `RxTransfer.execHandler`) or with `TransferTimeoutError` if `responseTimeout` elapses first.
 *
 * The method body is never executed; the decorator replaces it (see `AutoTopic`). Arguments
 * received by the executor come straight from the bus message and are applied to the handler
 * without checking their origin — validating a message's provenance is a known gap, see
 * `https://github.com/aom-js/main/issues/1`.
 *
 * @param singletone - When true, concurrent calls with identical arguments to the same
 *   address share one in-flight request and resolve/reject together (see `RxTransfer.request`).
 * @returns Method decorator.
 *
 * @example
 * ```ts
 * import { Isolator, ResponseTopic, Executor } from "@aom-js/transfer";
 * import transfer from "./transfer";
 *
 * \@Isolator(transfer)
 * export class GoodsService {
 *   \@ResponseTopic()
 *   static async save(id: string): Promise<void> {}
 * }
 *
 * \@Executor()
 * class GoodsExecutor extends GoodsService {
 *   static async save(id: string) {
 *     // real implementation — runs on the node(s) subscribed via \@Executor
 *   }
 * }
 *
 * await GoodsService.save("g1"); // resolves once the executor answers
 * ```
 */
export function ResponseTopic(singletone?: boolean): MethodDecorator {
  return AutoTopic(true, singletone);
}

/**
 * Deferred (LAST phase) part of `AutoTopic`: computes the method's `topic`/`replyTopic`
 * (`${Class}.${method}` and `reply_${topic}_${instanceKey}_${instanceName}`), registers the
 * method in `$._.root.isolatedMethods`, and caches the pair in `topicsMap`/`instancesMap`
 * keyed by the (already replaced) method function. Runs once `\@Isolator` calls `$._.apply()`.
 */
function DefineTopics() {
  return AomIsolator.methodDecorator(($, _descriptor) => {
    const { topicsMap, instancesMap } = $._.root;
    const constructor = $._.target;
    const propertyKey = $._.property!; // methodDecorator — property is always set

    // Add the method to the list of isolated methods
    $._.root.isolatedMethods.push($);

    const handler = Reflect.get(constructor, propertyKey);

    const defineTopics = (transfer: Transfer) => {
      // Get the configured isolator and the topic map
      let topics = topicsMap.get(handler);
      if (!topics) {
        // build the topic from the class and method name, and store it in the map keyed by the method itself
        const { name } = $._.target;
        const topic = `${name}.${String($._.property)}`;
        const replyTopic = `reply_${topic}_${transfer.instanceKey}_${transfer.instanceName}`;
        topics = { topic, replyTopic };
        // store the values in the corresponding maps
        topicsMap.set(handler, topics);
        instancesMap.set(handler, $);
        // // Initialize the reply subscription
        // initReplySubscription(topics, transfer);
      }

      return topics;
    };

    const { transfer, rx } = $._.root;
    const { topic, replyTopic } = defineTopics(transfer);
    $.topic = topic;
    $.replyTopic = replyTopic;
  }, ExecutionPhase.LAST);
}

/**
 * Shared implementation behind `\@ResponseTopic`/`\@CustomTopic`. Method decorator, phase
 * FIRST: sets `$.singletone`/`$.waitForResponse`, schedules the deferred `DefineTopics()` via
 * `Reflect.decorate`, and replaces `descriptor.value` with a stub that forwards every call to
 * `rx.request(args, $)` — the original method body is never invoked again, at call time or
 * after the response arrives.
 *
 * @param waitForResponse - True for `\@ResponseTopic` (caller awaits the executor's result),
 *   false for `\@CustomTopic` (caller does not).
 * @param singletone - Deduplicate concurrent calls with identical arguments to the same address.
 * @returns Method decorator.
 */
function AutoTopic(waitForResponse: boolean, singletone = false): MethodDecorator {
  return AomIsolator.methodDecorator(($, descriptor) => {
    const constructor = $._.target;
    const propertyKey = $._.property!; // methodDecorator — property is always set

    $.singletone = singletone;
    $.waitForResponse = waitForResponse;
    // register the decorator right away; it runs a bit later
    Reflect.decorate([DefineTopics()], constructor, propertyKey);

    // Override the original method: the isolator's body is just an interface and is never called
    descriptor.value = async (...args: any[]) => {
      const { rx } = $._.root;

      return rx.request(args, $);
    };
  }, ExecutionPhase.FIRST);
}

/**
 * Marks a subclass of an isolator as its executor: for every method the parent declared with
 * `\@ResponseTopic`/`\@CustomTopic`, subscribes this class's own implementation to the matching
 * topic (via `attachIsolation`). A method the parent isolated but this subclass does not
 * override is skipped with a `console.warn` — it stays without an executor.
 *
 * Class decorator, phase INSTANT: subscriptions are created once, at decoration time, and are
 * **not** replayed on further inheritance (same as `\@Isolator`). Only static methods can be
 * isolated, so only static overrides on the executor are picked up.
 *
 * Messages an executor's handler is invoked with come straight off the bus and are applied to
 * the method without checking where they originated — see `https://github.com/aom-js/main/issues/1`.
 *
 * @param instanceId - Optional address suffix. When set, this executor only receives calls
 *   made through `Transfer.toInstance(Class, instanceId)`; several executors with different
 *   `instanceId`s can serve the same isolator, and one without an id receives unaddressed calls.
 * @returns Class decorator.
 *
 * @example
 * ```ts
 * import { Isolator, CustomTopic, Executor } from "@aom-js/transfer";
 * import transfer from "./transfer";
 *
 * \@Isolator(transfer)
 * export class IsolatedPusher {
 *   \@CustomTopic()
 *   static async SendMessage(loginId: string, message: string): Promise<void> {}
 * }
 *
 * \@Executor()
 * class PusherExecutor extends IsolatedPusher {
 *   static async SendMessage(loginId: string, message: string): Promise<void> {
 *     // real work happens here
 *   }
 * }
 * ```
 */
export function Executor(instanceId?: string): ClassDecorator {
  return AomIsolator.classDecorator(($) => {
    const constructor = $._.target;
    const parent$ = AomIsolator.instance(Object.getPrototypeOf(constructor));

    // Set up a handler for each isolated method
    parent$.isolatedMethods.forEach((_$) => {
      const { property } = _$._;
      if (property) {
        if (Reflect.getOwnPropertyDescriptor(constructor, property)) {
          //
          attachIsolation(constructor, property, instanceId);
        } else {
          console.warn(`isolated property "${<string>property}" has no executor`);
        }
      }
    });
  }, ExecutionPhase.INSTANT);
}

/**
 * Subscribes one executor method to its isolated topic. Looks up the topic and meta-instance
 * the parent isolator registered for `propertyKey` (they are always set together by
 * `DefineTopics`), builds the address with `Transfer.instanceTopic(topic, instanceId)`, and
 * subscribes `rx.execHandler(...)` to it, running the executor's own implementation with
 * `this = constructor`.
 *
 * @param constructor - Executor class (the subclass, not the isolator).
 * @param propertyKey - Name of the isolated static method.
 * @param instanceId - Optional address suffix, see `Executor`.
 * @throws {Error} When `propertyKey` is not an isolated topic of the parent (topic/meta-instance missing).
 */
function attachIsolation(constructor: ClassType, propertyKey: Property, instanceId?: string) {
  const parentConstructor = Object.getPrototypeOf(constructor);
  const parent$ = AomIsolator.instance(parentConstructor);
  const { name } = constructor;
  // Get the isolator and the topic map
  const { transfer, rx, topicsMap, instancesMap } = parent$;
  const isolatedTopics = topicsMap.get(parentConstructor[propertyKey]);

  const parentProperty$ = instancesMap.get(parentConstructor[propertyKey]);

  // Check that the topic and its associated instance exist — they are registered together
  if (!isolatedTopics || !parentProperty$) {
    throw new Error(`attached handler is not isolated topic ${name}.${String(propertyKey)}`);
  }
  const { topic } = isolatedTopics;
  // Build the topic taking the instance id into account
  const instanceTopic = Transfer.instanceTopic(topic, instanceId);
  // Subscribe to the topic and bind it to the execution method
  const handle = transfer.subscriber({
    topic: instanceTopic,
    next: rx.execHandler((...args: any[]) =>
      Reflect.apply(Reflect.get(constructor, propertyKey), constructor, args),
    ),
    queue: parentProperty$.queue,
  });
  // the handle lets Transfer.stop unsubscribe; a subscriber may return nothing
  if (typeof handle?.unsubscribe === "function") transfer.executorSubscriptions.push(handle);
}
