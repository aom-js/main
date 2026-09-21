import { AomCore, CombinedDecorator } from "@aom-js/core";

/**
 * The package's own meta-class (`@aom-js/core` `AomCore` subclass), giving
 * `Hold`/`Delay`/`Apply` an independent registry of meta-instances, separate
 * from any other package's meta-class (`AomApi`, `AomSchemas`, etc.). Not
 * exported from `@aom-js/holder`'s entry point — application code never
 * references `AomHolder` directly, only the three decorators built on it.
 */
export class AomHolder extends AomCore {
  /**
   * Decorators accumulated for this meta-instance, not yet applied via
   * `Reflect.decorate`. For a class meta-instance, holds class decorators
   * passed to `Delay`/`Apply`; for a property meta-instance, holds property
   * decorators passed to `Hold`. The two uses share this one field because
   * `Hold`'s decorators are typed `PropertyDecorator[]` while the field
   * itself is typed `CombinedDecorator[]` — see the cast comments in
   * `decorators.ts`.
   */
  queue: CombinedDecorator[] = [];
}
