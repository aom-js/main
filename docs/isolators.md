# Изоляторы

Начнем с изоляторов, как наиболее мелкой задачи, в рамках которой можно начать формировать видение оберточного фреймворка, которое будет впоследствии перенесено на остальные механики.

Изоляторы будут всё теми же декораторами, которые позволят расширять функционал классов, делая два связанных набора, один из которых можно "публиковать" для использования внутри общей шины данных.

Ключевой разницей будет то, что создание изоляторов будет завязано на конфигурацию, в которой, собственно говоря, будут описаны правила оформления структуры запроса и ответа.

В первую очередь сформируем названия, которые будут использоваться для того, чтобы всё это красиво выглядело и понятно воспринималось.

```ts
import { Isolator, Executor, ResponseTopic, CommonTopic } from "@aom/isolators";

@Isolator()
export class CustomIsolator {
  @ResponseTopic()
  static async ResponseData(id: string) {
    //
  }

  @CommonTopic()
  static async CommonData(id: string) {
    //
  }
}

@Executor()
class CustomExecutor extends CustomIsolator() {
  static async ResponseData(id: string) {
    //
  }

  static async CommonData(id: string) {
    //
  }
}
```

То есть общий принцип остаётся все тем же. Однако на стадии инициации структуры требуется сделать так, чтобы была оформлена процедура, вокруг которой будет происходить то самое движение данных.

А еще хочется во всё это добавить возможность делать подписки в случае вызова методов, оформленных в `CommonTopic`, и в идеале в `ResponseTopiс` добавить возможность дожидаться ответа за счёт ключа идемпотентности.

## Конфигурация

Каким образом должна происходить конфигурация? В первую очередь следует понимать, что конфигураций чисто технически должно поддерживаться несколько. То есть внутрь конкретно взятого вызова `@Executor` и `@Isolator` могут подсовываться конкретные конфигурации, которые в общем случае должны совпадать друг с другом, иначе ничего не получится. Если такого значения нет, то следует использовать конфигурацию по умолчанию, которая в общем случае создается за счет вызова процедуры типа `IsolatorsConfig.default({...})`, получая на вход те же значения, что и вызов `new IsolatorsConfig()`, инстанс которого и может служить аргументом при установке соответствующего декоратора.

Рассмотрим, что может быть конфигурацией по умолчанию, чтобы иметь возможность прокидывать данные между какой-то процессорной шиной, типа того же `EmitListener`.

В первую очередь начнем с того, что из себя представляют интеграции шины данных в текущей итерации? И как это следует переработать исходя из того, чтобы включение шины было параметрическим значением.

Допустим, конфигурация изоляторов будет иметь два значения: `publish` и `reply`. Где `publish` - это действие, которое отправляет значения в шины, `reply` - подписка на релевантный ответ.

То есть, исходим из того, что конфигурация представляет собой конструкцию от двух аргументов, создающую характерный инстанс.

```ts
type PublishFunction = (topic: string, message: any, reply: string) => void;
type ReplyFunction = (topic: string, ...) => void;

class IsolatorConfig {
  publishHandler: PublishFunction;

  replyHandler: ReplyFunction;

  execHandler: ExecFunction;

  constructor(publish, reply, exec) {
    this.publishHandler = publish;
    this.replyHandler = reply;
    this.execHandler = exec;
  }

  static default(publish, reply) {
    //
  }
}
```

Таким образом, как может вообще формироваться конфигурация?
Разберем примеры для kafka и для nats.

```ts
// публикатор должен вызвать процедуру отправки релевантных данных в указанный топик, учитывая возможность того,
// что данное сообщение может как ожидать ответа, так и быть самим ответом
// то есть код в publish должен свестись к тому, чтобы вызвать процедуру идентичную send
const producer = kafka.producer({
  createPartitioner: Partitioners.LegacyPartitioner,
});
await producer.connect();

const isolatorPublish = (topic, message, reply) => {
  // подготовка структуры сообщения и его отправка
  producer.send(message).catch((err) => callback({ err }));
};

// или в случае nats

const nats = await Nats.connect({
  servers: NATS_SERVER,
  user: NATS_USERNAME,
  pass: NATS_PASSWORD,
});

const isolatorPublish = (topic, message, reply) => {
  // подготовка структуры сообщения и его отправка
  nats.publish(topic, sc.encode(JSON.stringify(message)));
};

// там еще есть процедуры формирования callback, но она скорее всего уйдет внутрь релевантной перегрузки при объявлении
// самого изолятора

// reply - это то, что выполняется в самом конце на самом изоляторе
// когда исполнитель закончил обработку кода на своей стороне и вызвал соответствующий publish в replyTopic

// ответчик должен быть подписан на указанный топик, таким образом чтобы передавать оттуда значения
// в конкретную процедуру выполнения кода

// для кафки это стремится к виду
const isolatorReply = (topic) => {
  const consumer = kafka.consumer({
    groupId: `${replyTopic}`,
  });
  consumer
    .connect()
    .then(() => consumer.subscribe({ topic: replyTopic }))
    .then(() =>
      consumer.run({
        eachMessage: async ({ message }) => {
          // let { headers, value } = message;
          const headers = validResponseHeaders(message.headers);

          const value = JSON.parse(String(message.value));
          const replyKey = headers[REPLY_KEY];
          const callback = routingMap.get(replyKey);
          if (callback) {
            if (Reflect.has(headers, "error")) {
              callback({ err: value });
            } else {
              callback({ isDisposed: true, response: value });
            }
          }
          // console.log("callback result", { headers, value, topic });
        },
      })
    );
};

// для NATS это стремится к виду
const isolatorReply = (topic) => {
  nats.subscribe(replyTopic, {
    callback: (err, message) => {
      if (err) {
        //
      } else {
        //
        // let { headers, value } = message;
        const { value, headers } = JSON.parse(sc.decode(message.data)) as TNatsMessage;

        const replyKey = headers[REPLY_KEY];
        const callback = routingMap.get(replyKey);
        if (callback) {
          if (Reflect.has(headers, "error")) {
            callback({ err: value, topic });
          } else {
            callback({ isDisposed: true, response: value, topic });
          }
        }
      }
    },
  });
};

// фактически процедура reply должна разбирать типичным образом составленное сообщение в шине
// и вызывать соответствущую процедуру внутри того контекста, где определена конфигурация

// теперь обрисуем в общих чертах процедуру, которая будет характеризовать выполнение операции

// для кафки это стремится к виду
const isolatorExec = (topic) => {
  // топик - это название модели и имя метода, которые должны выполняться
  const topic = `${name}.${propertyKey}`;
  // создаем подписчика, который работает в указанном рантайме
  const consumer = kafka.consumer({
    groupId: `${topic}_${INSTANCE_KEY}`,
  });
  // здесь происходит подписка на сообщения, которые будут отправляться в оригинальный топик handler-а
  consumer
    .connect()
    .then(() => consumer.subscribe({ topic: isolatedTopic }))
    .then(() => {
      // console.log("run consumer", { name, topic });
      consumer.run({
        eachMessage: async ({ message }) => {
          // извлечем аргументы из строки сообщения
          const args = JSON.parse(String(message.value));
          // выполняем оригинальную функцию, сохраняя контекст
          Promise.all([Reflect.apply(constructor[propertyKey], constructor, args)])
            .then((values) => {
              const [result] = values;
              const headers = validResponseHeaders(message.headers);
              // пройтись по всем коллбекам, и отправить в них результат
              // console.log("success kafka method", { topic, result, headers });
              if (headers[REPLY_TOPIC]) {
                // console.log("send response to topic", headers[REPLY_TOPIC]);
                producer.send({
                  topic: headers[REPLY_TOPIC],
                  messages: [
                    {
                      value: JSON.stringify(result || {}),
                      headers: _.pick(headers, REPLY_KEY),
                    },
                  ],
                });
              }
            })
            .catch((error) => {
              // console.error("caught isolator error", error, topic);
              const headers = validResponseHeaders(message.headers);

              producer.send({
                topic: headers[REPLY_TOPIC],
                messages: [
                  {
                    value: JSON.stringify(error, Object.getOwnPropertyNames(error)),
                    headers: {
                      ..._.pick(headers, REPLY_KEY),
                      error: "1",
                    },
                  },
                ],
              });
            });
        },
      });
    });
};

// для NATS это стремится к виду
const isolatorReply = (topic) => {
  // топик - это название модели и имя метода, которые должны выполняться
  const topic = `${name}.${propertyKey}`;
  const instanceTopic = makeInstanceTopic(isolatedTopic, instanceId);

  nats.subscribe(instanceTopic, {
    callback: (err, message) => {
      if (err) {
        //
      } else {
        const { value: args, headers } = JSON.parse(sc.decode(message.data)) as TNatsMessage;

        // выполняем оригинальную функцию, сохраняя контекст
        Promise.all([Reflect.apply(constructor[propertyKey], constructor, args)])
          .then((values) => {
            // console.log("result is", values);
            const [result] = values;
            // const headers = validResponseHeaders(message.headers);
            // пройтись по всем коллбекам, и отправить в них результат
            // console.log("success kafka method", { topic, result, headers });
            if (headers[REPLY_TOPIC]) {
              // console.log("send response to topic", headers[REPLY_TOPIC]);
              publish(headers[REPLY_TOPIC], {
                value: result || {},
                headers: _.pick(headers, REPLY_KEY),
              });
            }
          })
          .catch((error) => {
            console.error("caught isolator error", error, topic, args);

            publish(headers[REPLY_TOPIC], {
              value: error,
              headers: { ..._.pick(headers, REPLY_KEY), error: 1 },
            });
          });
      }
    },
  });
};

// фактически процедурой является типичная обработка сообщения в соответствующем consumer/subsciber
// с последующим вызовом от этих значений самой обработки целевой функции с генерацией структурного ответа
// который и пойдёт в reply

const config = new IsolatorConfig({ publish, reply, exec });
```

Итого, какие получаются механики следует внедрить, чтобы это заработало?

Для начала соберем примерную схему того, как это будет сконфигурировано:

```ts
Isolation.default({
  //
  instanceKey: INSTANCE_KEY,
  //
  instanceName: INSTANCE_NAME,

  publishHandler: (topic, message) => {
    nats.publish(topic, sc.encode(JSON.stringify(message)));
  },

  subscribeHandler: (topic, next) => {
    nats.subscribe(instanceTopic, {
      callback: (err, { data }) => {
        const message = JSON.parse(sc.decode(message.data));
        next(message);
      },
    });
  },
});

// или для kafka

const producer = kafka.producer({
  createPartitioner: Partitioners.LegacyPartitioner,
});
await producer.connect();

// создаем подписчика, который работает в указанном рантайме
const consumer = kafka.consumer({
  groupId: `isolators_${INSTANCE_KEY}_${INSTANCE_NAME}`,
});
// здесь происходит подписка на сообщения, которые будут отправляться в оригинальный топик handler-а
await consumer.connect();

Isolation.default({
  //
  instanceKey: INSTANCE_KEY,
  //
  instanceName: INSTANCE_NAME,

  publisher: (topic, message) => {
    const topicMessage = { topic, messages: { value: message } };
    producer.send(topicMessage);
  },

  subscriber: (topic, next) => {
    consumer.subscribe({ topic }).then(() => {
      consumer.run({
        eachMessage: async ({ message }) => {
          // отправим соответствующий результат сообщения
          next(JSON.parse(String(message.value)));
        },
      });
    });
  },
});

@Isolator()
class SomeIsolator {
  @CustomTopic()
  static async SomeFunction() {
    //
  }

  @ResponseTopic()
  static async AnotherFunction() {
    //
  }
}
```
