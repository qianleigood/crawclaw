import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createTrackedTempDirs } from "../../test-utils/tracked-temp-dirs.js";
import { createContextArchiveBlobStore } from "./blob-store.js";

const tempDirs = createTrackedTempDirs();

afterEach(async () => {
  await tempDirs.cleanup();
});

describe("context archive blob store", () => {
  it("dedupes blobs by sha256 and can read them back", async () => {
    const rootDir = await tempDirs.make("context-archive-");
    const store = createContextArchiveBlobStore({ rootDir });

    const first = await store.putBlob({
      runId: "run-1",
      blobKey: "payload",
      content: { a: 1, b: ["x", "y"] },
    });
    const second = await store.putBlob({
      runId: "run-1",
      blobKey: "payload-2",
      content: { b: ["x", "y"], a: 1 },
    });

    expect(first.sha256).toBe(second.sha256);
    expect(first.path).toBe(second.path);
    expect(await fs.stat(first.path)).toBeTruthy();

    await expect(store.readBlobRecord(first.sha256)).resolves.toMatchObject({
      sha256: first.sha256,
      contentType: "application/json; charset=utf-8",
    });
    await expect(store.readBlobJson<{ a: number; b: string[] }>(first.sha256)).resolves.toEqual({
      a: 1,
      b: ["x", "y"],
    });
  });

  it("stores text blobs as utf8 and preserves content", async () => {
    const rootDir = await tempDirs.make("context-archive-");
    const store = createContextArchiveBlobStore({ rootDir });

    const blob = await store.putBlob({
      runId: "run-2",
      blobKey: "text",
      content: "hello world",
    });
    expect(blob.contentType).toContain("text/plain");
    await expect(store.readBlobText(blob.sha256)).resolves.toBe("hello world");
    await expect(
      fs.readFile(path.join(rootDir, "blobs", `${blob.sha256}.blob`), "utf8"),
    ).resolves.toBe("hello world");
  });

  it("respects explicit content types", async () => {
    const rootDir = await tempDirs.make("context-archive-");
    const store = createContextArchiveBlobStore({ rootDir });

    const blob = await store.putBlob({
      runId: "run-3",
      blobKey: "markdown",
      content: "# hello",
      contentType: "text/markdown; charset=utf-8",
    });

    expect(blob.contentType).toBe("text/markdown; charset=utf-8");
    await expect(store.readBlobText(blob.sha256)).resolves.toBe("# hello");
  });
});
