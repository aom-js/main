import { isClass, ClassConstructor, CombinedDecorator, Constructor, Property } from "./defines";

declare type AomHandler<T extends AomCore> = ($: T) => void;

declare type AomСombinedHandler<T extends AomCore> = (
  $: T,
  descriptor?: PropertyDescriptor
) => void;

declare type AomMethodHandler<T extends AomCore> = (
  $: T,
  descriptor: PropertyDescriptor
) => PropertyDescriptor | void;

declare type AomPropertyHandler<T extends AomCore> = ($: T) => void;

declare type AomParameterHandler<T extends AomCore> = ($: T, parameterIndex: number) => void;

// Вспомогательный тип, объединяющий сигнатуру конструктора и статические методы AOM
type AomClass<T extends AomCore> = ClassConstructor<T> & typeof AomCore;

class AomNode<T extends AomCore> {
  base: AomClass<T>;

  target: ClassConstructor;

  property?: Property;

  currentProperty: T | undefined;

  // корневая структура для
  root: T;

  self: T;

  properties: Map<Property, T>;

  statics: Map<Property, T>;

  constructor(self: T, base: AomClass<any>, target: ClassConstructor, property?: Property) {
    this.self = self;
    this.base = base;
    this.target = target;
    this.property = property;

    this.properties = new Map();
    this.statics = new Map();

    // если указано конкретное свойство, то зафиксируем с ним связь в инстансе от исходного конструктора
    if (property) {
      this.root = this.base.instance(target);
    } else {
      this.root = this.self;
    }
  }
}

type InstanceTarget = Constructor | object;

export class AomCore {
  _: AomNode<this>;

  constructor(base: AomClass<any>, target: ClassConstructor, property?: Property) {
    this._ = new AomNode<this>(this, base, target, property);
  }

  private static instancesMap<T extends AomCore, E extends InstanceTarget>(this: AomClass<T>) {
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
    property?: K & Property
  ): T | E {
    // извлечем конструктор, который будет корневым
    const constructor = (
      target instanceof Function ? target : target.constructor
    ) as ClassConstructor;

    let instanceKey: T | E;
    // если указано конкретное свойство, и текущий контекст происходит для конкретного класса
    if (property && isClass(constructor)) {
      // извлечем его собственный инстанс
      const constructorInstance = this.instance(constructor);
      const descriptor = Reflect.getOwnPropertyDescriptor(target, property);
      if (descriptor && !descriptor.enumerable) {
        // если это метод, то возьмем в качестве ключа инстанса значение дескриптора
        // на которое будет ссылаться и метод по его названию
        instanceKey = descriptor.value as E;
      } else {
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
          // создадим интанс
          instanceKey = new this(this, constructor, property);
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
    property?: K & Property
  ): T | undefined {
    const map = this.instancesMap();

    const instanceKey = this.instanceKey(target, property);

    return map.get(instanceKey);
  }

  static instance<T extends AomCore, E extends InstanceTarget, K = keyof E>(
    this: AomClass<T>,
    target: E,
    property?: K & Property
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

    // Если инстанса нет
    if (!instance) {
      // Создаем новый инстанс текущего класса ('this')
      instance = new this(this, constructor, property);
      // Сохраняем его в карте
      map.set(instanceKey, instance);
    } else if (property && instance._.target !== constructor) {
      // тут хитрый момент, который может произойти, если инстанс для какой-то статистической функции был создан раньше,
      // чем объявлен какой-то полезный декоратор для самого свойства
      // в этом случае для него следует заменить значение `_` на корректное, с учетом правильных target, root и property
      instance._ = new AomNode(instance, this, constructor, property);
    }

    // Возвращаем найденный или созданный инстанс
    return instance;
  }

  // Используем AOMClass для 'this'
  static classDecorator<T extends AomCore>(
    this: AomClass<T>,
    handler: AomHandler<T>
  ): ClassDecorator {
    const self = this; // t теперь типа AOMClass<T>
    return function (target: Constructor) {
      // Получаем AOM-инстанс для этого конструктора
      const targetInstance = self.instance(target);
      // Вызываем обработчик
      return handler(targetInstance);
      // Классные декораторы могут возвращать конструктор, но здесь мы только для сайд-эффекта
    };
  }

  // Используем AOMClass для 'this'
  static combinedDecorator<T extends AomCore>(
    this: AomClass<T>,
    handler: AomСombinedHandler<T>
  ): CombinedDecorator {
    const self = this;
    return function (target: Constructor, property?: Property, descriptor?: PropertyDescriptor) {
      // Получаем AOM-инстанс для этого конструктора
      const targetInstance = self.instance(target, property);
      // Вызываем обработчик
      return handler(targetInstance, descriptor);
    };
  }

  // Используем AOMClass для 'this'
  static methodDecorator<T extends AomCore>(
    this: AomClass<T>,
    handler: AomMethodHandler<T>
  ): MethodDecorator {
    const self = this; // t теперь типа AOMClass<T>
    return function (target: Constructor, property: Property, descriptor: PropertyDescriptor) {
      // Получаем AOM-инстанс для конструктора класса
      const aomInstance = self.instance(target, property);
      // Вызываем обработчик
      return handler(aomInstance, descriptor);
    };
  }

  // Используем AOMClass для 'this'
  static propertyDecorator<T extends AomCore>(
    this: AomClass<T>,
    handler: AomPropertyHandler<T>
  ): PropertyDecorator {
    const self = this; // t теперь типа AOMClass<T>
    return function (target: Constructor, property: Property) {
      // Получаем AOM-инстанс для конструктора класса
      const aomInstance = self.instance(target, property);
      // Вызываем обработчик
      return handler(aomInstance);
    };
  }

  // Используем AOMClass для 'this'
  static parameterDecorator<T extends AomCore>(
    this: AomClass<T>,
    handler: AomParameterHandler<T>
  ): ParameterDecorator {
    const self = this; // t теперь типа AOMClass<T>
    return function (target: Constructor, property: Property, parameterIndex: number) {
      // Получаем AOM-инстанс для конструктора класса
      const aomInstance = self.instance(target, property);
      // aomInstance.setCurrentProperty(property);
      // Вызываем обработчик
      return handler(aomInstance, parameterIndex);
    };
  }
}
