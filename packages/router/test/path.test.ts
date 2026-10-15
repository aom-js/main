import { describe, it, expect } from "vitest";
import { compilePath } from "@aom-js/router";

describe("compilePath — the server's path grammar", () => {
  it("collects parameter names in group order and inlines validators", () => {
    const { pattern, paramNames } = compilePath("/orgs/:orgId(\\d+)/users/:userId");

    expect(paramNames).toEqual(["orgId", "userId"]);
    expect("/orgs/12/users/x".match(pattern)?.slice(1)).toEqual(["12", "x"]);
    expect(pattern.test("/orgs/ab/users/x")).toBe(false);
  });

  it("keeps the literal part of the template literal (KI-API-19)", () => {
    expect(compilePath("/file.json").pattern.test("/fileXjson")).toBe(false);
    expect(compilePath("/a+b/:id").pattern.test("/a+b/5")).toBe(true);
    expect(compilePath("/a+b/:id").pattern.test("/aab/5")).toBe(false);
  });
});
