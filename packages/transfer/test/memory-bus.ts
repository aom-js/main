// Фейковая шина: доставка асинхронная (макротаск), как у реальных брокеров.
type BusMessage = { topic: string; message: any };
type BusSubscription = { topic: string; next: (message: any) => void; queue?: boolean };
type PortedSubscription = BusSubscription & { port?: string };

export class MemoryBus {
  readonly published: BusMessage[] = [];

  private subs: PortedSubscription[] = [];

  private muted = new Set<string>();

  subscriber = (sub: BusSubscription) => {
    this.subs.push(sub);
  };

  // именованный порт: подписки узла можно заглушить через mute (эмуляция падения узла)
  port(id: string) {
    return {
      publisher: this.publisher,
      subscriber: (sub: BusSubscription) => {
        this.subs.push({ ...sub, port: id });
      },
    };
  }

  mute(id: string) {
    this.muted.add(id);
  }

  publisher = ({ topic, message }: BusMessage) => {
    this.published.push({ topic, message });
    // доставляем через JSON, как реальный брокер: несериализуемые значения теряются намеренно
    const wire = JSON.parse(JSON.stringify(message));
    setTimeout(() => {
      this.subs
        .filter((s) => s.topic === topic && !(s.port && this.muted.has(s.port)))
        .forEach((s) => s.next(wire));
    });
  };

  topicCount(topic: string) {
    return this.published.filter((p) => p.topic === topic).length;
  }
}

export const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));
