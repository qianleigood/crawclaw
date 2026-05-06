export const ESP32_CHANNEL_ID = "esp32";
export const ESP32_HARDWARE_TARGET = "ESP32-S3-BOX-3";
export const ESP32_DEVICE_ROLE = "esp32";
export const ESP32_DEVICE_SCOPES = ["device.esp32"] as const;

export const ESP32_AFFECT_STATES = [
  "neutral",
  "listening",
  "thinking",
  "speaking",
  "success",
  "apologetic",
  "concerned",
  "confirming",
  "error",
  "muted",
  "offline",
] as const;

export type Esp32AffectState = (typeof ESP32_AFFECT_STATES)[number];

export type Esp32Affect = {
  state: Esp32AffectState;
  expression?: string;
  intensity?: number;
  led?: string;
  chime?: string;
};

export type Esp32RenderedReply = {
  spokenText: string;
  displayText: string;
  affect: Esp32Affect;
};

export type Esp32DeviceToolRisk = "low" | "medium" | "high";

export type Esp32DeviceTool = {
  name: string;
  risk?: Esp32DeviceToolRisk;
  description?: string;
};

export type Esp32DeviceCapabilities = {
  hardwareTarget?: string;
  display?: {
    width?: number;
    height?: number;
    color?: boolean;
  };
  audio?: {
    input?: "i2s" | "pdm" | "unknown";
    output?: "i2s" | "dac" | "unknown";
    codec?: string;
    opus?: boolean;
  };
  buttons?: string[];
  expressions?: string[];
  leds?: string[];
  chimes?: string[];
  tools?: Esp32DeviceTool[];
};

export type Esp32RendererConfig = {
  model?: string;
  timeoutMs?: number;
  maxSpokenChars?: number;
  maxDisplayChars?: number;
};

export type Esp32DeviceProfile = {
  hardwareTarget: typeof ESP32_HARDWARE_TARGET;
  audio: {
    input: "i2s";
    output: "i2s";
    codec: "opus";
  };
  display: {
    width: 320;
    height: 240;
    color: true;
  };
};

export type Esp32ToolCallResult = { ok: true; result: unknown } | { ok: false; error: string };
