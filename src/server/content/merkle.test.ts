import { describe, expect, it } from "vitest";
import {
  buildTree,
  diffTrees,
  hashBlob,
  merkleRoot,
} from "./merkle";

describe("merkle", () => {
  it("hashes blobs deterministically", () => {
    expect(hashBlob("hello")).toBe(hashBlob("hello"));
    expect(hashBlob("hello")).not.toBe(hashBlob("world"));
  });

  it("builds a stable tree root regardless of input order", () => {
    const a = merkleRoot([
      { path: "b.ts", contents: "b" },
      { path: "a.ts", contents: "a" },
    ]);
    const b = merkleRoot([
      { path: "a.ts", contents: "a" },
      { path: "b.ts", contents: "b" },
    ]);
    expect(a).toBe(b);
  });

  it("diffs trees by path", () => {
    const before = buildTree([{ path: "a.ts", contents: "1" }]).tree.entries;
    const after = buildTree([
      { path: "a.ts", contents: "2" },
      { path: "b.ts", contents: "x" },
    ]).tree.entries;
    const changes = diffTrees(before, after);
    expect(changes.map((c) => c.path)).toEqual(["a.ts", "b.ts"]);
    expect(changes[0]?.beforeSha).toBeTruthy();
    expect(changes[0]?.afterSha).toBeTruthy();
    expect(changes[1]?.beforeSha).toBeNull();
  });
});
