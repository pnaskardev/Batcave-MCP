import { expect, test } from "bun:test";
import {
  atsPassBrief,
  experienceRewriteBrief,
  latexEditBrief,
} from "../src/features/resume-review/briefs";
import {
  type ReviewSession,
  requireLatexSource,
  requireStageResult,
} from "../src/features/resume-review/sessions";
import type { StoredDocument } from "../src/platform/stored-document";

const doc = (text: string): StoredDocument => ({
  text,
  source: "inline text",
  format: "text",
  chars: text.length,
  words: text.split(/\s+/).length,
});

const RESUME = "EXPERIENCE\nAcme Corp, Backend Engineer, 2021-2024\n".padEnd(200, "-");
const JD = "Staff Platform Engineer. Kubernetes, Go, Terraform.\n".padEnd(200, "-");

function session(stages: ReviewSession["stages"] = {}): ReviewSession {
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
  const brief = experienceRewriteBrief(done, requireStageResult(done, "match_report"));
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
  const brief = atsPassBrief(
    done,
    rewrite.updated_resume as string,
    requireStageResult(done, "match_report"),
  );
  expect(brief).toContain("REWRITTEN RESUME BODY");
  expect(brief).not.toContain("Acme Corp, Backend Engineer");
});

const TEX =
  "\\documentclass{article}\n\\begin{document}\n\\resumeItem{Old bullet}\n\\end{document}";

test("the LaTeX stage says how to opt in, and that skipping it finishes the review", () => {
  expect(() => requireLatexSource(session())).toThrow("latex_text or latex_path");
  expect(() => requireLatexSource(session())).toThrow("the review is complete without it");
});

test("a stored LaTeX source satisfies the opt-in", () => {
  const opted = { ...session(), latex_source: doc(TEX) };
  expect(requireLatexSource(opted).text).toBe(TEX);
});

test("stage 4 briefs the model with the source file and the stage 3 result", () => {
  const done = session({
    ats_pass: {
      status: "complete",
      issued_at: "now",
      result: { final_resume: "FINAL RESUME BODY" },
    },
  });
  const brief = latexEditBrief(done, doc(TEX), requireStageResult(done, "ats_pass"));
  expect(brief).toContain("\\resumeItem{Old bullet}");
  expect(brief).toContain("FINAL RESUME BODY");
  expect(brief).toContain("[QUANTIFY: ...]");
  expect(brief).toContain("Do not compile anything and do not produce a PDF");
  expect(brief).toContain("edit_latex_resume");
});
