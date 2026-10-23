/**
 * `@aom-js/api/testing` — facts about route chains: the kind of each step and the dump of a router.
 *
 * The kind is derived from the classes of this package (access gate, parameter builders, ID
 * controllers); the application adds its own kinds through `ManifestOptions.kindOf`.
 */
import "reflect-metadata";

export {
  describe,
  describeRouter,
  kindOf,
  manifestOf,
  type DescribedRoute,
  type DescribedStep,
  type ManifestOptions,
} from "./manifest";
