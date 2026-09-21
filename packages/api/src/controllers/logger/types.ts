declare type LogFunction = (...values: any[]) => void;

/**
 * Shape required of a logging backend assigned to `Logger.ENGINE`. `console` satisfies it out of
 * the box; most structured loggers (`pino`, `winston`) do too.
 */
export interface AomLoggerEngine {
  info: LogFunction;
  log: LogFunction;
  warn: LogFunction;
  error: LogFunction;
  debug: LogFunction;
}
