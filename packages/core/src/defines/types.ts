import { ClassConstructor, CombinedDecorator, Constructor, isClass, Property } from "@aom/common";

declare type AOMHandler<T extends AOMCore> = ($: T) => void;

declare type AOMСombinedHandler<T extends AOMCore> = (
  $: T,
  descriptor?: PropertyDescriptor
) => void;

declare type AOMMethodHandler<T extends AOMCore> = (
  $: T,
  descriptor: PropertyDescriptor
) => PropertyDescriptor | void;

declare type AOMPropertyHandler<T extends AOMCore> = ($: T) => void;

declare type AOMParameterHandler<T extends AOMCore> = ($: T, parameterIndex: number) => void;

// Вспомогательный тип, объединяющий сигнатуру конструктора и статические методы AOM
type AOMClass<T extends AOMCore> = ClassConstructor<T> & typeof AOMCore;

class $aomNode<T extends AOMCore> {
  base: AOMClass<T>;

  target: ClassConstructor;

  property?: Property;

  currentProperty: T | undefined;

  // корневая структура для
  root: T;

  self: T;

  properties: Map<Property, T>;

  statics: Map<Property, T>;

  constructor(self: T, base: AOMClass<any>, target: ClassConstructor, property?: Property) {
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

export class AOMCore {
  _: $aomNode<this>;

  constructor(base: AOMClass<any>, target: ClassConstructor, property?: Property) {
    this._ = new $aomNode<this>(this, base, target, property);
  }

  private static instancesMap<T extends AOMCore, E extends InstanceTarget>(this: AOMClass<T>) {
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

  private static instanceKey<T extends AOMCore, E extends InstanceTarget, K = keyof E>(
    this: AOMClass<T>,
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

  static checkExists<T extends AOMCore, E extends InstanceTarget, K = keyof E>(
    this: AOMClass<T>,
    target: E,
    property?: K & Property
  ): T | undefined {
    const map = this.instancesMap();

    const instanceKey = this.instanceKey(target, property);

    return map.get(instanceKey);
  }

  static instance<T extends AOMCore, E extends InstanceTarget, K = keyof E>(
    this: AOMClass<T>,
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
      instance._ = new $aomNode(instance, this, constructor, property);
    }

    // Возвращаем найденный или созданный инстанс
    return instance;
  }

  // Используем AOMClass для 'this'
  static classDecorator<T extends AOMCore>(
    this: AOMClass<T>,
    handler: AOMHandler<T>
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
  static combinedDecorator<T extends AOMCore>(
    this: AOMClass<T>,
    handler: AOMСombinedHandler<T>
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
  static methodDecorator<T extends AOMCore>(
    this: AOMClass<T>,
    handler: AOMMethodHandler<T>
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
  static propertyDecorator<T extends AOMCore>(
    this: AOMClass<T>,
    handler: AOMPropertyHandler<T>
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
  static parameterDecorator<T extends AOMCore>(
    this: AOMClass<T>,
    handler: AOMParameterHandler<T>
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
