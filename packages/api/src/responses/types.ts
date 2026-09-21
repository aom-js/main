/** Plain-object shape of a serialized `ErrorMessage` (its `toJSON()` result). Not part of the package's public entry point. */
export interface IErrorData {
  message: string;
  status: number;
  data?: any;
}
