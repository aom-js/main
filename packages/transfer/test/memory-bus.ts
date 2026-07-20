// Фейковая шина: доставка асинхронная (макротаск), как у реальных брокеров.
type BusMessage = { topic: string; message: any };
type BusSubscription = { topic: string; next: (message: any) => void; queue?: boolean };

export class MemoryBus {
  readonly published: BusMessage[] = [];

  private subs: BusSubscription[] = [];

  subscriber = (sub: BusSubscription) => {
    this.subs.push(sub);
  };

  publisher = ({ topic, message }: BusMessage) => {
    this.published.push({ topic, message });
    setTimeout(() => {
      this.subs.filter((s) => s.topic === topic).forEach((s) => s.next(message));
    });
  };

  topicCount(topic: string) {
    return this.published.filter((p) => p.topic === topic).length;
  }
}

export const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));
