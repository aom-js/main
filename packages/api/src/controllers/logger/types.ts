declare type LogFunction = (...values: any[]) => void;

export interface AomLoggerEngine {
  info: LogFunction;
  log: LogFunction;
  warn: LogFunction;
  error: LogFunction;
  debug: LogFunction;
}