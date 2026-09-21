import type { ClassConstructor } from "@aom-js/core";
import type { FoldedSchemas } from "@aom-js/schemer";

/**
 * Type of a value accepted by `@TopicSchema`: a scalar name
 * (`"string" | "number" | "integer" | "boolean" | "date"`), a `@ComponentSchema`-decorated
 * class, or an array of exactly one such type — `[T]` is restored as `T[]`.
 */
export declare type TopicSchemaType = ClassConstructor | string | [TopicSchemaType];

/** One argument of an isolated method in `@TopicSchema`: exactly one `{ name: type }` pair per element. */
export declare type TopicSchemaArg = Record<string, TopicSchemaType>;

export declare interface TransferTopics {
  topic: string;

  replyTopic: string;
}
/**
 * Headers of an isolated message.
 *
 * Carries the metadata the transport needs for routing and request/response matching.
 */
export declare interface TransferMessageHeaders {
  /** Unique message id used to match a response to the request that triggered it. */
  uniqKey?: string;

  /** Topic the response should be published to (optional). */
  replyTopic?: string;

  /** True when `value` is an error envelope rather than a regular result (optional). */
  error?: boolean;
}

/**
 * Shape of the result the RPC callback receives.
 *
 * Defines what a subscriber of a reply topic gets back once a message has been processed.
 */
export declare interface TransferCallbackResponse {
  /** Topic the response arrived on. */
  topic: string;

  /** Response payload (optional). */
  value?: any;

  /** Error object, if the call failed (optional). */
  error?: Error;

  /** True once the response stream is complete (optional). */
  isCompleted?: boolean;
}

/**
 * Callback invoked when a response to an isolated call arrives.
 */
export declare type TransferCallbackHandler = (response: TransferCallbackResponse) => void;

/**
 * Wire format of an isolated message.
 *
 * Shape of the payload exchanged between isolated components over the bus.
 */
export declare interface TransferMessageSchema {
  /** Message headers carrying routing metadata. */
  headers: TransferMessageHeaders;

  /** Message payload. Data crossing the bus is not validated against its origin (see `subscriber`). */
  value: any;
}

/**
 * Handler invoked by the transport for every message received on a subscription.
 */
export declare type TransferNextFunction = (message: TransferMessageSchema) => void;

/**
 * Payload of a distributed-registry message: a schema snapshot addressed to one receiver.
 */
export declare interface StructureReceiveSchema {
  instance: InstancesData;

  value: any;
}

/** Callback passed to `Transfer.prototype.collectDistributions` to receive registry snapshots. */
export declare type StructureCollectorFunction = (data: StructureReceiveSchema) => void;

export declare type TransferPublishHandlerArgs = {
  topic: string;
  message: TransferMessageSchema;
};

/**
 * Publish callback supplied to `Transfer`.
 *
 * Sends a message to a topic. May be asynchronous: a synchronous throw and a rejected
 * `Promise` from an async `publisher` are both surfaced identically through `Transfer.publish`.
 */
export declare type TransferPublishHandler = (args: TransferPublishHandlerArgs) => void;

export declare type TransferSubscribeHandlerArgs = {
  topic: string;
  next: TransferNextFunction;
  queue?: boolean;
};
/**
 * Subscribe callback supplied to `Transfer`.
 *
 * Subscribes to a topic and forwards every incoming message to `next`. `queue: true`
 * (set via `@IsQueue()`) asks the underlying bus to deliver each message to a single
 * consumer instead of broadcasting it to every subscriber.
 */
export declare type TransferSubscribeHandler = (args: TransferSubscribeHandlerArgs) => void;

/**
 * Handler for errors that have no caller left to reject.
 *
 * Receives executor errors reported by `@CustomTopic`, response timeouts, delivery
 * failures, and registry-protocol send failures. Defaults to `console.error`.
 */
export declare type TransferErrorHandler = (error: Error) => void;

export declare interface InstancesData {
  /** Instance name identifying a `Transfer` node. */
  instanceName: string;

  /** Unique key identifying a `Transfer` node. */
  instanceKey: string;
}

/**
 * Constructor configuration for `Transfer`.
 *
 * Defines the transport callbacks and the identity/behaviour settings of one node.
 */
export declare interface TransferConfig extends InstancesData {
  /** Publishes messages to topics. */
  publisher: TransferPublishHandler;

  /** Subscribes to topics and receives incoming messages. */
  subscriber: TransferSubscribeHandler;

  /**
   * How long, in ms, `RxTransfer.request` waits for a response before rejecting with
   * `TransferTimeoutError`. Integer `0…2147483647`, default `30_000`. `0` means "wait
   * without a limit" — no `setTimeout` is created at all, so the wait is not just long,
   * it is unbounded. Out-of-range values (including `NaN`/`Infinity`/non-integers) throw
   * `RangeError` in the constructor, because `setTimeout` with such a value would fire
   * almost immediately and every call would time out right away.
   *
   * A zero timeout is usually safe: the executor always answers (an empty result becomes
   * `{}`), and that answer is what clears the timer, the pending callback and — for a
   * singleton call — the in-flight deduplication entry. The wait becomes truly unbounded
   * only when no answer will ever arrive at all — no executor was ever subscribed, the
   * node that would have answered died, or the reply was lost on the bus — while
   * `responseTimeout: 0` is in effect. A single method can override this value with
   * `@TopicTimeout(ms)`.
   */
  responseTimeout?: number;

  /**
   * Handler for errors that have no caller left to reject: for `@CustomTopic` — executor
   * errors, response timeouts and send failures; for an executor — a failure to publish
   * its own response (the executor's original error is attached as `cause`); for the
   * registry protocol — send failures. Defaults to `(error) => console.error("transfer error", error)`.
   */
  defaultErrorHandler?: TransferErrorHandler;
}

/** Options accepted by `@Isolator` — the place to extend isolator behaviour. */
export declare interface IsolatorOptions {
  /** Publish the class contract to the bus registry: adds a service descriptor to `transfer.registryMap`. */
  distributed?: boolean;
}

export declare interface TransferRegisty {
  receiver: InstancesData;
  sender: InstancesData;
  schemas: any;
}

/**
 * Description of one isolated method inside a service descriptor.
 *
 * Argument and return schemas are JSON Schema, possibly a `$ref` into the descriptor's
 * `components`.
 */
export declare interface TransferMethodDescriptor {
  name: string;
  topic: string;
  waitForResponse: boolean;
  singleton: boolean;
  queue: boolean;
  /**
   * Argument schemas: an array of `{ name: JSON Schema }` pairs, one per argument —
   * mirrors the `@TopicSchema` wire format. The field is absent when the method was not
   * described through `@TopicSchema`; consumers (code generation) must distinguish
   * "not described" from "no arguments" (`[]`).
   */
  args?: Record<string, any>[];
  returns?: any;
}

/**
 * Serializable descriptor of a distributed isolated service — the contract that travels
 * over the bus. A calling proxy can be rebuilt from it with `Transfer.prototype.restore`
 * without importing the original class.
 */
export declare interface TransferServiceDescriptor {
  name: string;
  origin: InstancesData;
  /** sha256 of `methods+components+schemas` — used for deduplication and version comparison. */
  hash: string;
  methods: TransferMethodDescriptor[];
  components: Record<string, any>;
  /**
   * Components in the package's own fold format (`foldSchemas` from `@aom-js/schemer`),
   * from which code generation rebuilds classes. Always present on a descriptor produced
   * by a distributed isolator, even with no components (empty format-1 payload); not
   * required by the type because older descriptors cached from the registry may lack it.
   */
  schemas?: FoldedSchemas;
}
