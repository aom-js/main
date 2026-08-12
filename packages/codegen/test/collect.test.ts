import { describe, it, expect } from "vitest";
import { collect, CollectSource, TransferServiceDescriptor } from "@aom-js/codegen";

const descriptor = (name: string, hash: string): TransferServiceDescriptor => ({
  name,
  hash,
  origin: { instanceName: "n", instanceKey: "k" },
  methods: [],
  components: {},
});

describe("codegen: снапшот реестра", () => {
  it("собирает дескрипторы от нескольких узлов до таймаута, LWW по имени, сортировка", async () => {
    const source: CollectSource = {
      collectDistributions(handler) {
        // отвечают три узла: второй перебивает первый по тому же имени
        handler({ instance: { instanceName: "a", instanceKey: "1" }, value: [descriptor("B", "old")] });
        handler({ instance: { instanceName: "b", instanceKey: "2" }, value: [descriptor("B", "new")] });
        setTimeout(() => {
          handler({ instance: { instanceName: "c", instanceKey: "3" }, value: [descriptor("A", "x")] });
        }, 5);
      },
    };
    const collected = await collect(source, 20);
    expect(collected.map((d) => [d.name, d.hash])).toEqual([
      ["A", "x"],
      ["B", "new"],
    ]);
  });

  it("ответ после таймаута не попадает в снапшот", async () => {
    const source: CollectSource = {
      collectDistributions(handler) {
        setTimeout(() => {
          handler({ instance: { instanceName: "late", instanceKey: "9" }, value: [descriptor("Late", "z")] });
        }, 30);
      },
    };
    const collected = await collect(source, 10);
    expect(collected).toEqual([]);
  });
});
