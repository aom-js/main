import { ClassConstructor, CombinedDecorator, Constructor, Property } from "../../common/types";
import { checkConstructorProperty } from "./functions";

declare type AOMHandler<T extends AOMCore> = ($: T) => void;

declare type AOMСombinedHandler<T extends AOMCore> = (
  $: T,
  descriptor?: PropertyDescriptor
) => void;

declare type AOMMethodHandler<T extends AOMCore> = (
  $: T,
  descriptor: PropertyDescriptor
) => PropertyDescriptor | void;

declare type AOMParameterHandler<T extends AOMCore> = ($: T, parameterIndex: number) => void;

// Вспомогательный тип, объединяющий сигнатуру конструктора и статические методы AOM
type AOMClass<T extends AOMCore> = ClassConstructor<T> & typeof AOMCore;

class $aomNode<T extends AOMCore> {
  base: AOMClass<T>;

  target: ClassConstructor;

  property?: Property;

  currentProperty: T | undefined;

  root: T;

  self: T;

  propertiesSet: Set<ClassConstructor>;

  propertiesMap: Map<ClassConstructor, T>;

  constructor(self: T, base: AOMClass<any>, target: ClassConstructor, property?: Property) {
    this.self = self;
    this.base = base;
    this.target = target;
    this.property = property;
    this.propertiesMap = new Map();
    this.propertiesSet = new Set();

    // если указано конкретное свойство, то зафиксируем с ним связь в инстансе от исходного конструктора
    if (property) {
      this.root = this.base.instance(target);
      this.root._.propertiesMap.set(target[property], this.self);
      //
      this.root._.propertiesSet.add(target[property]);
    } else {
      this.root = this.self;
    }
  }
}

export class AOMCore {
  _: $aomNode<this>;

  constructor(base: AOMClass<any>, target: ClassConstructor, property?: Property) {
    this._ = new $aomNode<this>(this, base, target, property);
  }

  static instance<T extends AOMCore>(
    this: AOMClass<T>,
    target: Constructor,
    property?: Property
  ): T {
    // Используем Symbol для уникального ключа карты на каждом классе-наследнике
    const mapSymbol = Symbol.for(`AOM_MAP_${this.name}`);

    // Проверяем, есть ли карта у этого конкретного класса ('this')
    if (!(this as any)[mapSymbol]) {
      // Если нет, создаем её
      (this as any)[mapSymbol] = new WeakMap<Constructor, T>();
    }
    // Получаем ссылку на карту
    const map: WeakMap<Constructor, T> = (this as any)[mapSymbol];

    // Ищем существующий инстанс для target в карте этого класса
    // если указано property, то экземпляр класса хранится по хендлеру функции
    let instance = map.get(property ? target[property] : target);

    // Если инстанса нет
    if (!instance) {
      // Создаем новый инстанс текущего класса ('this')
      instance = new this(this, <ClassConstructor>target, property);
      // Сохраняем его в карте
      map.set(target, instance);
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
      checkConstructorProperty(target);
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
      checkConstructorProperty(target, property);
      // Получаем AOM-инстанс для этого конструктора
      const targetInstance = self.instance(target, property);
      // Вызываем обработчик
      return handler(targetInstance, descriptor);
    };
  }

  // Используем AOMClass для 'this'
  static staticDecorator<T extends AOMCore>(
    this: AOMClass<T>,
    handler: AOMMethodHandler<T>
  ): MethodDecorator {
    const self = this; // t теперь типа AOMClass<T>
    return function (target: Constructor, property: Property, descriptor: PropertyDescriptor) {
      checkConstructorProperty(target, property);
      // Определяем конструктор класса (target может быть прототипом или конструктором)
      // const targetConstructor = (target instanceof Function ? target : target.constructor) as ClassConstructor;
      // Проверка, что смогли определить конструктор
      // if (typeof targetConstructor !== 'function' || !targetConstructor.prototype) {
      //    console.error('[AOM] Method decorator could not determine target constructor:', target);
      //    return descriptor; // Возвращаем исходный дескриптор при ошибке
      // }
      // Получаем AOM-инстанс для конструктора класса
      const aomInstance = self.instance(target, property);
      // Вызываем обработчик
      return handler(aomInstance, descriptor);
    };
  }

  // Используем AOMClass для 'this'
  static parameterDecorator<T extends AOMCore>(
    this: AOMClass<T>,
    handler: AOMParameterHandler<T>
  ): ParameterDecorator {
    const self = this; // t теперь типа AOMClass<T>
    return function (target: Constructor, property: Property, parameterIndex: number) {
      checkConstructorProperty(target, property);

      // Определяем конструктор класса (target может быть прототипом или конструктором)
      // const targetConstructor = (target instanceof Function ? target : target.constructor) as ClassConstructor;
      // Проверка, что смогли определить конструктор
      // if (typeof targetConstructor !== 'function' || !targetConstructor.prototype) {
      //    console.error('[AOM] Method decorator could not determine target constructor:', target);
      //    return descriptor; // Возвращаем исходный дескриптор при ошибке
      // }
      // Получаем AOM-инстанс для конструктора класса
      const aomInstance = self.instance(target, property);
      // aomInstance.setCurrentProperty(property);
      // Вызываем обработчик
      return handler(aomInstance, parameterIndex);
    };
  }
}
