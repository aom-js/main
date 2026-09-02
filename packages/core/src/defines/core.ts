import {
  ClassConstructor,
  CombinedDecorator,
  ClassType,
  Property,
  ExecutionPhase,
  InheritPlacement,
  InstanceTarget,
} from "./types";
import { isClass } from "./functions";

declare type AomHandler<T extends AomCore> = ($: T) => void;

declare type AomСombinedHandler<T extends AomCore> = (
  $: T,
  descriptor?: PropertyDescriptor,
) => void;

declare type AomMethodHandler<T extends AomCore> = (
  $: T,
  descriptor: PropertyDescriptor,
) => PropertyDescriptor | void;

declare type AomPropertyHandler<T extends AomCore> = ($: T) => void;

declare type AomParameterHandler<T extends AomCore> = ($: T, parameterIndex: number) => void;

// Вспомогательный тип, объединяющий сигнатуру конструктора и статические методы AOM
type AomClass<T extends AomCore> = ClassConstructor<T> & typeof AomCore;

// Ключевое изменение - делаем LazyCall более гибким через обобщенный интерфейс
type LazyCallHandler<T extends AomCore> =
  | AomHandler<T>
  | AomСombinedHandler<T>
  | AomMethodHandler<T>
  | AomPropertyHandler<T>
  | AomParameterHandler<T>;

type LazyCall<T extends AomCore> = [
  LazyCallHandler<T>,
  args: [T, ...any],
  inherit?: InheritPlacement,
];

type OriginDescriptor = {
  target: InstanceTarget;
  property: Property;
  // дескриптора может не быть: у полей класса на момент декорирования его ещё нет
  descriptor?: PropertyDescriptor;
};

type NodeOriginDescriptor<T extends AomCore> = { _: AomNode<T>; self: T } & OriginDescriptor;

class AomCallstackQueue<T extends AomCore> {
  private readonly __nominal?: T;

  private queue: Array<LazyCall<any>>;
  private fired: Array<LazyCall<any>>;

  private callstack: AomCallstack<T>;

  private type: ExecutionPhase;

  private async: boolean;

  private indexed: boolean;

  // отложенная фаза: вызовы копятся в очереди до exec(), а не выполняются в момент добавления
  private deferred: boolean;

  constructor(callstack: AomCallstack<T>, type: ExecutionPhase, indexed = false) {
    this.callstack = callstack;

    this.queue = [];
    this.fired = [];

    this.type = type;
    this.indexed = indexed;
    this.async = [ExecutionPhase.DELAY].includes(type);
    this.deferred = [ExecutionPhase.LAST, ExecutionPhase.DELAY].includes(type);
  }

  // index не задан — в конец; >= 0 — в конкретную позицию; < 0 — в начало
  private place(store: Array<LazyCall<any>>, value: LazyCall<any>, index?: number) {
    if (index === undefined) {
      store.push(value);
    } else if (index >= 0) {
      store[index] = value;
    } else {
      store.unshift(value);
    }
  }

  // вставить блок вызовов в начало очереди с сохранением их взаимного порядка
  prependBatch(values: Array<LazyCall<any>>) {
    this.queue.unshift(...values);
  }

  add<U extends T>(value: LazyCall<U>, index?: number) {
    const { type } = this;
    // если это отложенный запуск или запуск в последний момент - то просто добавим в очередь
    // возможно позже добавить сюда DecoratorsQueueStore.DELAY
    if (this.deferred) {
      this.place(this.queue, value, index);
    } else if ([ExecutionPhase.FIRST].includes(type)) {
      // если стартуем первым - то выполним и добавим в список
      this.place(this.fired, value, index);
      return this.run(value);
    } else if (type === ExecutionPhase.INSTANT) {
      // если мгновенный запуск, то нигде не сохраняем, а просто выполняем
      return this.run(value);
    }
  }

  exec() {
    // разберем очередь и перенесём всё в выполненные
    let value: LazyCall<any> | undefined;
    while ((value = this.queue.shift())) {
      this.run(value);
      this.fired.push(value);
    }
  }

  run<U extends T>([handler, args]: LazyCall<U>) {
    // run([handler, args]: LazyCall<any>) {
    if (this.async) {
      setTimeout(() => {
        Reflect.apply(handler, null, args);
      });
    } else {
      return Reflect.apply(handler, null, args);
    }
  }

  transferTo<U extends T>(target: U) {
    // transferTo(target: any) {
    const { type, indexed } = this;
    // вызовем с заменой контекста
    const replaceContext = (value: LazyCall<T>, index?: number) => {
      // const replaceContext = (value: LazyCall<any>, index?: number) => {
      const [handler, args, inherit] = value;
      // Создаём новый массив аргументов с заменой контекста
      const newArgs = [target, ...args.slice(1)] as [U, ...any];
      // args[0] = target;
      return target._.callstack.add([handler, newArgs, inherit], type, index);
    };
    // если это индексированный контекст, то проверим, чтобы в целевой структуре был строго пустой список (индексированные декораторы не переносятся, если они уже есть)
    if (indexed) {
      const targetIndexedStore = target._.callstack.indexes[type];
      const targetExistsIndexed =
        targetIndexedStore.queue.length || targetIndexedStore.fired.length;
      if (!targetExistsIndexed) {
        // сначала переносятся уже выполненные, а затем ожидающие
        this.fired.forEach((value, index) => replaceContext(value, index));
        this.queue.forEach((value, index) => replaceContext(value, index));
      }
    } else {
      // перенесем данные из очередей и выполненных с заменой контекста и сохранением типа хранилища при переносе
      // сначала переносятся уже выполненные, а затем ожидающие
      const prepend: Array<LazyCall<any>> = [];
      [...this.fired, ...this.queue].forEach((value) => {
        const [handler, args, inherit] = value;
        if (inherit === InheritPlacement.SKIP) return;
        // PREPEND осмыслен только для отложенных фаз: FIRST/INSTANT выполняются
        // прямо в момент переноса, и их порядок задаётся самим переносом
        if (inherit === InheritPlacement.PREPEND && this.deferred) {
          prepend.push([handler, [target, ...args.slice(1)] as [U, ...any], inherit]);
        } else {
          replaceContext(value);
        }
      });
      // единым блоком в начало очереди потомка: поштучный unshift развернул бы порядок
      if (prepend.length) {
        target._.callstack.stores[type].prependBatch(prepend);
      }
    }
  }
}

class AomCallstack<T extends AomCore> {
  private readonly __nominal?: T;

  _: AomNode<T>;

  stores: { [key in ExecutionPhase]: AomCallstackQueue<T> };

  indexes: { [key in ExecutionPhase]: AomCallstackQueue<T> };

  constructor(_: AomNode<T>) {
    this._ = _;

    this.stores = {} as any;
    this.indexes = {} as any;
    Object.values(ExecutionPhase).forEach((type) => {
      this.stores[type] = new AomCallstackQueue<T>(this, type);
      this.indexes[type] = new AomCallstackQueue<T>(this, type, true);
    });
  }

  add<U extends T>(value: LazyCall<U>, storeFlag: ExecutionPhase, index?: number) {
    this.stores[storeFlag].add(value, index);
    // if (index >= 0) {
    //   this.indexes[storeFlag].add(value, index);
    // } else {
    // }
  }

  apply() {
    Object.values(ExecutionPhase).forEach((type) => {
      this.stores[type].exec();
      this.indexes[type].exec();
    });
  }

  transferTo<U extends T>(target: U) {
    Object.values(ExecutionPhase).forEach((type) => {
      this.stores[type].transferTo(target);
      this.indexes[type].transferTo(target);
    });
  }
}

class AomNode<T extends AomCore> {
  private readonly __nominal?: T;

  base: AomClass<T>;

  target: ClassConstructor;

  property?: Property;

  currentProperty: T | undefined;

  // корневая структура для ноды
  root: T;

  self: T;

  originInstance: InstanceTarget;

  origins: NodeOriginDescriptor<T>[];

  properties: Map<Property, T>;

  statics: Map<Property, T>;

  // стек вызовов, которые надо выполнить
  callstack: AomCallstack<T>;

  constructor(
    self: T,
    base: AomClass<any>,
    target: ClassConstructor,
    property?: Property,
    origin?: OriginDescriptor,
  ) {
    this.self = self;
    this.base = base;
    this.target = target;
    this.property = property;

    this.properties = new Map();
    this.statics = new Map();

    this.origins = [];
    this.callstack = new AomCallstack(this);

    // если указано конкретное свойство, то зафиксируем с ним связь в инстансе от исходного конструктора
    if (property) {
      this.root = this.base.instance(target);
      if (origin) {
        this.originInstance = origin.target;
        if (!origin.descriptor?.enumerable) {
          this.root._.origins.push({ _: this, self, ...origin });
        }
      }
    } else {
      this.root = this.self;
    }
  }

  apply() {
    // выполним все отложенные действия на собственных свойствах
    this.properties.forEach(($) => {
      $._.callstack.apply();
    });

    // выполним все отложенные действия на статичных свойствах
    this.statics.forEach(($) => {
      $._.callstack.apply();
    });

    // разберем всё по дескрипторам
    this.origins.forEach(({ _ }) => {
      // this.base.instance(descriptor.value)._.callstack.apply();
      _.callstack.apply();
    });

    // выполним собственные отложенные вызовы
    this.callstack.apply();
  }

  inherit(parent: ClassType) {
    const $parent = this.base.instance(parent);

    // перенесем собственные вызовы с родителя на конечного потомка
    $parent._.callstack.transferTo(this.self);

    const transferDescritorWithDecorators = (
      target: InstanceTarget,
      property: Property,
      source: T,
      descriptor?: PropertyDescriptor,
    ) => {
      if (descriptor && descriptor.value) {
        // здесь обязательно каррирование, так как иначе будет замена контекста исходного дескриптора изначального родительского класса
        const curriedDescriptor = (...args: any) => Reflect.apply(descriptor.value, null, args);
        // определим
        Reflect.defineProperty(target, property, {
          ...descriptor,
          value: curriedDescriptor,
        });
      }
      const $childInstance = this.base.instance(target, property as string);
      // и вот тут должен быть соответствующий перенос всех декораторов за счет переноса релевантных значений в callstack
      source._.callstack.transferTo($childInstance);
    };

    // console.log (this.properties);
    // перенесем декорированные данные из статичных свойств и методов
    $parent._.origins.forEach((origin) => {
      const $origin = origin.descriptor ? this.base.instance(origin.descriptor.value) : origin.self;
      const isClassOrigin = origin.target === $origin._.target;

      const property = $origin._.property!;

      // Перенос блокируется, если потомок уже владеет свойством. Проверок две, и обе нужны:
      // Object.hasOwn закрывает статики и прототипные методы, реестр AOM — поля класса
      // (их на прототипе/конструкторе нет, физическая проверка их не видит).
      // Обратное тоже верно: методы в реестр не попадают — instanceKey() берёт для них
      // ключом descriptor.value и карты statics/properties не трогает.
      if (
        isClassOrigin &&
        !Object.hasOwn(this.target, property) &&
        !this.root._.statics.get(property)
      ) {
        transferDescritorWithDecorators(this.target, property, $origin, origin.descriptor);
      } else if (
        !isClassOrigin &&
        !Object.hasOwn(this.target.prototype, property) &&
        !this.root._.properties.get(property)
      ) {
        // иначе проверим, что это свойство самого инстанса, и надо создать соответствующие переносы
        transferDescritorWithDecorators(this.target.prototype, property, $origin, origin.descriptor);
      } else {
        // console.log(`same property exists ${this.target.name}.${origin.property.toString()}`);
        // errors.push(
        //   new Error(`same property exists ${this.target.name}.${origin.property.toString()}`),
        // );
      }
    });

    return $parent;
  }
}

export class AomCore {
  _: AomNode<this>;

  constructor(
    base: AomClass<any>,
    target: ClassConstructor,
    property?: Property,
    origin?: OriginDescriptor,
  ) {
    this._ = new AomNode<this>(this, base, target, property, origin);
  }

  private static instancesMap<T extends AomCore, E extends InstanceTarget>(
    this: AomClass<T>,
  ): WeakMap<E | T, T> {
    //
    const mapSymbol = Symbol.for(`AOM_MAP_${this.name}`);

    // Проверяем, есть ли карта у этого конкретного класса ('this')
    if (!(this as any)[mapSymbol]) {
      // Если нет, создаем её
      (this as any)[mapSymbol] = new WeakMap<E | T, T>();
    }

    // Получаем ссылку на карту
    const map: WeakMap<E | T, T> = (this as any)[mapSymbol];

    return map;
  }

  private static instanceKey<T extends AomCore, E extends InstanceTarget>(
    this: AomClass<T>,
    target: E,
    property?: Property,
  ): T | E {
    // извлечем конструктор, который будет корневым
    const constructor = (
      target instanceof Function ? target : target.constructor
    ) as ClassConstructor;

    const map = this.instancesMap();

    let instanceKey: T | E;
    // если указано конкретное свойство, и текущий контекст происходит для конкретного класса
    if (property && isClass(constructor)) {
      const descriptor = Reflect.getOwnPropertyDescriptor(target, property);

      if (descriptor && descriptor.value && !descriptor.enumerable) {
        // если это метод, то возьмем в качестве ключа инстанса значение дескриптора
        // на которое будет ссылаться и метод по его названию
        instanceKey = descriptor.value as E;
      } else {
        // извлечем его собственный инстанс
        const constructorInstance = this.instance(constructor);
        // если это свойство, то следует понять, оно статическое или собственное, и извлечь оттуда релевантную карту
        let propertiesMap: Map<Property, T>;
        // входящий target равен constructor, то это статический контекст
        if (target === constructor) {
          propertiesMap = constructorInstance._.statics;
        } else {
          // иначе контекст собственных свойств
          propertiesMap = constructorInstance._.properties;
        }
        const existing = propertiesMap.get(property);
        if (existing) {
          instanceKey = existing;
        } else {
          const originDescriptor = { target, property, descriptor };

          // создадим инстанс
          instanceKey = new this(this, constructor, property, originDescriptor);
          // запишем его в общую карту
          map.set(instanceKey, instanceKey);
          // сохраним его в релевантной карте
          propertiesMap.set(property, instanceKey);
        }
      }
    } else {
      instanceKey = target;
    }

    return instanceKey;
  }

  static checkExists<T extends AomCore, E extends InstanceTarget>(
    this: AomClass<T>,
    target: E,
    property?: Property,
  ): T | undefined {
    const map = this.instancesMap();

    const instanceKey = this.instanceKey(target, property);

    return map.get(instanceKey);
  }

  static instance<T extends AomCore, E extends InstanceTarget>(
    this: AomClass<T>,
    target: E,
    property?: Property,
  ): T {
    // Используем Symbol для уникального ключа карты на каждом классе-наследнике
    // Ищем существующий инстанс для target в карте этого класса
    // если указано property, то экземпляр класса хранится по хендлеру функции
    const map = this.instancesMap();

    const instanceKey = this.instanceKey(target, property);

    // извлечем конструктор, который будет корневым
    const constructor = (
      target instanceof Function ? target : target.constructor
    ) as ClassConstructor;

    let instance = map.get(instanceKey);

    // console.log("defined instance key", { target, property, instanceKey, instance });

    // originDescriptor осмыслен только для конкретного свойства — на уровне класса его нет
    const originDescriptor: OriginDescriptor | undefined =
      property === undefined
        ? undefined
        : { target, property, descriptor: Reflect.getOwnPropertyDescriptor(target, property) };

    // Если инстанса нет
    if (!instance) {
      // Создаем новый инстанс текущего класса ('this')
      instance = new this(this, constructor, property, originDescriptor);
      // instance = this.create(constructor, property, originDescriptor);
      // Сохраняем его в карте
      map.set(instanceKey, instance);
    } else if (property && instance._.target !== constructor) {
      // тут хитрый момент, который может произойти, если инстанс для какой-то статистической функции был создан раньше,
      // чем объявлен какой-то полезный декоратор для самого свойства
      // в этом случае для него следует заменить значение `_` на корректное, с учетом правильных target, root и property
      instance._ = new AomNode(instance, this, constructor, property, originDescriptor);
    }

    // Возвращаем найденный или созданный инстанс
    return instance;
  }

  // позднее доразрешение ссылки на статику по контекстному классу: если инстанс `$`
  // привязан к родителю контекста, вернуть инстанс каррированной копии потомка
  static resolveFor<T extends AomCore>(this: AomClass<T>, $: T, context: ClassConstructor): T {
    const { target, property } = $._;
    // Object.hasOwn обязателен: собственная копия появляется у потомка только при inherit();
    // без неё instance() создал бы пустой инстанс без дескриптора вместо корректного
    if (property && context.prototype instanceof target && Object.hasOwn(context, property)) {
      return this.instance(context, property);
    }
    return $;
  }

  // Используем AOMClass для 'this'
  static classDecorator<T extends AomCore>(
    this: AomClass<T>,
    handler: AomHandler<T>,
    storeFlag: ExecutionPhase = ExecutionPhase.FIRST,
    inherit?: InheritPlacement,
  ): ClassDecorator {
    const self = this; // t теперь типа AOMClass<T>
    return function (target: ClassType) {
      // Получаем AOM-инстанс для этого конструктора
      const targetInstance = self.instance(target);
      return targetInstance._.callstack.add([handler, [targetInstance], inherit], storeFlag);
      // Классные декораторы могут возвращать конструктор, но здесь мы только для сайд-эффекта
    };
  }

  // Используем AOMClass для 'this'
  static combinedDecorator<T extends AomCore>(
    this: AomClass<T>,
    handler: AomСombinedHandler<T>,
    storeFlag: ExecutionPhase = ExecutionPhase.FIRST,
    inherit?: InheritPlacement,
  ): CombinedDecorator {
    const self = this;
    return function (target: InstanceTarget, property?: Property, descriptor?: PropertyDescriptor) {
      // Получаем AOM-инстанс для этого конструктора
      const targetInstance = self.instance(target, property);
      return targetInstance._.callstack.add(
        [handler, [targetInstance, descriptor], inherit],
        storeFlag,
      );
      // Вызываем обработчик
      // return handler(targetInstance, descriptor);
    };
  }

  // Используем AOMClass для 'this'
  static methodDecorator<T extends AomCore>(
    this: AomClass<T>,
    handler: AomMethodHandler<T>,
    storeFlag: ExecutionPhase = ExecutionPhase.FIRST,
    inherit?: InheritPlacement,
  ): MethodDecorator {
    const self = this; // t теперь типа AOMClass<T>
    return function (target: InstanceTarget, property: Property, descriptor: PropertyDescriptor) {
      // Получаем AOM-инстанс для конструктора класса
      const targetInstance = self.instance(target, property);
      return targetInstance._.callstack.add(
        [handler, [targetInstance, descriptor], inherit],
        storeFlag,
      );
      // return handler(targetInstance, descriptor);
    };
  }

  // Используем AOMClass для 'this'
  static propertyDecorator<T extends AomCore>(
    this: AomClass<T>,
    handler: AomPropertyHandler<T>,
    storeFlag: ExecutionPhase = ExecutionPhase.FIRST,
    inherit?: InheritPlacement,
  ): PropertyDecorator {
    const self = this; // t теперь типа AOMClass<T>
    return function (target: InstanceTarget, property: Property) {
      // Получаем AOM-инстанс для конструктора класса
      const targetInstance = self.instance(target, property);
      return targetInstance._.callstack.add([handler, [targetInstance], inherit], storeFlag);
      // return handler(targetInstance);
    };
  }

  // Используем AOMClass для 'this'
  static parameterDecorator<T extends AomCore>(
    this: AomClass<T>,
    handler: AomParameterHandler<T>,
    storeFlag: ExecutionPhase = ExecutionPhase.FIRST,
    inherit?: InheritPlacement,
  ): ParameterDecorator {
    const self = this; // t теперь типа AOMClass<T>
    // property === undefined у параметров конструктора — тогда это контекст самого класса
    return function (
      target: InstanceTarget,
      property: Property | undefined,
      parameterIndex: number,
    ) {
      // Получаем AOM-инстанс для конструктора класса
      const targetInstance = self.instance(target, property);
      //
      return targetInstance._.callstack.add(
        [handler, [targetInstance, parameterIndex], inherit],
        storeFlag,
        parameterIndex,
      );
    };
  }
}
