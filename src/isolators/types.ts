/**
 * Интерфейс заголовков изолированного сообщения
 * Содержит метаданные, необходимые для маршрутизации и обработки сообщений
 */
export declare interface IsolatedMessageHeaders {
  /** Уникальный идентификатор сообщения для отслеживания и сопоставления запросов/ответов */
  uniqKey: string;

  /** Топик, на который следует отправить ответ (опционально) */
  replyTopic?: string;

  /** Флаг, указывающий на наличие ошибки в сообщении (опционально) */
  error?: boolean;
}

/**
 * Интерфейс структуры ответа в функции обратного вызова
 * Определяет формат данных, возвращаемых в callback после обработки сообщения
 */
export declare interface IsolatedCallbackResponse {
  /** Топик, связанный с ответом */
  topic: string;

  /** Значение ответа (опционально) */
  value?: any;

  /** Объект ошибки, если произошла ошибка (опционально) */
  error?: Error;

  /** Флаг, указывающий, что обработка сообщения завершена (опционально) */
  isCompleted?: boolean;
}

/**
 * Тип обработчика обратного вызова для изолированных сообщений
 * Функция, вызываемая при получении ответа на изолированное сообщение
 */
export declare type IsolatedCallbackHandler = (response: IsolatedCallbackResponse) => void;

/**
 * Интерфейс схемы изолированного сообщения
 * Определяет структуру сообщений, передаваемых между изолированными компонентами
 */
export declare interface IsolatedMessageSchema {
  /** Заголовки сообщения с метаданными */
  headers: IsolatedMessageHeaders;

  /** Полезная нагрузка сообщения */
  value: any;
}

/**
 * Тип функции для обработки следующего сообщения
 * Вызывается при получении нового сообщения в подписке
 */
export declare type IsolatorNextFunction = (message: IsolatedMessageSchema) => void;

/**
 * Тип обработчика публикации для изолятора
 * Функция для отправки сообщений в определенный топик
 */
export declare type IsolatorPublishHandler = (
  topic: string,
  message: IsolatedMessageSchema
) => void;

/**
 * Тип обработчика подписки для изолятора
 * Функция для подписки на определенный топик и обработки входящих сообщений
 */
export declare type IsolatorSubscribeHandler = (topic: string, next: IsolatorNextFunction) => void;

/**
 * Интерфейс конфигурации изолятора
 * Определяет настройки и обработчики для экземпляра изолятора
 */
export declare interface IsolatorConfig {
  /** Имя экземпляра изолятора для идентификации */
  instanceName: string;

  /** Уникальный ключ экземпляра изолятора */
  instanceKey: string;

  /** Функция для публикации сообщений в топики */
  publisher: IsolatorPublishHandler;

  /** Функция для подписки на топики и получения сообщений */
  subscriber: IsolatorSubscribeHandler;
}
