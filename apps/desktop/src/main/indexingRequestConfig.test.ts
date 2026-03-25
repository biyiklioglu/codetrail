import { describe, expect, it } from "vitest";

import { normalizePrefetchedJsonlChunks } from "./indexingRequestConfig";

describe("normalizePrefetchedJsonlChunks", () => {
  it("keeps Uint8Array payloads intact", () => {
    const input = [
      {
        filePath: "/tmp/session.jsonl",
        fileSize: 12,
        fileMtimeMs: 1700000000000,
        startOffsetBytes: 0,
        bytes: new Uint8Array([123, 34, 97, 34, 125, 10]),
      },
    ];

    const result = normalizePrefetchedJsonlChunks(input);

    expect(result).toHaveLength(1);
    expect(result?.[0]?.bytes).toBeInstanceOf(Uint8Array);
    expect(Array.from(result?.[0]?.bytes ?? [])).toEqual([123, 34, 97, 34, 125, 10]);
  });

  it("normalizes child-process buffer-json payloads", () => {
    const result = normalizePrefetchedJsonlChunks([
      {
        filePath: "/tmp/session.jsonl",
        fileSize: 12,
        fileMtimeMs: 1700000000000,
        startOffsetBytes: 0,
        bytes: {
          type: "Buffer",
          data: [123, 34, 97, 34, 125, 10],
        },
      },
    ]);

    expect(result).toHaveLength(1);
    expect(Array.from(result?.[0]?.bytes ?? [])).toEqual([123, 34, 97, 34, 125, 10]);
  });

  it("normalizes plain numeric-keyed objects from process IPC", () => {
    const result = normalizePrefetchedJsonlChunks([
      {
        filePath: "/tmp/session.jsonl",
        fileSize: 12,
        fileMtimeMs: 1700000000000,
        startOffsetBytes: 0,
        bytes: {
          0: 123,
          1: 34,
          2: 97,
          3: 34,
          4: 125,
          5: 10,
        },
      },
    ]);

    expect(result).toHaveLength(1);
    expect(Array.from(result?.[0]?.bytes ?? [])).toEqual([123, 34, 97, 34, 125, 10]);
  });

  it("drops malformed prefetched chunks instead of passing invalid bytes through", () => {
    const result = normalizePrefetchedJsonlChunks([
      {
        filePath: "/tmp/bad.jsonl",
        fileSize: 5,
        fileMtimeMs: 1700000000000,
        startOffsetBytes: 0,
        bytes: { nope: true },
      },
    ]);

    expect(result).toBeUndefined();
  });
});
