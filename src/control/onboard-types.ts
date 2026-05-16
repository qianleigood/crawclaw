export type AuthChoice = string;
export type AuthChoiceGroupId = string;
export type GatewayAuthChoice = string;
export type SecretInputMode = "plaintext" | "ref";
export type OnboardOutputPreset = "quiet" | "balanced" | "operator";
export type NodeManagerChoice = string;
export type OnboardMode = "local" | "remote";
export type ResetScope = string;

export type OnboardOptions = {
  [key: string]: unknown;
  daemonRuntime?: "node" | "bun";
  installDaemon?: boolean;
  nonInteractive?: boolean;
  quickstartDefaults?: boolean;
  secretInputMode?: SecretInputMode;
  skipHealth?: boolean;
  skipUi?: boolean;
  tokenProvider?: string;
};
