import * as rxjs from "rxjs";
import * as rxjsOperators from "rxjs/operators";
import crypto from "node:crypto";

import { AomIsolator, Transfer } from "./main";
import {
  TransferCallbackResponse,
  TransferMessageHeaders,
  TransferMessageSchema,
  TransferNextFunction,
  TransferCallbackHandler,
} from "./types";

rxjs.config.onUnhandledError = (err: Error) => console.error("rxjs unhandled error", err);

export class RxTransfer {
  private transfer: Transfer;

  constructor(transfer: Transfer) {
    this.transfer = transfer;
  }

  /**
   * Инициализация подписки на ответы
   * @param $
   * @returns Статус подписки
   */
  initReplySubscription($: AomIsolator): boolean {
    const { topic, replyTopic } = $;
    if (!$.replySubscribers[replyTopic]) {
      this.transfer.subscriber({ topic: replyTopic, next: this.replyHandler(topic) });
      $.replySubscribers[replyTopic] = true;
    }
    return $.replySubscribers[replyTopic];
  }

  request(value: any[], $: AomIsolator) {
    const { topic, replyTopic } = $;
    const constructor = $._.target;

    // Генерируем уникальный ключ для сообщения
    const uniqKey = crypto.randomUUID();

    // получим hash от аргументов
    const hash = crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");

    // создадим ключ процесса в зависимости от того, это синглтон или нет
    // основанием являются аргументы, для которых вызывается функция
    const topicProcessKey = `${topic}_${hash}_${$.singletone ? "singletone" : uniqKey}`;

    // установим заголовок, сохраним оригинальный топик
    const headers: TransferMessageHeaders = {
      replyTopic,
      uniqKey,
    };
    // проверим, есть ли существующий процесс для текущего топика (актуально для синглотонов)
    const existsProcess = $.topicProcessMap.get(topicProcessKey);
    // если есть, то вернем его, не запуская процедуру повторно
    if (existsProcess) {
      return existsProcess;
    }

    // создадим топик, который подразумевает вероятное значение instanceId при запуске себя откуда-либо
    const instanceTopic = $._.root.instanceTopic(topic);

    // Создаем Observable для обработки сообщений
    const rx$ = rxjs
      .defer(async () => this.initReplySubscription($))
      .pipe(
        rxjsOperators.mergeMap(
          () =>
            new rxjs.Observable((observer) => {
              // Создаем функцию обратного вызова для наблюдателя
              const callback: TransferCallbackHandler = callbackObserver(observer);
              // Сохраняем коллбэк в карту по уникальному ключу
              this.transfer.callbackMap.set(uniqKey, callback);
              // Публикуем сообщение в топик
              this.transfer.publisher({ topic: instanceTopic, message: { headers, value } });
              // Функция очистки при отписке
              return () => {
                this.transfer.callbackMap.delete(uniqKey);
              };
            }),
        ),
      );
    let result: any;
    // если следует дождаться ответа
    if ($.waitForResponse) {
      // Ожидаем первое значение из потока
      result = rxjs
        .firstValueFrom(rx$)
        .then((result) => {
          $.topicProcessMap.delete(topicProcessKey); // удалим из карты процессов текущий запуск
          return result; // вернем результат
        })
        .catch((err) => {
          $.topicProcessMap.delete(topicProcessKey); // удалим из карты процессов текущий запуск
          throw err; // выбросим ошибку, чтобы перехватить её на вызывающем уровне
        });
    } else {
      // Подписываемся на поток без ожидания ответа
      result = rx$.subscribe();
      // Добавляем функцию очистки при отписке
      result.add(() => {
        $.topicProcessMap.delete(topicProcessKey); // удалим из карты процессов текущий запуск
        Reflect.apply($.originDescriptorValue, constructor, []); // вызовем исходную процедуру
      });
    }

    // сохраним результат в карту процессов, который может быть возвращен
    $.topicProcessMap.set(topicProcessKey, result);
    return result;
  }

  /**
   * Создает обработчик ответов для указанного топика
   * @param topic Топик, для которого создается обработчик
   * @returns Функция-обработчик для обработки ответных сообщений
   */
  replyHandler(topic: string): TransferNextFunction {
    return (data: TransferMessageSchema): void => {
      // Извлекаем значение и заголовки из сообщения
      const { value, headers } = data;
      // Извлекаем уникальный ключ и флаг ошибки из заголовков
      const { uniqKey, error } = headers;
      // Получаем функцию обратного вызова по уникальному ключу
      const callback = this.transfer.callbackMap.get(uniqKey);

      // Если функция обратного вызова существует
      if (callback) {
        // Если в заголовках указан флаг ошибки, вызываем callback с ошибкой
        if (error) {
          callback({ error: value, topic });
        } else {
          // Иначе вызываем callback с успешным результатом
          callback({ topic, value, isCompleted: true });
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
  // execHandler(constructor: Constructor, propertyKey: string): TransferNextFunction {
  execHandler(handler: Function): TransferNextFunction {
    return (message: TransferMessageSchema) => {
      const { value, headers } = message;

      const { replyTopic, uniqKey } = headers;

      // выполняем переданную функцию, учитывая входящие аргументы, являющиеся списком
      Promise.all([Reflect.apply(handler, undefined, value)])
        .then(([result]) => {
          // если указан топик для ответа, отправляем результат
          replyTopic &&
            this.transfer.publisher({
              topic: replyTopic,
              message: { value: result || {}, headers: { uniqKey, replyTopic } },
            });
        })
        .catch((error) => {
          // в случае ошибки отправляем её в топик для ответа
          replyTopic &&
            this.transfer.publisher({
              topic: replyTopic,
              message: { value: error, headers: { uniqKey, replyTopic, error: true } },
            });
        });
    };
  }
}

/**
 * Создает функцию обратного вызова для наблюдателя
 * @param observer Наблюдатель RxJS
 * @returns Функция обратного вызова
 */
function callbackObserver(observer: rxjs.Observer<unknown>) {
  /**
   * Сериализует ошибку
   * @param err Объект ошибки
   * @param topic Топик
   * @returns Сериализованная ошибка
   */
  const serializeError = (err: Error, topic: string) => {
    // console.error("do serialize error", topic, err);
    return err;
  };

  /**
   * Сериализует ответ
   * @param response Ответ
   * @param topic Топик
   * @returns Сериализованный ответ
   */
  const serializeResponse = (response: any, topic: string) => {
    // console.log("do serialize response", response);
    return response;
  };

  // Возвращаем функцию обработки результата
  return (result: TransferCallbackResponse) => {
    //
    const { error, value, topic, isCompleted } = result;

    // Обрабатываем различные типы результатов
    if (error) {
      return observer.error(serializeError(error, topic));
    } else if (isCompleted) {
      observer.next(serializeResponse(value, topic));
      return observer.complete();
    }
    observer.next(serializeResponse(value, topic));
    return null;
  };
}
