// Side-effect import: `Delay`/`Apply` call `Reflect.decorate`, which is not a
// native JS API — it's installed onto the global `Reflect` object by the
// `reflect-metadata` polyfill. Import from this entry point (not directly
// from "./decorators") to make sure it's loaded.
import "reflect-metadata";

export * from "./decorators";
