import { vi } from "vitest";
import type { MockFn } from "../test-utils/vitest-mock-fn.js";

const readConfigFileSnapshotMock = vi.fn() as unknown as MockFn;
const writeConfigFileMock = vi.fn().mockResolvedValue(undefined) as unknown as MockFn;
const replaceConfigFileMock = vi.fn(async (params: { nextConfig: unknown }) => {
  await writeConfigFileMock(params.nextConfig);
}) as unknown as MockFn;

export const configMocks: {
  readConfigFileSnapshot: MockFn;
  writeConfigFile: MockFn;
  replaceConfigFile: MockFn;
} = {
  readConfigFileSnapshot: readConfigFileSnapshotMock,
  writeConfigFile: writeConfigFileMock,
  replaceConfigFile: replaceConfigFileMock,
};

vi.mock("../config/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../config/config.js")>();
  return {
    ...actual,
    readConfigFileSnapshot: configMocks.readConfigFileSnapshot,
    writeConfigFile: configMocks.writeConfigFile,
    replaceConfigFile: configMocks.replaceConfigFile,
  };
});
