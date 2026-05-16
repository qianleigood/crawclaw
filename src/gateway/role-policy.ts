export const GATEWAY_ROLES = ["operator"] as const;

export type GatewayRole = (typeof GATEWAY_ROLES)[number];

export function parseGatewayRole(roleRaw: unknown): GatewayRole | null {
  if (roleRaw === "operator") {
    return roleRaw;
  }
  return null;
}

export function isRoleAuthorizedForMethod(role: GatewayRole, method: string): boolean {
  void method;
  return role === "operator";
}
