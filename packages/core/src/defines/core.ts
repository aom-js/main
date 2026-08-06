import {
  ClassConstructor,
  CombinedDecorator,
  ClassType,
  Property,
  ExecutionPhase,
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

type LazyCall<T extends AomCore> = [LazyCallHandler<T>, args: [T, ...any]];

type OriginDescriptor = {
  target: InstanceTarget;
  property: Property;
  descriptor: PropertyDescriptor;
};

type NodeOriginDescriptor<T extends AomCore> = { _: AomNode<T>; self: T } & OriginDescriptor;

class AomCallstackQueue<T extends AomCore> {
  private readonly __nominal?: T;

  private queue: Array<LazyCall<any>>;
  private fired: Array<LazyCall<any>>;

  private callstack: AomCallstack<T>;

  private type?: ExecutionPhase;

  private async: boolean;

  private indexed: boolean;

  constructor(callstack: AomCallstack<T>, type: ExecutionPhase, indexed?: boolean) {
    this.callstack = callstack;

    this.queue = [];
    this.fired = [];

    this.type = type;
    this.indexed = indexed;
    this.async = [ExecutionPhase.DELAY].includes(type);
  }

  add<U extends T>(value: LazyCall<U>, index?: number) {
    // add(value: LazyCall<any>, index?: number) {
    //
    if (index < 0) {
      // console.log("transfer with unshift");
    }
    const { type } = this;
    // если это отложенный запуск или запуск в последний момент - то просто добавим в очередь
    // возможно позже добавить сюда DecoratorsQueueStore.DELAY
    if ([ExecutionPhase.LAST, ExecutionPhase.DELAY].includes(type)) {
      if (index >= 0) {
        this.queue[index] = value;
      } else if (index < 0) {
        this.queue.unshift(value);
      } else {
        this.queue.push(value);
      }
      // index >= 0 ? (this.queue[index] = value) : this.queue.push(value);
    } else if ([ExecutionPhase.FIRST].includes(type)) {
      if (index >= 0) {
        this.fired[index] = value;
      } else if (index < 0) {
        this.fired.unshift(value);
      } else {
        this.fired.push(value);
      }
      // если стартуем первым - то выполним и добавим в список
      // index >= 0 ? (this.fired[index] = value) : this.fired.push(value);
      return this.run(value);
    } else if (type === ExecutionPhase.INSTANT) {
      // если мгновенный запуск, то нигде не сохраняем, а просто выполняем
      return this.run(value);
    }
  }

  exec() {
    // разберем очередь и перенесём всё в выполненные
    while (this.queue.length) {
      const value = this.queue.shift();
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
      const [handler, args] = value;
      // Создаём новый массив аргументов с заменой контекста
      const newArgs = [target, ...args.slice(1)] as [U, ...any];
      // args[0] = target;
      return target._.callstack.add([handler, newArgs], type, index);
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
      this.fired.forEach((value) => replaceContext(value));
      this.queue.forEach((value) => replaceContext(value));
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
      this.originInstance = origin.target;
      if (origin && !origin.descriptor?.enumerable) {
        this.root._.origins.push({ _: this, self, ...origin });
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
      descriptor: PropertyDescriptor,
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

      if (isClassOrigin && !this.root._.statics.get($origin._.property!)) {
        transferDescritorWithDecorators(
          this.target,
          $origin._.property!,
          $origin,
          origin.descriptor,
        );
      } else if (!isClassOrigin && !this.root._.properties.get($origin._.property!)) {
        // иначе проверим, что это свойство самого инстанса, и надо создать соответствующие переносы
        transferDescritorWithDecorators(
          this.target.prototype,
          $origin._.property!,
          $origin,
          origin.descriptor,
        );
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

  private static instanceKey<T extends AomCore, E extends InstanceTarget, K = keyof E>(
    this: AomClass<T>,
    target: E,
    property?: K & Property,
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
        instanceKey = propertiesMap.get(property);
        if (!instanceKey) {
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

  static checkExists<T extends AomCore, E extends InstanceTarget, K = keyof E>(
    this: AomClass<T>,
    target: E,
    property?: K & Property,
  ): T | undefined {
    const map = this.instancesMap();

    const instanceKey = this.instanceKey(target, property);

    return map.get(instanceKey);
  }

  static instance<T extends AomCore, E extends InstanceTarget, K = keyof E>(
    this: AomClass<T>,
    target: E,
    property?: K & Property,
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

    const descriptor = Reflect.getOwnPropertyDescriptor(target, property);
    const originDescriptor = { target, property, descriptor };

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

  // Используем AOMClass для 'this'
  static classDecorator<T extends AomCore>(
    this: AomClass<T>,
    handler: AomHandler<T>,
    storeFlag: ExecutionPhase = ExecutionPhase.FIRST,
  ): ClassDecorator {
    const self = this; // t теперь типа AOMClass<T>
    return function (target: ClassType) {
      // Получаем AOM-инстанс для этого конструктора
      const targetInstance = self.instance(target);
      return targetInstance._.callstack.add([handler, [targetInstance]], storeFlag);
      // Классные декораторы могут возвращать конструктор, но здесь мы только для сайд-эффекта
    };
  }

  // Используем AOMClass для 'this'
  static combinedDecorator<T extends AomCore>(
    this: AomClass<T>,
    handler: AomСombinedHandler<T>,
    storeFlag: ExecutionPhase = ExecutionPhase.FIRST,
  ): CombinedDecorator {
    const self = this;
    return function (target: InstanceTarget, property?: Property, descriptor?: PropertyDescriptor) {
      // Получаем AOM-инстанс для этого конструктора
      const targetInstance = self.instance(target, property);
      return targetInstance._.callstack.add([handler, [targetInstance, descriptor]], storeFlag);
      // Вызываем обработчик
      // return handler(targetInstance, descriptor);
    };
  }

  // Используем AOMClass для 'this'
  static methodDecorator<T extends AomCore>(
    this: AomClass<T>,
    handler: AomMethodHandler<T>,
    storeFlag: ExecutionPhase = ExecutionPhase.FIRST,
  ): MethodDecorator {
    const self = this; // t теперь типа AOMClass<T>
    return function (target: InstanceTarget, property: Property, descriptor: PropertyDescriptor) {
      // Получаем AOM-инстанс для конструктора класса
      const targetInstance = self.instance(target, property);
      return targetInstance._.callstack.add([handler, [targetInstance, descriptor]], storeFlag);
      // return handler(targetInstance, descriptor);
    };
  }

  // Используем AOMClass для 'this'
  static propertyDecorator<T extends AomCore>(
    this: AomClass<T>,
    handler: AomPropertyHandler<T>,
    storeFlag: ExecutionPhase = ExecutionPhase.FIRST,
  ): PropertyDecorator {
    const self = this; // t теперь типа AOMClass<T>
    return function (target: InstanceTarget, property: Property) {
      // Получаем AOM-инстанс для конструктора класса
      const targetInstance = self.instance(target, property);
      return targetInstance._.callstack.add([handler, [targetInstance]], storeFlag);
      // return handler(targetInstance);
    };
  }

  // Используем AOMClass для 'this'
  static parameterDecorator<T extends AomCore>(
    this: AomClass<T>,
    handler: AomParameterHandler<T>,
    storeFlag: ExecutionPhase = ExecutionPhase.FIRST,
  ): ParameterDecorator {
    const self = this; // t теперь типа AOMClass<T>
    return function (target: InstanceTarget, property: Property, parameterIndex: number) {
      // Получаем AOM-инстанс для конструктора класса
      const targetInstance = self.instance(target, property);
      //
      return targetInstance._.callstack.add(
        [handler, [targetInstance, parameterIndex]],
        storeFlag,
        parameterIndex,
      );
    };
  }
}
