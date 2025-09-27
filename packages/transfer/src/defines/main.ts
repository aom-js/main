import { AomCore, Constructor, ClassConstructor } from "@aom-js/core";

import * as rxjs from "rxjs";
import * as rxjsOperators from "rxjs/operators";
import crypto from "node:crypto";

import {
  TransferConfig,
  TransferPublishHandler,
  TransferSubscribeHandler,
  TransferCallbackHandler,
  TransferMessageSchema,
  TransferNextFunction,
  TransferTopics,
  TransferMessageHeaders,
  TransferCallbackResponse,
  InstancesData,
  TransferRegisty,
  StructureCollectorFunction,
  StructureReceiveSchema,
} from "./types";
import { RxTransfer } from "./rx-transfer";

export class AomIsolator extends AomCore {
  transfer: Transfer;

  rx: RxTransfer;

  singletone: boolean;

  waitForResponse: boolean;

  originDescriptorValue: Function;

  queue: boolean;

  registry: boolean;

  replySubscribers: Record<string, boolean> = {};

  topicProcessMap: Map<string, any> = new Map();

  isolatedMethods: AomIsolator[] = [];

  topicsMap: WeakMap<Constructor, TransferTopics> = new WeakMap();

  instancesMap: WeakMap<Constructor, AomIsolator> = new WeakMap();

  instanceId?: string;

  topic: string;

  replyTopic: string;

  instanceTopic(topic: string) {
    const result = Transfer.instanceTopic(topic, this.instanceId);
    this.instanceId = undefined;
    return result;
  }
}

/**
 * Класс Transfer, реализующий конфигурацию транспортера
 * Обеспечивает изоляцию и коммуникацию между компонентами
 */
export class Transfer implements TransferConfig {
  // имя инстанса
  instanceName: string;

  // ключ инстанса
  instanceKey: string;

  // функция для публикации данных
  publisher: TransferPublishHandler;

  // функция для подписки на данные
  subscriber: TransferSubscribeHandler;

  // функция получения информации о структурах
  private structureCollector?: StructureCollectorFunction;

  // карта коллбеков для обработки ответов
  callbackMap: Map<string, TransferCallbackHandler>;

  readonly registryRequestTopic = `!Transfer_Registry_Request!`;
  readonly registryResponseTopic = `!Transfer_Registry_Notification!`;

  readonly registryMap: Map<ClassConstructor, any> = new Map();

  /**
   * Конструктор класса Isolator
   * @param config Конфигурация изолятора
   */
  constructor(config: TransferConfig) {
    //
    this.publisher = config.publisher;
    this.subscriber = config.subscriber;

    this.instanceKey = config.instanceKey;
    this.instanceName = config.instanceName;

    this.callbackMap = new Map();

    // подписаться на топик, в ответ на который будет отправлен состав имеющихся схем
    this.subscriber({
      topic: this.registryRequestTopic,
      next: (message) => this.requestRegistry(message.value),
    });

    // подписаться на топик с ответами с составом имеющихся схем
    this.subscriber({
      topic: this.registryResponseTopic,
      next: (message) => this.acceptRegistry(message.value),
    });
  }

  /**
   * Связывает изолированный конструктор с именем экземпляра
   * Запускается непосредственно перед вызовом изолированного метода
   * @param constructor Конструктор класса
   * @param instanceId ID экземпляра
   */
  static toInstance<T extends ClassConstructor<any>>(constructor: T, instanceId: string): T {
    AomIsolator.instance(constructor).instanceId = instanceId;
    return constructor;
  }

  /**
   * Формирует топик с учетом идентификатора экземпляра
   * @param topic Базовый топик
   * @param instanceId Идентификатор экземпляра (опционально)
   * @returns Сформированный топик
   */
  static instanceTopic(topic: string, instanceId?: string): string {
    return [topic, instanceId].filter(Boolean).join("_");
  }

  // определить сборщик распределенных схем
  // получает на вход функцию, в которую будут передаваться данные из опрашиваемых узлов
  collectDistributions(colllectCallbackHandler: StructureCollectorFunction) {
    // зафиксируем функцию получатель
    this.structureCollector = colllectCallbackHandler;
    // соберем информацию о текущем инстанса
    const { instanceName, instanceKey } = this;
    const value = { instanceName, instanceKey };
    //  опубликуем от текущей ноды запрос в о структурах в общем реестре
    this.publisher({
      topic: this.registryRequestTopic,
      message: { value, headers: {} },
    });
  }

  // получение запроса о данных в реестре
  // если запрос получен из узла, который не является текущим изоляционным инстансом
  // отправителю этого сообщения передается информация о текущих распределенных методах
  private requestRegistry(sender: InstancesData) {
    const { instanceName, instanceKey } = this;
    if (!(sender.instanceName === instanceName && sender.instanceKey === instanceKey)) {
      const schemas = this.registryMap.entries();
      const value = { receiver: sender, sender: { instanceName, instanceKey }, schemas };
      this.publisher({ topic: this.registryResponseTopic, message: { value, headers: {} } });
    }
  }

  // получить данные из реестра
  // проверяет, что в текущем узле установлен сборщик структуры
  // и если получателем сообщения из реестра является текущая нода
  // то вызывается тот самый сборщик, в который передается информация о текущих распределенных методах
  // впоследствии на основании этих данных должна собраться codegen структура
  private acceptRegistry(registry: TransferRegisty) {
    const { receiver } = registry;
    const { instanceName, instanceKey } = this;
    if (
      this.structureCollector &&
      receiver.instanceName === instanceName &&
      receiver.instanceKey === instanceKey
    ) {
      const { schemas, sender } = registry;
      // тут сформируем структуру для её обработки в функции получения данных из реестра
      const structureData: StructureReceiveSchema = { instance: sender, value: schemas };
      // и вызовем сборщик структур, передав релевантную информацию
      Reflect.apply(this.structureCollector, null, [structureData]);
    }
  }
}
