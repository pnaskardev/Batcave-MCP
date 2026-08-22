import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadDocument } from "../src/platform/documents";

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "batcave-docs-"));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

const BODY = "EXPERIENCE\nAcme Corp, Backend Engineer, 2021-2024\n".padEnd(200, "-");

test("requires exactly one of text or path", async () => {
  await expect(loadDocument("resume", {})).rejects.toThrow("got neither");
  await expect(loadDocument("resume", { text: BODY, path: "/x" })).rejects.toThrow("got both");
});

test("rejects a document too short to analyse", async () => {
  await expect(loadDocument("resume", { text: "one line" })).rejects.toThrow("too short");
});

test("names the supported formats for an unreadable type", async () => {
  const path = join(dir, "resume.odt");
  await Bun.write(path, BODY);
  await expect(loadDocument("resume", { path })).rejects.toThrow(".pdf, .docx, .txt, .md");
});

test("reports where the text came from and how big it is", async () => {
  const path = join(dir, "resume.md");
  await Bun.write(path, BODY);
  const document = await loadDocument("resume", { path });
  expect(document.format).toBe("md");
  expect(document.source).toBe(path);
  expect(document.chars).toBe(BODY.trim().length);
});
