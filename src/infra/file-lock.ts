export type { FileLockHandle, FileLockOptions } from "../internal-plugin-helpers/file-lock.js";
export {
  acquireFileLock,
  drainFileLockStateForTest,
  resetFileLockStateForTest,
  withFileLock,
} from "../internal-plugin-helpers/file-lock.js";
