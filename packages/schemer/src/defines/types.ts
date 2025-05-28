import { ClassConstructor } from "@aom-js/core";

export declare type ConnectionSchema = (() => ClassConstructor) | ClassConstructor;

/**
 * Тип обработчика для рендеринга
 * Функция для рендеринга входящего класса
 */
export declare type RenderHandler = (target: ClassConstructor) => any;

/**
 * Интерфейс конфигурации JSONSchema генератора
 * Определяет настройки и обработчики для экземпляра изолятора
 */
export declare interface SchemerConfig {
  /** Функция для рендера */
  render: RenderHandler;
}
