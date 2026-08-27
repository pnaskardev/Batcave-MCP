import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadDocument, loadLatex } from "../src/platform/documents";

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

const TEX = `\\documentclass{article}
\\begin{document}
\\section{Experience}


Acme Corp, Backend Engineer, 2021--2024. Cut p99 latency 40\\%.
\\end{document}
`.padEnd(200, "%");

test("latex intake requires exactly one of text or path", async () => {
  await expect(loadLatex({})).rejects.toThrow("got neither");
  await expect(loadLatex({ text: TEX, path: "/x.tex" })).rejects.toThrow("got both");
});

test("latex intake refuses text extracted from the rendered PDF", async () => {
  await expect(loadLatex({ text: BODY })).rejects.toThrow("does not look like LaTeX source");
});

test("latex intake refuses a file that has no source to edit", async () => {
  const path = join(dir, "resume.pdf");
  await Bun.write(path, TEX);
  await expect(loadLatex({ path })).rejects.toThrow("expected .tex or .latex");
});

test("latex intake keeps the source byte-for-byte, blank lines included", async () => {
  const path = join(dir, "resume.tex");
  await Bun.write(path, TEX);
  const document = await loadLatex({ path });
  expect(document.text).toBe(TEX);
  expect(document.format).toBe("latex");
});
