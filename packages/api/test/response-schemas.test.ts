import { describe, it, expect } from "vitest";
import { OpenApi } from "@aom-js/router";
import { Schemer } from "@aom-js/schemer";
import { CommonResponse, ErrorMessage, MessageResponse } from "@aom-js/api";
import { RESPONSES_MESSAGE_RESPONSE_DESCRIPTION } from "../src/constants/messages";

describe("ErrorMessage: схема", () => {
  it("data необязательно: ответ без подробностей его не содержит", () => {
    const schema = new Schemer(OpenApi.refPointerPrefix).render(ErrorMessage);
    expect(schema.required).toEqual(expect.arrayContaining(["status", "message"]));
    expect(schema.required).not.toContain("data");
  });
});

describe("ResponseJSONSchema.JSONSchema: static status и description потомка", () => {
  class CreatedResponse extends CommonResponse {
    static status = 201;
    static description = "created";
  }

  it("без аргументов берёт static description и status", () => {
    expect(CreatedResponse.JSONSchema()).toMatchObject({ status: 201, description: "created" });
    expect(MessageResponse.JSONSchema()).toMatchObject({
      status: 200,
      description: RESPONSES_MESSAGE_RESPONSE_DESCRIPTION,
    });
  });

  it("аргументы вызова побеждают static", () => {
    expect(CreatedResponse.JSONSchema("explicit", 202)).toMatchObject({
      status: 202,
      description: "explicit",
      isArray: false,
    });
    expect(CreatedResponse.JSONSchema(["list"])).toMatchObject({
      status: 201,
      description: "list",
      isArray: true,
    });
  });
});
