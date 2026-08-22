import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadDocument } from "../src/documents";
import { atsPassInstructions, experienceRewriteInstructions } from "../src/stages";
import { requireStageResult, type DocumentRecord, type Session } from "../src/store";

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "batcave-test-"));
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

function session(stages: Session["stages"] = {}): Session {
  return {
    id: "abc1234567",
    created_at: "2026-08-22T00:00:00.000Z",
    updated_at: "2026-08-22T00:00:00.000Z",
    company: "Wayne Enterprises",
    role: "Staff Platform Engineer",
    resume: doc(RESUME),
    job_description: doc(JD),
    stages,
  };
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

test("a later stage refuses to run before its prerequisite is recorded", () => {
  expect(() => requireStageResult(session(), "match_report")).toThrow("has not run for session");
});

test("an issued-but-unanswered stage says how to finish it", () => {
  const issued = session({ match_report: { status: "awaiting_result", issued_at: "now" } });
  expect(() => requireStageResult(issued, "match_report")).toThrow("no result was recorded yet");
});

test("stage 2 briefs the model with the recorded stage 1 report", () => {
  const done = session({
    match_report: {
      status: "complete",
      issued_at: "now",
      result: { match_score: 41, missing_keywords: ["Kubernetes"] },
    },
  });
  const brief = experienceRewriteInstructions(done, requireStageResult(done, "match_report"));
  expect(brief).toContain("Kubernetes");
  expect(brief).toContain("[QUANTIFY:");
  expect(brief).toContain(done.id);
});

test("stage 3 scans the stage 2 resume, not the original", () => {
  const done = session({
    match_report: { status: "complete", issued_at: "now", result: { match_score: 41 } },
    experience_rewrite: {
      status: "complete",
      issued_at: "now",
      result: { updated_resume: "REWRITTEN RESUME BODY" },
    },
  });
  const rewrite = requireStageResult(done, "experience_rewrite");
  const brief = atsPassInstructions(
    done,
    rewrite.updated_resume as string,
    requireStageResult(done, "match_report"),
  );
  expect(brief).toContain("REWRITTEN RESUME BODY");
  expect(brief).not.toContain("Acme Corp, Backend Engineer");
});
