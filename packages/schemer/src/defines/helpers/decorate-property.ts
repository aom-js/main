import { InstanceTarget, Property } from "@aom-js/core";

/**
 * Применение набора декораторов к свойству.
 *
 * Два приведения, которых требует strict:
 * 1. `.filter(Boolean)` не сужает тип, а список собирается из условных выражений
 *    (`params.isOptional ? IsOptional() : undefined`), поэтому в нём есть `undefined`.
 * 2. class-transformer отдаёт комбинированные декораторы с сигнатурой
 *    `(target, propertyName?: string)`, что по вариантности не `PropertyDecorator`.
 *    Практически безопасно: schemer декорирует только строковые свойства.
 *
 * `property` в контексте `AomSchemas.propertyDecorator` всегда задано.
 */
export function decorateProperty(
  decorators: unknown[],
  target: InstanceTarget,
  property: Property | undefined,
) {
  Reflect.decorate(decorators.filter(Boolean) as PropertyDecorator[], target, property as Property);
}
