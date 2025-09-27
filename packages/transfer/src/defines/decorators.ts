import { Constructor, DecoratorsQueueStore, Property } from "@aom-js/core";

// локальные импорты
import { Transfer, AomIsolator } from "./main";
import { RxTransfer } from "./rx-transfer";

/**
 * Декоратор для изоляции класса
 * @param transfer Сконфигурированный транспорт
 * @returns Декоратор класса
 */
export function Isolator(transfer: Transfer): ClassDecorator {
  //
  return AomIsolator.classDecorator(($) => {
    $.transfer = transfer;
    $.rx = new RxTransfer(transfer);
    // сюда, возможно, надо добавить процедуру переноса наследуемых значений
    // теперь надо запустить отложенные вычисления, которые накинут соответствующие инструкции на релевантные свойства
    $._.apply();
  });
}

// признак того, что вызов данного метода является распределенной очередью (то есть не обрабатывается всеми исполнителями)
export function IsQueue() {
  return AomIsolator.methodDecorator(($) => {
    $.queue = true;
  });
}

// добавим признак того, что этот класс распределенный
export function IsDistributed() {
  return AomIsolator.classDecorator(($) => {
    // тут значением должна быть схема, которая будет распаковываться на других инстансах
    $.transfer.registryMap.set($._.target, $._.target.name);
  }, DecoratorsQueueStore.LAST);
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
  return AomIsolator.methodDecorator(($, _descriptor) => {
    const { topicsMap, instancesMap } = $._.root;
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
        instancesMap.set(constructor[propertyKey], $);
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

    $.singletone = singletone;
    $.waitForResponse = waitForResponse;
    $.originDescriptorValue = descriptor.value;
    // сразу добавим декоратор, который выполнится чуть позже
    Reflect.decorate([DefineTopics()], constructor, propertyKey);
    // сохраним оригинальный метод, который впоследствии вызовем при подписке на топик

    // Переопределяем оригинальный метод
    descriptor.value = async (...args: any[]) => {
      const { rx } = $._.root;

      return rx.request(args, $);
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
  const parent$ = AomIsolator.instance(parentConstructor);
  const { name } = constructor;
  // Получаем изолятор и карту топиков
  const { transfer, rx, topicsMap, instancesMap } = parent$;
  const isolatedTopics = topicsMap.get(parentConstructor[propertyKey]);

  const parentProperty$ = instancesMap.get(parentConstructor[propertyKey]);

  // Проверяем наличие топика
  if (!isolatedTopics) {
    throw new Error(`attached handler is not isolated topic ${name}.${String(propertyKey)}`);
  }
  const { topic } = isolatedTopics;
  // Создаем топик с учетом идентификатора экземпляра
  const instanceTopic = Transfer.instanceTopic(topic, instanceId);
  // Подписываемся на топик и связываем с методом выполнения
  transfer.subscriber(
    {
      topic: instanceTopic,
      next: rx.execHandler((...args: any[]) =>
        Reflect.apply(constructor[propertyKey], constructor, args)
      ),
      queue: parentProperty$.queue,
    }

    // constructor, <string>propertyKey)
  );
}
