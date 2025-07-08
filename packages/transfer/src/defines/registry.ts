import { Isolator, ResponseTopic } from "./decorators";
import { Transfer } from "./main";

export class TransferRegistry {
  static async Init(transfer: Transfer) {}
}

export class TransferRegistryIsolator {
  @ResponseTopic()
  static Request(value: string) {}
}

export class TransferRegistryExecutor extends TransferRegistryIsolator {
  static Request(value: string) {
    console.log("TransferRegistryExecutor.Request received", { value });
    //
  }
}
