import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadDocument } from "../src/documents";
import { atsPassInstructions, experienceRewriteInstructions } from "../src/stages";
import {
  createSession,
  loadSession,
  markComplete,
  requireStageResult,
  saveSession,
  type DocumentRecord,
} from "../src/store";

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "batcave-test-"));
  process.env.BATCAVE_DATA_DIR = dir;
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

const doc = (text: string): DocumentRecord => ({
  text,
  source: "inline text",
  format: "text",
  chars: text.length,
  words: text.split(/\s+/).length,
});

const RESUME = "EXPERIENCE\nAcme Corp, Backend Engineer, 2021-2024\n".padEnd(200, "-");
const JD = "Staff Platform Engineer. Kubernetes, Go, Terraform.\n".padEnd(200, "-");

function freshSession() {
  return createSession({
    company: "Wayne Enterprises",
    role: "Staff Platform Engineer",
    resume: doc(RESUME),
    jobDescription: doc(JD),
  });
}

test("loadDocument requires exactly one of text or path", async () => {
  await expect(loadDocument("resume", {})).rejects.toThrow("got neither");
  await expect(loadDocument("resume", { text: RESUME, path: "/x" })).rejects.toThrow("got both");
});

test("loadDocument rejects documents too short to analyse", async () => {
  await expect(loadDocument("resume", { text: "one line" })).rejects.toThrow("too short");
});

test("loadDocument names the supported formats for an unreadable type", async () => {
  const path = join(dir, "resume.odt");
  await Bun.write(path, RESUME);
  await expect(loadDocument("resume", { path })).rejects.toThrow(".pdf, .docx, .txt, .md");
});

test("session ids that would escape the data directory are rejected", async () => {
  await expect(loadSession("../../etc/passwd")).rejects.toThrow("Invalid session_id");
});

test("a session round-trips through disk", async () => {
  const session = await saveSession(freshSession());
  const loaded = await loadSession(session.id);
  expect(loaded.resume.text).toBe(RESUME);
  expect(loaded.company).toBe("Wayne Enterprises");
});

test("session files are readable only by their owner", async () => {
  const session = await saveSession(freshSession());
  const info = await stat(join(dir, `${session.id}.json`));
  expect(info.mode & 0o777).toBe(0o600);
});

test("a later stage refuses to run before its prerequisite is recorded", () => {
  const session = freshSession();
  expect(() => requireStageResult(session, "match_report")).toThrow(
    "has not run for session",
  );
});

test("an issued-but-unanswered stage says how to finish it", () => {
  const session = freshSession();
  session.stages.match_report = { status: "awaiting_result", issued_at: "now" };
  expect(() => requireStageResult(session, "match_report")).toThrow("no result was recorded yet");
});

test("stage 2 briefs the model with the recorded stage 1 report", () => {
  const session = freshSession();
  markComplete(session, "match_report", { match_score: 41, missing_keywords: ["Kubernetes"] });
  const brief = experienceRewriteInstructions(
    session,
    requireStageResult(session, "match_report"),
  );
  expect(brief).toContain("Kubernetes");
  expect(brief).toContain("[QUANTIFY:");
  expect(brief).toContain(session.id);
});

test("stage 3 scans the stage 2 resume, not the original", () => {
  const session = freshSession();
  markComplete(session, "match_report", { match_score: 41 });
  markComplete(session, "experience_rewrite", { updated_resume: "REWRITTEN RESUME BODY" });
  const rewrite = requireStageResult(session, "experience_rewrite");
  const brief = atsPassInstructions(
    session,
    rewrite.updated_resume as string,
    requireStageResult(session, "match_report"),
  );
  expect(brief).toContain("REWRITTEN RESUME BODY");
  expect(brief).not.toContain("Acme Corp, Backend Engineer");
});
