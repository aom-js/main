import { Constructor, DecoratorsQueueStore, Property } from "@aom/core";
import * as rxjs from "rxjs";
import * as rxjsOperators from "rxjs/operators";
import crypto from "node:crypto";

// локальные импорты
import { Transfer, AomIsolator } from "./main";
import { TransferCallbackResponse, TransferMessageHeaders, TransferTopics } from "./types";

/**
 * Декоратор для изоляции класса
 * @param transfer Сконфигурированный изолятор
 * @returns Декоратор класса
 */
export function Isolator(transfer?: Transfer): ClassDecorator {
  //
  if (!transfer) {
    transfer = Transfer.default;
  }
  return AomIsolator.classDecorator(($) => {
    $.transfer = transfer;
    $._.apply();
    // теперь надо запустить отложенные вычисления, которые накинут соответствующие инструкции на релевантные свойства
  });
}

/**
 * Декоратор для создания пользовательского топика без ожидания ответа
 * @param singletone Флаг синглтона
 * @returns Декоратор метода
 */
export function CustomTopic(singletone?: boolean): MethodDecorator {
  return AutoTopic(false, singletone);
}

/**
 * Декоратор для создания топика с ожиданием ответа
 * @param singletone Флаг синглтона
 * @returns Декоратор метода
 */
export function ResponseTopic(singletone?: boolean): MethodDecorator {
  return AutoTopic(true, singletone);
}

///
function DefineTopics() {
  return AomIsolator.methodDecorator(($, descriptor) => {
    const { topicsMap } = $._.root;
    const constructor = $._.target;
    const propertyKey = $._.property;

    // Добавляем метод в список изолированных
    $._.root.isolatedMethods.push($);

    const handler = constructor[propertyKey];

    const defineTopics = (transfer: Transfer) => {
      // Получаем сконфигурированный изолятор и карту топиков
      let topics = topicsMap.get(handler);
      if (!topics) {
        // создадим топик по имени класса и метода, и сохраним его в карте по значению на сам метод
        const { name } = $._.target;
        const topic = `${name}.${String($._.property)}`;
        const replyTopic = `reply_${topic}_${transfer.instanceKey}_${transfer.instanceName}`;
        topics = { topic, replyTopic };
        // сохраним значения в соответствующих картах
        topicsMap.set(constructor[propertyKey], topics);
        // // Инициализируем подписку на ответы
        // initReplySubscription(topics, transfer);
      }

      return topics;
    };

    const { transfer } = $._.root;
    const { topic, replyTopic } = defineTopics(transfer);
    $.topic = topic;
    $.replyTopic = replyTopic;
  }, DecoratorsQueueStore.LAST);
}

/**
 * Базовая функция для создания топиков
 * @param waitForResponse Флаг ожидания ответа
 * @param singletone Флаг синглтона
 * @returns Декоратор метода
 */
function AutoTopic(waitForResponse: boolean, singletone?: boolean): MethodDecorator {
  return AomIsolator.methodDecorator(($, descriptor) => {
    const constructor = $._.target;
    const propertyKey = $._.property;
    // сразу добавим декоратор, который выполнится чуть позже
    Reflect.decorate([DefineTopics()], constructor, propertyKey);
    // сохраним оригинальный метод, который впоследствии вызовем при подписке на топик
    const { value: originValue } = descriptor;
    // Карта для хранения процессов по топикам
    const topicProcessMap = new Map();

    // тут такое ограничение, потому что из эволюционных

    // Объект для отслеживания подписок на ответы
    const replySubscribers = {};

    /**
     * Инициализация подписки на ответы
     * @param replyTopic Топик для ответов
     * @returns Статус подписки
     */
    const initReplySubscription = (topics: TransferTopics, transfer: Transfer): boolean => {
      const { topic, replyTopic } = topics;
      if (!replySubscribers[replyTopic]) {
        transfer.subscriber(replyTopic, transfer.replyHandler(topic));
        replySubscribers[replyTopic] = true;
      }
      return replySubscribers[replyTopic];
    };

    // Переопределяем оригинальный метод
    descriptor.value = async (...args: any[]) => {
      const value = args;
      const { topic, replyTopic } = $;
      const { transfer } = $._.root;

      // Генерируем уникальный ключ для сообщения
      const uniqKey = crypto.randomUUID();

      // получим hash от аргументов
      const hash = crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");

      // создадим ключ процесса в зависимости от того, это синглтон или нет
      // основанием являются аргументы, для которых вызывается функция
      const topicProcessKey = `${topic}_${hash}_${singletone ? "singletone" : uniqKey}`;

      // установим заголовок, сохраним оригинальный топик
      const headers: TransferMessageHeaders = {
        replyTopic,
        uniqKey,
      };
      // console.log("check keys", topicProcessMap.keys(), topicProcessKey);
      // проверим, есть ли существующий процесс для текущего топика (актуально для синглотонов)
      const existsProcess = topicProcessMap.get(topicProcessKey);
      // если есть, то вернем его, не запуская процедуру повторно
      if (existsProcess) {
        // console.log("exists process is", existsProcess);
        return existsProcess;
      }

      // создадим топик, который подразумевает вероятное значение instanceId при запуске себя откуда-либо
      const instanceTopic = $._.root.instanceTopic(topic);

      // Создаем Observable для обработки сообщений
      const rx$ = rxjs
        .defer(async () => initReplySubscription({ topic, replyTopic }, transfer))
        .pipe(
          rxjsOperators.mergeMap(
            () =>
              new rxjs.Observable((observer) => {
                // Создаем функцию обратного вызова для наблюдателя
                const callback = callbackObserver(observer);
                // Сохраняем коллбэк в карту по уникальному ключу
                transfer.callbackMap.set(uniqKey, callback);
                // Публикуем сообщение в топик
                transfer.publisher(instanceTopic, { headers, value });
                // Функция очистки при отписке
                return () => {
                  transfer.callbackMap.delete(uniqKey);
                };
              })
          )
        );
      let result: any;
      // если следует дождаться ответа
      if (waitForResponse) {
        // Ожидаем первое значение из потока
        result = rxjs
          .firstValueFrom(rx$)
          .then((result) => {
            topicProcessMap.delete(topicProcessKey); // удалим из карты процессов текущий запуск
            return result; // вернем результат
          })
          .catch((err) => {
            topicProcessMap.delete(topicProcessKey); // удалим из карты процессов текущий запуск
            throw err; // выбросим ошибку, чтобы перехватить её на вызывающем уровне
          });
      } else {
        // Подписываемся на поток без ожидания ответа
        result = rx$.subscribe();
        // Добавляем функцию очистки при отписке
        result.add(() => {
          topicProcessMap.delete(topicProcessKey); // удалим из карты процессов текущий запуск
          Reflect.apply(originValue, constructor, []); // вызовем исходную процедуру
        });
      }

      // сохраним результат в карту процессов, который может быть возвращен
      topicProcessMap.set(topicProcessKey, result);
      return result;
    };
  }, DecoratorsQueueStore.FIRST);
}

/**
 * Декоратор для выполнения изолированных методов
 * @param instanceId Идентификатор экземпляра
 * @returns Декоратор класса
 */
export function Executor(instanceId?: string): ClassDecorator {
  return AomIsolator.classDecorator(($) => {
    const constructor = $._.target;
    const parent$ = AomIsolator.instance(Object.getPrototypeOf(constructor));

    // Для каждого изолированного метода устанавливаем обработчик
    parent$.isolatedMethods.forEach((_$) => {
      const { property } = _$._;
      if (property) {
        if (Reflect.getOwnPropertyDescriptor(constructor, property)) {
          //
          attachIsolation(constructor, property, instanceId);
        } else {
          console.warn("isolated property `", property, "` has no executor");
        }
      }
    });
  });
}

/**
 * Прикрепляет изоляцию к методу
 * @param constructor Конструктор класса
 * @param propertyKey Ключ свойства (метода)
 * @param instanceId Идентификатор экземпляра
 */
function attachIsolation(constructor: Constructor, propertyKey: Property, instanceId?: string) {
  const parentConstructor = Object.getPrototypeOf(constructor);
  const parent$ = AomIsolator.instance(Object.getPrototypeOf(constructor));

  const { name } = constructor;
  // Получаем изолятор и карту топиков
  const { transfer: isolator, topicsMap } = parent$;
  const isolatedTopics = topicsMap.get(parentConstructor[propertyKey]);

  // Проверяем наличие топика
  if (!isolatedTopics) {
    throw new Error(`attached handler is not isolated topic ${name}.${String(propertyKey)}`);
  }
  const { topic } = isolatedTopics;
  // Создаем топик с учетом идентификатора экземпляра
  const instanceTopic = Transfer.instanceTopic(topic, instanceId);
  // Подписываемся на топик и связываем с методом выполнения
  isolator.subscriber(instanceTopic, isolator.execHandler(constructor, <string>propertyKey));
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
