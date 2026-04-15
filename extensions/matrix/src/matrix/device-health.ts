export type MatrixManagedDeviceInfo = {
  deviceId: string;
  displayName: string | null;
  current: boolean;
};

export type MatrixDeviceHealthSummary = {
  currentDeviceId: string | null;
  staleCrawClawDevices: MatrixManagedDeviceInfo[];
  currentCrawClawDevices: MatrixManagedDeviceInfo[];
};

const CRAWCLAW_DEVICE_NAME_PREFIX = "CrawClaw ";

export function isCrawClawManagedMatrixDevice(displayName: string | null | undefined): boolean {
  return displayName?.startsWith(CRAWCLAW_DEVICE_NAME_PREFIX) === true;
}

export function summarizeMatrixDeviceHealth(
  devices: MatrixManagedDeviceInfo[],
): MatrixDeviceHealthSummary {
  const currentDeviceId = devices.find((device) => device.current)?.deviceId ?? null;
  const crawClawDevices = devices.filter((device) =>
    isCrawClawManagedMatrixDevice(device.displayName),
  );
  return {
    currentDeviceId,
    staleCrawClawDevices: crawClawDevices.filter((device) => !device.current),
    currentCrawClawDevices: crawClawDevices.filter((device) => device.current),
  };
}
