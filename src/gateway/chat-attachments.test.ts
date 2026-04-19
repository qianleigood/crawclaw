import { beforeEach, describe, expect, it, vi } from "vitest";
import { type ChatAttachment, parseMessageWithAttachments } from "./chat-attachments.js";

const {
  extractFileContentFromSourceMock,
  transcribeAudioFileMock,
  saveMediaBufferMock,
  deleteMediaBufferMock,
} = vi.hoisted(() => ({
  extractFileContentFromSourceMock: vi.fn(),
  transcribeAudioFileMock: vi.fn(),
  saveMediaBufferMock: vi.fn(
    async (
      _buffer: Buffer,
      mimeType?: string,
      _subdir?: string,
      _maxBytes?: number,
      fileName?: string,
    ) => ({
      id: `${fileName ?? "media"}-id`,
      path: `/tmp/${fileName ?? "media"}`,
      size: 123,
      contentType: mimeType,
    }),
  ),
  deleteMediaBufferMock: vi.fn(async (_id: string, _subdir?: "inbound") => {}),
}));

vi.mock("../media/input-files.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../media/input-files.js")>();
  return {
    ...actual,
    extractFileContentFromSource: (
      ...args: Parameters<typeof actual.extractFileContentFromSource>
    ) => extractFileContentFromSourceMock(...args),
  };
});

vi.mock("../media-understanding/transcribe-audio.js", () => ({
  transcribeAudioFile: (
    ...args: Parameters<
      typeof import("../media-understanding/transcribe-audio.js").transcribeAudioFile
    >
  ) => transcribeAudioFileMock(...args),
}));

vi.mock("../media/store.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../media/store.js")>();
  return {
    ...actual,
    saveMediaBuffer: (...args: Parameters<typeof actual.saveMediaBuffer>) =>
      saveMediaBufferMock(...args),
    deleteMediaBuffer: (...args: Parameters<typeof actual.deleteMediaBuffer>) =>
      deleteMediaBufferMock(...args),
  };
});

beforeEach(() => {
  vi.clearAllMocks();
});

const PNG_1x1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/woAAn8B9FD5fHAAAAAASUVORK5CYII=";

async function parseWithWarnings(message: string, attachments: ChatAttachment[]) {
  const logs: string[] = [];
  const parsed = await parseMessageWithAttachments(message, attachments, {
    log: { warn: (warning) => logs.push(warning) },
  });
  return { parsed, logs };
}

describe("parseMessageWithAttachments", () => {
  it("extracts PDF content into message text and images", async () => {
    extractFileContentFromSourceMock.mockResolvedValueOnce({
      filename: "report.pdf",
      text: "Quarterly summary",
      images: [{ type: "image", data: PNG_1x1, mimeType: "image/png" }],
    });
    const pdf = Buffer.from("%PDF-1.4\n").toString("base64");

    const parsed = await parseMessageWithAttachments(
      "please review",
      [
        {
          type: "file",
          mimeType: "application/pdf",
          fileName: "report.pdf",
          content: pdf,
        },
      ],
      { log: { warn: () => {} } },
    );

    expect(parsed.message).toContain("Attached PDF: report.pdf");
    expect(parsed.message).toContain("Quarterly summary");
    expect(parsed.images).toHaveLength(1);
    expect(parsed.additionalMedia).toHaveLength(1);
  });

  it("transcribes audio into message text", async () => {
    transcribeAudioFileMock.mockResolvedValueOnce({ text: "voice memo text" });
    const audio = Buffer.from("fake-audio").toString("base64");

    const parsed = await parseMessageWithAttachments(
      "note",
      [
        {
          type: "file",
          mimeType: "audio/mpeg",
          fileName: "memo.mp3",
          content: audio,
        },
      ],
      { cfg: {} as never, log: { warn: () => {} } },
    );

    expect(parsed.message).toContain("Attached audio: memo.mp3");
    expect(parsed.message).toContain("voice memo text");
    expect(parsed.additionalMedia).toHaveLength(1);
  });

  it("strips data URL prefix", async () => {
    const parsed = await parseMessageWithAttachments(
      "see this",
      [
        {
          type: "image",
          mimeType: "image/png",
          fileName: "dot.png",
          content: `data:image/png;base64,${PNG_1x1}`,
        },
      ],
      { log: { warn: () => {} } },
    );
    expect(parsed.images).toHaveLength(1);
    expect(parsed.images[0]?.mimeType).toBe("image/png");
    expect(parsed.images[0]?.data).toBe(PNG_1x1);
  });

  it("sniffs mime when missing", async () => {
    const { parsed, logs } = await parseWithWarnings("see this", [
      {
        type: "image",
        fileName: "dot.png",
        content: PNG_1x1,
      },
    ]);
    expect(parsed.message).toBe("see this");
    expect(parsed.images).toHaveLength(1);
    expect(parsed.images[0]?.mimeType).toBe("image/png");
    expect(parsed.images[0]?.data).toBe(PNG_1x1);
    expect(logs).toHaveLength(0);
  });

  it("drops unsupported binary payloads and logs", async () => {
    const payload = Buffer.from("not media").toString("base64");
    const { parsed, logs } = await parseWithWarnings("x", [
      {
        type: "file",
        fileName: "blob.bin",
        content: payload,
      },
    ]);
    expect(parsed.images).toHaveLength(0);
    expect(parsed.additionalMedia).toHaveLength(0);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatch(/unsupported|mime/i);
  });

  it("prefers sniffed mime type and logs mismatch", async () => {
    const { parsed, logs } = await parseWithWarnings("x", [
      {
        type: "image",
        mimeType: "image/jpeg",
        fileName: "dot.png",
        content: PNG_1x1,
      },
    ]);
    expect(parsed.images).toHaveLength(1);
    expect(parsed.images[0]?.mimeType).toBe("image/png");
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatch(/mime mismatch/i);
  });

  it("drops unknown mime when sniff fails and logs", async () => {
    const unknown = Buffer.from("not an image").toString("base64");
    const { parsed, logs } = await parseWithWarnings("x", [
      { type: "file", fileName: "unknown.bin", content: unknown },
    ]);
    expect(parsed.images).toHaveLength(0);
    expect(parsed.additionalMedia).toHaveLength(0);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatch(/unsupported|mime/i);
  });

  it("keeps valid images and reclassifies mismatched PDFs", async () => {
    extractFileContentFromSourceMock.mockResolvedValueOnce({
      filename: "not-image.pdf",
      text: "Recovered PDF text",
      images: [],
    });
    const pdf = Buffer.from("%PDF-1.4\n").toString("base64");
    const { parsed, logs } = await parseWithWarnings("x", [
      {
        type: "image",
        mimeType: "image/png",
        fileName: "dot.png",
        content: PNG_1x1,
      },
      {
        type: "file",
        mimeType: "image/png",
        fileName: "not-image.pdf",
        content: pdf,
      },
    ]);
    expect(parsed.images).toHaveLength(1);
    expect(parsed.images[0]?.mimeType).toBe("image/png");
    expect(parsed.images[0]?.data).toBe(PNG_1x1);
    expect(parsed.additionalMedia).toHaveLength(1);
    expect(parsed.message).toContain("Attached PDF: not-image.pdf");
    expect(parsed.message).toContain("Recovered PDF text");
    expect(logs.some((l) => /mime mismatch/i.test(l))).toBe(true);
  });
});

describe("shared attachment validation", () => {
  it("rejects invalid base64 content for parser", async () => {
    const bad: ChatAttachment = {
      type: "image",
      mimeType: "image/png",
      fileName: "dot.png",
      content: "%not-base64%",
    };

    await expect(
      parseMessageWithAttachments("x", [bad], { log: { warn: () => {} } }),
    ).rejects.toThrow(/base64/i);
  });

  it("rejects images over limit for parser without decoding base64", async () => {
    const big = "A".repeat(10_000);
    const att: ChatAttachment = {
      type: "image",
      mimeType: "image/png",
      fileName: "big.png",
      content: big,
    };

    const fromSpy = vi.spyOn(Buffer, "from");
    try {
      await expect(
        parseMessageWithAttachments("x", [att], { maxBytes: 16, log: { warn: () => {} } }),
      ).rejects.toThrow(/exceeds size limit/i);
      const base64Calls = fromSpy.mock.calls.filter((args) => (args as unknown[])[1] === "base64");
      expect(base64Calls).toHaveLength(0);
    } finally {
      fromSpy.mockRestore();
    }
  });
});
