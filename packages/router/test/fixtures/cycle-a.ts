// Половина настоящего цикла импортов: контроллер ссылается на шаги CycleGuard из cycle-b,
// а cycle-b импортирует этот модуль. Тест грузит cycle-b первым, поэтому к объявлению
// CycleApp класс CycleGuard ещё не инициализирован.
import { After, Before, Controller, FwdRef, Get, Next, UseMarker } from "@aom-js/router";
import { CycleGuard } from "./cycle-b";

@Controller()
@Before(FwdRef(() => CycleGuard.check))
@After(FwdRef(() => CycleGuard.after))
export class CycleApp {
  static calls: string[] = [];

  @Get("/cycle")
  @Next(FwdRef(() => CycleGuard.next))
  @UseMarker(FwdRef(() => CycleGuard.mark))
  static async hello() {
    CycleApp.calls.push("endpoint");
  }
}
