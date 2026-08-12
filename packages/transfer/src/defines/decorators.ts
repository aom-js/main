import crypto from "node:crypto";
import { ClassType, ExecutionPhase, Property } from "@aom-js/core";
import { Schemer, SchemasCollector, AomSchemas, SCALAR_TYPE_SCHEMAS } from "@aom-js/schemer";

// локальные импорты
import { Transfer, AomIsolator } from "./main";
import { RxTransfer } from "./rx-transfer";
import {
  TopicSchemaArg,
  TopicSchemaType,
  TransferMethodDescriptor,
  TransferServiceDescriptor,
} from "./types";

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

// проверка типа в @TopicSchema: имя скаляра, @ComponentSchema-класс или [T]
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
 * Декоратор схемы изолированного метода. Аргументы — массив пар `{ имя: тип }` (по одной
 * на аргумент, имена уникальны — из них кодогенерация восстанавливает сигнатуру); типы —
 * имена скаляров ("string" | "number" | "integer" | "boolean" | "date"), `@ComponentSchema`-классы
 * или `[T]` для массивов. `@TopicSchema({})` — явное «аргументов нет»; отсутствие декоратора —
 * «метод не описан» (в дескрипторе не будет поля args). Корректность типов проверяется
 * на месте: незадекорированный класс или неизвестный скаляр — ошибка при декорировании.
 * Методный (не пер-параметрный) — сознательно, ради совместимости со stage-3 декораторами.
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
        throw new Error(`@TopicSchema ${method}: each args entry must hold exactly one { name: type } pair`);
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
 * Помечает класс распределенным: собирает сериализуемый дескриптор сервиса
 * (методы, топики, схемы через SchemasCollector) и кладет его в реестр транспорта
 */
export function IsDistributed() {
  return AomIsolator.classDecorator(($) => {
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
      // args пишется только для методов, описанных через @TopicSchema: отсутствие поля —
      // признак «сигнатура неизвестна» для потребителей дескриптора (кодогенерации).
      // Формат провода зеркалит декоратор: [{ имя: JSON Schema }]
      if (method$.argsSchemas) {
        method.args = method$.argsSchemas.map((entry) => {
          const [name, type] = Object.entries(entry)[0];
          return { [name]: collector.extract(type) };
        });
      } else {
        console.warn(`distributed method "${$._.target.name}.${method.name}" has no @TopicSchema`);
      }
      // returns добавляется только при наличии — дескриптор обязан переживать JSON без потерь
      if (method$.returnsSchema) {
        method.returns = collector.extract(method$.returnsSchema);
      }
      return method;
    });

    const components: Record<string, any> = {};
    collector.components.forEach((schema, name) => {
      components[name] = schema;
    });

    const { instanceName, instanceKey } = transfer;
    const descriptor: TransferServiceDescriptor = {
      name: $._.target.name,
      origin: { instanceName, instanceKey },
      hash: crypto
        .createHash("sha256")
        .update(JSON.stringify({ methods, components }))
        .digest("hex"),
      methods,
      components,
    };

    transfer.registryMap.set(descriptor.name, descriptor);
  }, ExecutionPhase.LAST);
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
    const propertyKey = $._.property!; // methodDecorator — property всегда задано

    // Добавляем метод в список изолированных
    $._.root.isolatedMethods.push($);

    const handler = Reflect.get(constructor, propertyKey);

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
        topicsMap.set(handler, topics);
        instancesMap.set(handler, $);
        // // Инициализируем подписку на ответы
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
 * Базовая функция для создания топиков
 * @param waitForResponse Флаг ожидания ответа
 * @param singletone Флаг синглтона
 * @returns Декоратор метода
 */
function AutoTopic(waitForResponse: boolean, singletone = false): MethodDecorator {
  return AomIsolator.methodDecorator(($, descriptor) => {
    const constructor = $._.target;
    const propertyKey = $._.property!; // methodDecorator — property всегда задано

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
  }, ExecutionPhase.FIRST);
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
          console.warn(`isolated property "${<string>property}" has no executor`);
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
function attachIsolation(constructor: ClassType, propertyKey: Property, instanceId?: string) {
  const parentConstructor = Object.getPrototypeOf(constructor);
  const parent$ = AomIsolator.instance(parentConstructor);
  const { name } = constructor;
  // Получаем изолятор и карту топиков
  const { transfer, rx, topicsMap, instancesMap } = parent$;
  const isolatedTopics = topicsMap.get(parentConstructor[propertyKey]);

  const parentProperty$ = instancesMap.get(parentConstructor[propertyKey]);

  // Проверяем наличие топика и связанного с ним инстанса — регистрируются они вместе
  if (!isolatedTopics || !parentProperty$) {
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
        Reflect.apply(Reflect.get(constructor, propertyKey), constructor, args),
      ),
      queue: parentProperty$.queue,
    },

    // constructor, <string>propertyKey)
  );
}
