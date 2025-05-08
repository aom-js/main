import { ClassConstructor, Constructor } from "./types";

// Создаем класс-обертку
export class ClassInstanceMap {
  // Внутренний WeakMap хранит конструкторы и базовые объекты
  private map = new WeakMap<Constructor, object>();

  // Типизированный метод set
  // Он гарантирует, что передаваемое значение (value) является экземпляром класса-ключа (key)
  set<T extends object>(key: ClassConstructor<T>, value: T): this {
    this.map.set(key, value);
    return this;
  }

  // Типизированный метод get
  // Он возвращает значение с правильным типом экземпляра или undefined
  get<T extends object>(key: ClassConstructor<T>): T | undefined {
    // Используем утверждение типа (as), так как TypeScript не может
    // автоматически вывести точный тип из внутреннего WeakMap<..., object>
    return this.map.get(key) as T | undefined;
  }

  // Метод has остается без изменений
  has<T extends object>(key: ClassConstructor<T>): boolean {
    return this.map.has(key);
  }

  // Метод delete остается без изменений
  delete<T extends object>(key: ClassConstructor<T>): boolean {
    return this.map.delete(key);
  }
}
