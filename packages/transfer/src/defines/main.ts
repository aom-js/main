import { AomCore, Constructor, ClassConstructor } from "@aom/core";

import {
  TransferConfig,
  TransferPublishHandler,
  TransferSubscribeHandler,
  TransferCallbackHandler,
  TransferMessageSchema,
  TransferNextFunction,
  TransferTopics,
} from "./types";

export class AomIsolator extends AomCore {
  transfer: Transfer;

  isolatedMethods: AomIsolator[] = [];

  topicsMap: WeakMap<Constructor, TransferTopics> = new WeakMap();

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

  // карта коллбеков для обработки ответов
  callbackMap: Map<string, TransferCallbackHandler>;

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
  }

  // конфигурация по умолчанию
  static default: Transfer;

  /**
   * Устанавливает конфигурацию по умолчанию
   * @param config Конфигурация изолятора
   */
  static config(config: TransferConfig): Transfer {
    this.default = new this(config);
    return this.default;
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

  /**
   * Создает обработчик ответов для указанного топика
   * @param topic Топик, для которого создается обработчик
   * @returns Функция-обработчик для обработки ответных сообщений
   */
  replyHandler(topic: string): TransferNextFunction {
    return (message: TransferMessageSchema): void => {
      // Извлекаем значение и заголовки из сообщения
      const { value, headers } = message;
      // Извлекаем уникальный ключ и флаг ошибки из заголовков
      const { uniqKey, error } = headers;
      // Получаем функцию обратного вызова по уникальному ключу
      const callback = this.callbackMap.get(uniqKey);
      // Если функция обратного вызова существует
      if (callback) {
        // Если в заголовках указан флаг ошибки, вызываем callback с ошибкой
        if (error) {
          callback({ error: value, topic });
        } else {
          // Иначе вызываем callback с успешным результатом
          callback({ topic, value });
        }
      }
    };
  }

  /**
   * Создает функцию-обработчик для выполнения метода
   * @param constructor Конструктор класса
   * @param propertyKey Ключ свойства (метода)
   * @returns Функция-обработчик следующего сообщения
   */
  execHandler(constructor: Constructor, propertyKey: string): TransferNextFunction {
    return (message: TransferMessageSchema) => {
      const { value, headers } = message;

      const { replyTopic, uniqKey } = headers;

      // выполняем оригинальную функцию, сохраняя контекст
      Promise.all([Reflect.apply(constructor[propertyKey], constructor, value)])
        .then(([result]) => {
          // если указан топик для ответа, отправляем результат
          replyTopic &&
            this.publisher(replyTopic, {
              value: result || {},
              headers: { uniqKey },
            });
        })
        .catch((error) => {
          console.error("caught isolator error", error, value);

          // в случае ошибки отправляем её в топик для ответа
          replyTopic &&
            this.publisher(replyTopic, {
              value: error,
              headers: { uniqKey, error: true },
            });
        });
    };
  }
}
