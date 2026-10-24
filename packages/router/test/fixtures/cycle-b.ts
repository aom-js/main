// Вторая половина цикла импортов (см. cycle-a.ts): шаги, которые CycleApp подключает
// через FwdRef, и обратная ссылка на CycleApp — корень монтирует его через @Bridge.
import { Bridge, Controller, Marker, Middleware, Nextpoint, type AomRoute } from "@aom-js/router";
import { CycleApp } from "./cycle-a";

@Controller()
@Bridge("/app", CycleApp)
export class CycleGuard {
  @Middleware()
  static async check() {
    CycleApp.calls.push("check");
  }

  @Middleware()
  static async after() {
    CycleApp.calls.push("after");
  }

  @Nextpoint()
  static async next() {
    CycleApp.calls.push("next");
    return "done";
  }

  @Marker()
  static mark(route: AomRoute) {
    route.markers.cycle = true;
  }
}
