import { AomCore, ClassType, ClassConstructor } from "@aom-js/core";

import {
  TopicSchemaArg,
  TopicSchemaType,
  TransferConfig,
  TransferPublishHandler,
  TransferSubscribeHandler,
  TransferCallbackHandler,
  TransferErrorHandler,
  TransferPublishHandlerArgs,
  TransferTopics,
  InstancesData,
  TransferRegisty,
  TransferServiceDescriptor,
  StructureCollectorFunction,
  StructureReceiveSchema,
} from "./types";
import { RxTransfer } from "./rx-transfer";

/**
 * Meta-instance node for the transfer package: the class-level node holds the isolator's
 * transport and RPC layer plus its registered topics; each method-level node holds the flags
 * and schema set by `@ResponseTopic`/`@CustomTopic`/`@TopicSchema`/`@TopicTimeout`/`@IsQueue`.
 * Not constructed directly — reached through `AomCore.instance`/`$._` from a decorated class
 * or method (see `@aom-js/core`).
 */
export class AomIsolator extends AomCore {
  /** Transport this isolator publishes to and (via its executors) listens through. Set by `@Isolator`. */
  transfer: Transfer;

  /** RPC layer used to publish requests and route responses. Set by `@Isolator`. */
  rx: RxTransfer;

  /** True when the method deduplicates concurrent calls with identical arguments to the same address. */
  singletone: boolean;

  /** True for `@ResponseTopic` (caller awaits a result), false for `@CustomTopic`. */
  waitForResponse: boolean;

  /** Response timeout override set by `@TopicTimeout`; `undefined` = fall back to `Transfer.responseTimeout`. */
  responseTimeout?: number;

  /** Argument schemas (`{ name: type }` per argument) set by `@TopicSchema`; `undefined` = method not described. */
  argsSchemas?: TopicSchemaArg[];

  /** Return-value schema set by `@TopicSchema`. */
  returnsSchema?: TopicSchemaType;

  /** True when `@IsQueue()` marked the method for single-consumer delivery. */
  queue: boolean;

  registry: boolean;

  /** Reply topics this method's `RxTransfer` has already subscribed to, keyed by topic name. */
  replySubscribers: Record<string, boolean> = {};

  /** In-flight/completed request processes on this method, keyed by the dedup process key (see `RxTransfer.request`). */
  topicProcessMap: Map<string, any> = new Map();

  /** Isolated methods of this class, populated by the deferred `DefineTopics` decorator. */
  isolatedMethods: AomIsolator[] = [];

  /** `{ topic, replyTopic }` per isolated method function, shared between the isolator and its executors. */
  topicsMap: WeakMap<ClassType, TransferTopics> = new WeakMap();

  /** Method meta-instance per isolated method function — the executor side of `topicsMap`. */
  instancesMap: WeakMap<ClassType, AomIsolator> = new WeakMap();

  /** One-shot instance address set by `Transfer.toInstance`; consumed (and cleared) by `instanceTopic`. */
  instanceId?: string;

  /** Topic this method publishes requests to, e.g. `"GoodsService.save"`. Set by `DefineTopics`. */
  topic: string;

  /** Topic this node's `RxTransfer` listens on for responses. Set by `DefineTopics`. */
  replyTopic: string;

  /**
   * Resolves `topic` with the pending one-shot `instanceId`, if any, and clears it immediately —
   * the address is consumed by the very next call, including a deduplicated one, so it never
   * leaks onto a later call to the same class.
   *
   * @param topic - Base topic to address.
   * @returns `topic` with the instance suffix applied, or `topic` unchanged if no address was pending.
   */
  instanceTopic(topic: string) {
    const result = Transfer.instanceTopic(topic, this.instanceId);
    this.instanceId = undefined;
    return result;
  }
}

/**
 * Thrown when an executor's response does not arrive within `responseTimeout`.
 *
 * For `@ResponseTopic` this rejects the caller's `Promise` directly; for `@CustomTopic` (which
 * has no caller waiting on a result) the same error is routed to `transfer.defaultErrorHandler`
 * instead. It only fires when a timer was actually created — `responseTimeout: 0` (on the
 * method via `@TopicTimeout` or on the transport) never creates one, so it never fires.
 *
 * @example
 * ```ts
 * import { TransferTimeoutError } from "@aom-js/transfer";
 *
 * try {
 *   await GoodsService.save("g1");
 * } catch (error) {
 *   if (error instanceof TransferTimeoutError) {
 *     console.error(`no answer on "${error.topic}" after ${error.timeout} ms`);
 *   }
 * }
 * ```
 */
export class TransferTimeoutError extends Error {
  name = "TransferTimeoutError";

  constructor(
    readonly topic: string,
    readonly timeout: number,
  ) {
    super(`transfer response timeout: "${topic}" after ${timeout} ms`);
  }
}

/**
 * Bus-agnostic transport configuration shared by every isolator and executor attached to it.
 *
 * `Transfer` knows nothing about the underlying broker beyond a `publisher`/`subscriber` pair
 * and a node identity (`instanceName`/`instanceKey`); `@Isolator(transfer)` wires classes to a
 * specific instance. One process can hold several `Transfer` instances, e.g. one per broker.
 *
 * @example
 * ```ts
 * import { Transfer } from "@aom-js/transfer";
 * import { StringCodec } from "nats";
 * import nats from "../connections/nats";
 *
 * const sc = StringCodec();
 *
 * export default new Transfer({
 *   instanceKey: process.env.INSTANCE_KEY!,
 *   instanceName: process.env.INSTANCE_NAME!,
 *   publisher: ({ topic, message }) => {
 *     nats.publish(topic, sc.encode(JSON.stringify(message)));
 *   },
 *   subscriber: ({ topic, next }) => {
 *     nats.subscribe(topic, {
 *       callback: (err, message) => next(JSON.parse(sc.decode(message.data))),
 *     });
 *   },
 * });
 * ```
 */
export class Transfer implements TransferConfig {
  /** Instance name — half of this node's identity in the registry protocol and reply topics. */
  // instance name
  instanceName: string;

  /** Instance key — the other half of this node's identity. */
  // instance key
  instanceKey: string;

  /** Publishes a message to a topic; see `TransferConfig.publisher` / `Transfer.prototype.publish`. */
  // function for publishing data
  publisher: TransferPublishHandler;

  /** Subscribes to a topic; see `TransferConfig.subscriber`. */
  // function for subscribing to data
  subscriber: TransferSubscribeHandler;

  // function for retrieving structure information
  private structureCollector?: StructureCollectorFunction;

  /** Pending RPC callbacks awaiting a response, keyed by `uniqKey`. Cleared as responses/timeouts/unsubscribes settle. */
  // map of callbacks for handling responses
  callbackMap: Map<string, TransferCallbackHandler>;

  /** Default response timeout in ms for methods without `@TopicTimeout`; `0` = wait without a limit. See `TransferConfig.responseTimeout`. */
  // executor response wait time, ms; 0 — no limit
  responseTimeout: number;

  /** Where errors with no caller to reject go: executor/timeout/delivery failures for `@CustomTopic`, response-send failures for executors, registry send failures. */
  // handler for errors that have no caller to return to: @CustomTopic, executor response, registry
  defaultErrorHandler: TransferErrorHandler;

  /** `$ref` prefix used when rendering component schemas into a service descriptor. */
  static readonly refPointerPrefix = "#/components/schemas/";

  /** System topic other nodes publish to when asking this node for its distributed descriptors. */
  readonly registryRequestTopic = `!Transfer_Registry_Request!`;
  /** System topic this node publishes to when answering a registry request. */
  readonly registryResponseTopic = `!Transfer_Registry_Notification!`;

  /** Distributed service descriptors, keyed by class name — own descriptors plus cached copies received via the registry protocol. */
  readonly registryMap: Map<string, TransferServiceDescriptor> = new Map();

  /**
   * Configures the transport, validates `responseTimeout`, and immediately subscribes to the
   * two system registry topics (`registryRequestTopic`/`registryResponseTopic`) — the bus must
   * already be ready to accept subscriptions when this constructor runs.
   *
   * @param config - Publisher/subscriber pair, node identity, and the optional timeout/error settings.
   * @throws {RangeError} When `responseTimeout` is not an integer in `0…2147483647`.
   */
  constructor(config: TransferConfig) {
    //
    this.publisher = config.publisher;
    this.subscriber = config.subscriber;

    this.instanceKey = config.instanceKey;
    this.instanceName = config.instanceName;

    this.responseTimeout = config.responseTimeout ?? 30_000;
    // outside integer 0…2^31−1 ms setTimeout fires after 1 ms — every call would immediately fail with a timeout
    if (
      !Number.isInteger(this.responseTimeout) ||
      this.responseTimeout < 0 ||
      this.responseTimeout > 2_147_483_647
    ) {
      throw new RangeError(
        `responseTimeout must be an integer 0…2147483647 ms, got ${this.responseTimeout}`,
      );
    }
    this.defaultErrorHandler =
      config.defaultErrorHandler ?? ((error) => console.error("transfer error", error));

    this.callbackMap = new Map();

    // subscribe to the topic that triggers a reply with the set of existing schemas
    this.subscriber({
      topic: this.registryRequestTopic,
      next: (message) => this.requestRegistry(message.value),
    });

    // subscribe to the topic carrying replies with the set of existing schemas
    this.subscriber({
      topic: this.registryResponseTopic,
      next: (message) => this.acceptRegistry(message.value),
    });
  }

  /**
   * Wraps `publisher` as a `Promise`, so a synchronous throw and a rejected `Promise` from an
   * asynchronous `publisher` both surface as the same kind of rejection to callers. Every
   * internal publish in the package (RPC request, executor response, registry protocol) goes
   * through this method.
   *
   * @param args - `{ topic, message }` to hand to `publisher`.
   * @returns Resolves with whatever `publisher` returned/resolved to; rejects on failure.
   */
  publish(args: TransferPublishHandlerArgs): Promise<unknown> {
    return new Promise((resolve) => resolve(this.publisher(args)));
  }

  /**
   * Routes an error that has no caller left to reject to `defaultErrorHandler`. The handler is
   * invoked right away; if it fails itself (synchronous throw or a rejected `Promise` for an
   * async handler), that failure is only logged via `console.error` — a broken error handler
   * never crashes the process.
   *
   * @param error - Error to report (executor error, `TransferTimeoutError`, delivery failure, etc.).
   */
  reportError(error: Error) {
    new Promise((resolve) => resolve(this.defaultErrorHandler(error))).catch((failure) =>
      console.error("transfer defaultErrorHandler failed", failure, error),
    );
  }

  /**
   * Addresses the *next* isolated call on `constructor` to a specific executor instance. The
   * address is one-shot: `AomIsolator.instanceTopic` reads and clears it as soon as the call is
   * made (even if that call turns out to be a deduplicated singleton), so it never leaks onto a
   * later, unrelated call.
   *
   * @param constructor - Isolator class to address.
   * @param instanceId - Suffix matching the `instanceId` an `@Executor(instanceId)` was
   *   decorated with.
   * @returns `constructor`, unchanged, for chaining the method call.
   *
   * @example
   * ```ts
   * import { Transfer } from "@aom-js/transfer";
   *
   * // routed to the executor subscribed with @Executor("w1")
   * const result = await Transfer.toInstance(Worker, "w1").whoami();
   * ```
   */
  static toInstance<T extends ClassConstructor<any>>(constructor: T, instanceId: string): T {
    AomIsolator.instance(constructor).instanceId = instanceId;
    return constructor;
  }

  /**
   * Builds an address-qualified topic name.
   *
   * @param topic - Base topic.
   * @param instanceId - Optional instance suffix.
   * @returns `` `${topic}_${instanceId}` `` when `instanceId` is set, otherwise `topic` unchanged.
   */
  static instanceTopic(topic: string, instanceId?: string): string {
    return [topic, instanceId].filter(Boolean).join("_");
  }

  /** Cache of proxies built by `restore`, keyed by `name:hash:instanceId` — a repeated `restore` of the same descriptor does not create new reply subscriptions. */
  // cache of restored clients: repeating restore for the same descriptor does not spawn new subscriptions
  private restoredMap: Map<string, Record<string, (...args: any[]) => any>> = new Map();

  /**
   * Rebuilds a calling proxy from a service descriptor received over the bus, without importing
   * the original isolator class. Each method on the proxy publishes to the descriptor's topic
   * and, for methods with `waitForResponse: true`, awaits a reply on **this** node's own reply
   * topic through the normal `RxTransfer` RPC machinery — singleton deduplication and
   * `@TopicTimeout`-style behaviour all apply the same way they would to a hand-written isolator.
   *
   * Repeated calls with the same `(descriptor.name, descriptor.hash, instanceId)` return the
   * cached proxy instead of creating new reply subscriptions.
   *
   * @param descriptor - Service descriptor, typically received via `collectDistributions` (see
   *   `@Isolator(transfer, { distributed: true })` for how it's produced).
   * @param instanceId - Address a specific executor instance, like `Transfer.toInstance`.
   * @returns A proxy object with one async function per descriptor method. Untyped by default —
   *   pass `T` for a typed shape, or generate one with `@aom-js/codegen`.
   *
   * @example
   * ```ts
   * import type { TransferServiceDescriptor } from "@aom-js/transfer";
   *
   * const received: TransferServiceDescriptor[] = [];
   * nodeB.collectDistributions((data) => received.push(...data.value));
   * // ... wait for the registry response to arrive ...
   * const descriptor = received.find((d) => d.name === "CalcService")!;
   *
   * const client = nodeB.restore<{ mul(pair: { a: number; b: number }): Promise<number> }>(descriptor);
   * const product = await client.mul({ a: 3, b: 4 }); // 12
   * ```
   */
  restore<T = Record<string, (...args: any[]) => any>>(
    descriptor: TransferServiceDescriptor,
    instanceId?: string,
  ): T {
    const cacheKey = [descriptor.name, descriptor.hash, instanceId].filter(Boolean).join(":");
    const cached = this.restoredMap.get(cacheKey);
    if (cached) return cached as T;

    const rx = new RxTransfer(this);
    const { instanceName, instanceKey } = this;
    const client: Record<string, (...args: any[]) => any> = {};

    descriptor.methods.forEach((method) => {
      // minimal AomIsolator stand-in: RxTransfer.request only reads these fields
      const $ = {
        topic: method.topic,
        // responses arrive on THIS node's (the consumer's) reply topic, not the owner node's
        replyTopic: `reply_${method.topic}_${instanceKey}_${instanceName}`,
        singletone: method.singleton,
        waitForResponse: method.waitForResponse,
        replySubscribers: {},
        topicProcessMap: new Map(),
        _: {
          root: { instanceTopic: (topic: string) => Transfer.instanceTopic(topic, instanceId) },
        },
      };
      client[method.name] = async (...args: any[]) => rx.request(args, $ as any);
    });

    this.restoredMap.set(cacheKey, client);
    return client as T;
  }

  /**
   * Polls the bus for distributed service descriptors published by other nodes.
   *
   * Records `collectCallbackHandler` and publishes this node's identity to
   * `registryRequestTopic`; every other node's `requestRegistry` answers on
   * `registryResponseTopic`, and `acceptRegistry` forwards matching answers to the callback,
   * once per responding node. A publish failure goes to `defaultErrorHandler` rather than
   * being thrown, since there is no caller left waiting on a `Promise`.
   *
   * @param collectCallbackHandler - Called once per node that answers, with `{ instance, value }`.
   *
   * @example
   * ```ts
   * import type { StructureReceiveSchema } from "@aom-js/transfer";
   *
   * transfer.collectDistributions((data: StructureReceiveSchema) => {
   *   console.log(data.instance, data.value); // one TransferServiceDescriptor[] per node
   * });
   * ```
   */
  // set the collector of distributed schemas
  // takes a function that will receive data coming from the polled nodes
  collectDistributions(colllectCallbackHandler: StructureCollectorFunction) {
    // remember the receiving function
    this.structureCollector = colllectCallbackHandler;
    // gather information about the current instance
    const { instanceName, instanceKey } = this;
    const value = { instanceName, instanceKey };
    // publish a structure request from this node to the shared registry
    this.publish({
      topic: this.registryRequestTopic,
      message: { value, headers: {} },
    }).catch((error) => this.reportError(error));
  }

  /**
   * Handles an incoming `collectDistributions` request from another node: if the sender is not
   * this node itself, publishes this node's full `registryMap` (own descriptors plus cached
   * copies) back to `registryResponseTopic`, addressed to the sender. A publish failure goes to
   * this node's own `defaultErrorHandler` — the failure to answer should not crash the node.
   */
  // handles an incoming request for registry data
  // if the request came from a node that is not this isolator instance
  // the sender of this message receives information about the current distributed methods
  private requestRegistry(sender: InstancesData) {
    const { instanceName, instanceKey } = this;
    if (!(sender.instanceName === instanceName && sender.instanceKey === instanceKey)) {
      // array of descriptors: a serializable format for real buses
      const schemas = [...this.registryMap.values()];
      const value = { receiver: sender, sender: { instanceName, instanceKey }, schemas };
      // every node answers: a failure to send the response must not crash the answering node
      this.publish({ topic: this.registryResponseTopic, message: { value, headers: {} } }).catch(
        (error) => this.reportError(error),
      );
    }
  }

  /**
   * Handles a `registryResponseTopic` message: if a `structureCollector` is set (via
   * `collectDistributions`) and this node is the addressed `receiver`, caches every received
   * descriptor into `registryMap` — own descriptors are never overwritten by incoming copies,
   * others replace the cached one only when the `hash` differs (last-write-wins, no real
   * versioning) — and forwards the batch to the collector callback. This is what turns a node
   * that once polled the registry into a re-broadcaster of what it saw, so schemas stay
   * reachable even after their original owner goes away.
   */
  // retrieve data from the registry
  // checks that this node has a structure collector set
  // and if the receiver of the registry message is this node
  // then that same collector is invoked, receiving information about the current distributed methods
  // this data is later expected to build the codegen structure
  private acceptRegistry(registry: TransferRegisty) {
    const { receiver } = registry;
    const { instanceName, instanceKey } = this;
    if (
      this.structureCollector &&
      receiver.instanceName === instanceName &&
      receiver.instanceKey === instanceKey
    ) {
      const { schemas, sender } = registry;

      // cache the received descriptors: the node becomes a rebroadcaster of the registry,
      // so schemas stay available even after their source goes offline
      if (Array.isArray(schemas)) {
        schemas.forEach((descriptor: TransferServiceDescriptor) => {
          const existing = this.registryMap.get(descriptor.name);
          // own descriptors are never overwritten by incoming copies
          const isOwn =
            existing?.origin.instanceName === instanceName &&
            existing?.origin.instanceKey === instanceKey;
          // ponytail: last-write-wins by hash; proper versioning if it's ever needed
          if (!isOwn && existing?.hash !== descriptor.hash) {
            this.registryMap.set(descriptor.name, descriptor);
          }
        });
      }

      // build the structure here for processing in the registry data receiver function
      const structureData: StructureReceiveSchema = { instance: sender, value: schemas };
      // and call the structure collector, passing the relevant information
      Reflect.apply(this.structureCollector, null, [structureData]);
    }
  }
}
