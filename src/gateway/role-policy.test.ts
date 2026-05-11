import { describe, expect, test } from "vitest";
import {
  isRoleAuthorizedForMethod,
  parseGatewayRole,
  roleCanSkipDeviceIdentity,
} from "./role-policy.js";

describe("gateway role policy", () => {
  test("parses supported roles", () => {
    expect(parseGatewayRole("operator")).toBe("operator");
    expect(parseGatewayRole("node")).toBeNull();
    expect(parseGatewayRole("admin")).toBeNull();
    expect(parseGatewayRole(undefined)).toBeNull();
  });

  test("allows device-less bypass only for operator + shared auth", () => {
    expect(roleCanSkipDeviceIdentity("operator", true)).toBe(true);
    expect(roleCanSkipDeviceIdentity("operator", false)).toBe(false);
  });

  test("authorizes operator methods", () => {
    expect(isRoleAuthorizedForMethod("operator", "status")).toBe(true);
    expect(isRoleAuthorizedForMethod("operator", "sessions.create")).toBe(true);
  });
});
