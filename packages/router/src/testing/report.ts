import type { CreatedRecord } from "../common/context";

export type CheckResult = { probe: string; check: string; ok: boolean; error?: string };

/**
 * Collects the verdicts of one run. Brings no assertion library of its own — it takes a ready
 * flag or a closure with someone else's matcher.
 */
export class TesterReport {
  readonly results: CheckResult[] = [];

  /** Error of the route run of the current input, if it failed. Probes run anyway; other inputs never see it. */
  routeError?: unknown;

  /** Objects the route run of the current input created, as they entered the state. Diagnostics only. */
  created?: CreatedRecord[];

  /** Title of the current probe; set by the runner before each one. */
  probe = "";

  /** How many assertions were made in total. Zero for one probe fails that probe. */
  private counter = 0;

  get checks() {
    return this.counter;
  }

  get failures() {
    return this.results.filter((r) => !r.ok);
  }

  /**
   * Records an assertion: either a ready flag or a closure with a matcher.
   *
   * The flag is the main form: probes live next to the code they check, and dragging a test
   * runner there is pointless. The closure is for where the matcher's detailed message
   * matters — but such a probe already depends on an assertion library.
   */
  check(name: string, assertion: boolean | (() => void)): this {
    this.counter += 1;

    if (typeof assertion === "boolean") {
      this.results.push({
        probe: this.probe,
        check: name,
        ok: assertion,
        ...(assertion ? {} : { error: "condition not met" }),
      });
      return this;
    }

    try {
      assertion();
      this.results.push({ probe: this.probe, check: name, ok: true });
    } catch (error) {
      this.results.push({
        probe: this.probe,
        check: name,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return this;
  }

  /** A record that the probe itself broke the rules — not about the code under check. */
  violation(probe: string, what: string, error: string) {
    this.results.push({ probe, check: what, ok: false, error });
  }
}
