// Shared session transcript archival surface used by reset/delete maintenance flows.
// The underlying file operations still live in the existing gateway fs helper.
export {
  archiveFileOnDisk,
  archiveSessionTranscripts,
  cleanupArchivedSessionTranscripts,
} from "../gateway/session-transcript-files.fs.js";
