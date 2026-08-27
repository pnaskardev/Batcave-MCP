import { afterAll, beforeAll, expect, test } from "bun:test";
import { join } from "node:path";
import type { Subprocess } from "bun";
import { SQL } from "bun";
import { migrateToLatest } from "../src/platform/db";

// These exercise the real wire protocol against a real Postgres. TEST_DB_URL must point at a
// THROWAWAY database — the suite drops its tables on the way out. It is deliberately not
// DB_URL, so pointing the server at production cannot arm the teardown.
const DATABASE_URL = process.env.TEST_DB_URL;
const dbTest = DATABASE_URL ? test : test.skip;
if (!DATABASE_URL) {
  console.warn("TEST_DB_URL is not set — skipping the end-to-end server tests.");
}

const RESUME =
  "Priya Sharma\nSenior Backend Engineer\n\nEXPERIENCE\nAcme Corp, Backend Engineer, 2021-2024\n" +
  "- Responsible for maintaining the payments service and fixing bugs.\n\nSKILLS\nPython, SQL";
const JD =
  "Staff Platform Engineer at Wayne Enterprises. Own our Kubernetes platform, drive Go " +
  "services, run Terraform on AWS, and improve observability with Prometheus. SLO ownership.";
const TEX =
  "\\documentclass{article}\n\\begin{document}\n\\resumeItem{Old bullet}\n\\end{document}";

/** Just enough of a JSON-RPC response for these tests to assert on. */
interface RpcResponse {
  id?: number;
  result?: Record<string, unknown>;
  error?: unknown;
}

let proc: Subprocess<"pipe", "pipe", "inherit">;
let nextId = 1;
const pending = new Map<number, (value: RpcResponse) => void>();

function send(method: string, params?: unknown): Promise<RpcResponse> {
  const id = nextId++;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    proc.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    proc.stdin.flush();
  });
}

interface ToolCall {
  isError: boolean;
  text: string;
  structured: Record<string, unknown> | undefined;
}

async function callTool(name: string, args: Record<string, unknown>): Promise<ToolCall> {
  const response = await send("tools/call", { name, arguments: args });
  const result = response.result ?? {};
  const content = result.content as { text?: string }[] | undefined;
  return {
    isError: Boolean(response.error) || Boolean(result.isError),
    text: String(content?.[0]?.text ?? JSON.stringify(response.error)),
    structured: result.structuredContent as Record<string, unknown> | undefined,
  };
}

/** The structured payload, or a failure naming the tool that did not return one. */
function structured(call: ToolCall, tool: string): Record<string, unknown> {
  if (!call.structured) {
    throw new Error(`${tool} returned no structuredContent: ${call.text}`);
  }
  return call.structured;
}

async function pumpStdout() {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of proc.stdout as ReadableStream<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split("\n");
    // The trailing element is whatever arrived after the last newline: an incomplete message,
    // or "" when the chunk ended cleanly. Either way it waits for the next chunk.
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const message = JSON.parse(line) as RpcResponse;
      if (message.id !== undefined) pending.get(message.id)?.(message);
    }
  }
}

beforeAll(async () => {
  if (!DATABASE_URL) return;
  // No lazy migration any more — the suite owns its schema the way a deploy does.
  await migrateToLatest();
  proc = Bun.spawn(["bun", join(import.meta.dir, "..", "index.ts")], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "inherit",
    env: { ...process.env, DB_URL: DATABASE_URL },
  });
  void pumpStdout();
  await send("initialize", {
    protocolVersion: "2025-11-25",
    capabilities: {},
    clientInfo: { name: "batcave-tests", version: "1.0.0" },
  });
  proc.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
  proc.stdin.flush();
});

afterAll(async () => {
  if (!DATABASE_URL) return;
  proc.kill();
  const sql = new SQL(DATABASE_URL);
  await sql.unsafe(
    "drop table if exists resume_stages; drop table if exists resume_sessions; " +
      "drop schema if exists drizzle cascade;",
  );
  await sql.close();
});

dbTest("the server advertises the intake, the stages, and the support tools", async () => {
  const { result } = await send("tools/list");
  const tools = result?.tools as { name: string }[];
  expect(tools.map((tool) => tool.name)).toEqual([
    "start_review",
    "resume_match_report",
    "rewrite_experience_xyz",
    "ats_scroll_stopper_pass",
    "edit_latex_resume",
    "export_dossier",
    "session_status",
    "list_sessions",
    "delete_session",
  ]);
});

dbTest("the three stages chain through one session", async () => {
  const started = await callTool("start_review", {
    resume_text: RESUME,
    job_description_text: JD,
    company: "Wayne Enterprises",
    role: "Staff Platform Engineer",
  });
  const session_id = structured(started, "start_review").session_id as string;
  expect(session_id).toMatch(/^[a-z0-9]{10}$/);

  const blocked = await callTool("rewrite_experience_xyz", { session_id });
  expect(blocked.isError).toBe(true);
  expect(blocked.text).toContain("Call resume_match_report first");

  const brief = await callTool("resume_match_report", { session_id });
  expect(structured(brief, "resume_match_report").mode).toBe("brief");
  expect(brief.text).toContain("senior in-house recruiter at Wayne Enterprises");

  const thin = await callTool("resume_match_report", {
    session_id,
    result: { match_score: 41, score_rationale: "x", missing_keywords: [], red_flags: [] },
  });
  expect(thin.isError).toBe(true);
  expect(thin.text).toContain("missing_keywords");

  const keyword = (k: string) => ({
    keyword: k,
    jd_evidence: `JD requires ${k}`,
    why_it_matters: "core to the req",
    where_to_add: "experience",
  });
  const flag = (f: string) => ({
    flag: f,
    severity: "moderate" as const,
    what_the_manager_sees: "visible in the skim",
    fix_direction: "restructure",
  });
  const stageOne = await callTool("resume_match_report", {
    session_id,
    result: {
      match_score: 41,
      score_rationale: "Backend depth, no platform ownership.",
      missing_keywords: ["Kubernetes", "Go", "Terraform", "Prometheus", "SLO"].map(keyword),
      red_flags: [flag("No metrics"), flag("Task-shaped bullets"), flag("Seniority gap")],
    },
  });
  expect(structured(stageOne, "resume_match_report").mode).toBe("recorded");
  expect(stageOne.text).toContain("Match score 41/100");

  const stageTwoBrief = await callTool("rewrite_experience_xyz", { session_id });
  expect(stageTwoBrief.text).toContain("Kubernetes");

  const updated = RESUME.replace(
    "- Responsible for maintaining the payments service and fixing bugs.",
    "- Cut payments p99 latency by [QUANTIFY: ms] by sharding ledger writes.",
  );
  const stageTwo = await callTool("rewrite_experience_xyz", {
    session_id,
    result: {
      rewritten_experience: "EXPERIENCE\n- Cut payments p99 latency ...",
      updated_resume: updated,
      bullets: [
        {
          original: "Responsible for maintaining the payments service",
          rewritten: "Cut payments p99 latency by [QUANTIFY: ms] by sharding ledger writes",
          x_accomplishment: "latency reduction",
          y_measure: "[QUANTIFY: ms]",
          z_method: "sharding ledger writes",
          keywords_used: ["SLO"],
        },
      ],
      red_flags_addressed: [{ flag: "No metrics", how_resolved: "every bullet is XYZ" }],
      keywords_not_addressed: [{ keyword: "Terraform", reason: "no evidence in the source" }],
      placeholders_needing_user_input: ["p99 latency reduction in ms"],
    },
  });
  expect(stageTwo.text).toContain("1 [QUANTIFY: ...] placeholder(s)");

  const stageThreeBrief = await callTool("ats_scroll_stopper_pass", { session_id });
  expect(stageThreeBrief.text).toContain("sharding ledger writes");
  expect(stageThreeBrief.text).not.toContain("Responsible for maintaining");

  const stageThree = await callTool("ats_scroll_stopper_pass", {
    session_id,
    result: {
      ats_findings: [
        { issue: "SKILLS is a comma blob", severity: "degraded", section: "SKILLS", fix: "split" },
      ],
      skipped_sections: [
        { section: "SKILLS", why_skipped: "generic", seven_second_verdict: "nothing lands" },
      ],
      rewritten_sections: [
        {
          section: "SKILLS",
          before: "Python, SQL",
          after: "Platform: Kubernetes, Go",
          why_it_stops_the_scroll: "mirrors the req",
        },
      ],
      final_resume: `${updated}\n\nSKILLS\nPlatform: Kubernetes, Go`,
      final_verdict: {
        ats_pass_likelihood: "medium",
        would_shortlist: false,
        remaining_gaps: ["No Terraform"],
      },
    },
  });
  expect(stageThree.text).toContain("Pipeline complete");
  expect(stageThree.text).toContain("is your resume in LaTeX");

  // The optional stage stays out of the way of a candidate who never asks for it.
  const status = await callTool("session_status", { session_id });
  expect(structured(status, "session_status").stages).toEqual({
    match_report: "complete",
    experience_rewrite: "complete",
    ats_pass: "complete",
    latex_edit: "not_started",
  });

  const dossier = await callTool("export_dossier", { session_id });
  const markdown = structured(dossier, "export_dossier").markdown as string;
  expect(markdown).toContain("**Score: 41/100.**");
  expect(markdown).toContain("Platform: Kubernetes, Go");
  expect(markdown).toContain("p99 latency reduction in ms");
  expect(markdown).not.toContain("Stage 4");

  const listed = await callTool("list_sessions", { limit: 20 });
  expect(structured(listed, "list_sessions").sessions).toContainEqual(
    expect.objectContaining({ session_id, stages_complete: 3, latex_edited: false }),
  );

  const deleted = await callTool("delete_session", { session_id });
  expect(structured(deleted, "delete_session").deleted).toBe(true);
  const gone = await callTool("session_status", { session_id });
  expect(gone.isError).toBe(true);
});

dbTest("the LaTeX stage runs only once the candidate hands over a source file", async () => {
  const started = await callTool("start_review", {
    resume_text: RESUME,
    job_description_text: JD,
  });
  const session_id = structured(started, "start_review").session_id as string;

  const early = await callTool("edit_latex_resume", { session_id, latex_text: TEX });
  expect(early.isError).toBe(true);
  expect(early.text).toContain("Call ats_scroll_stopper_pass first");

  await callTool("ats_scroll_stopper_pass", {
    session_id,
    result: {
      ats_findings: [],
      skipped_sections: [],
      rewritten_sections: [],
      final_resume: `${RESUME}\n\nSKILLS\nPlatform: Kubernetes, Go`,
      final_verdict: { ats_pass_likelihood: "medium", would_shortlist: true, remaining_gaps: [] },
    },
  });

  // No source, no stage — and the error says so rather than sending the caller hunting.
  const notOpted = await callTool("edit_latex_resume", { session_id });
  expect(notOpted.isError).toBe(true);
  expect(notOpted.text).toContain("the review is complete without it");

  const rejected = await callTool("edit_latex_resume", { session_id, latex_text: RESUME });
  expect(rejected.isError).toBe(true);
  expect(rejected.text).toContain("does not look like LaTeX source");

  const brief = await callTool("edit_latex_resume", { session_id, latex_text: TEX });
  expect(structured(brief, "edit_latex_resume").mode).toBe("brief");
  expect(brief.text).toContain("\\resumeItem{Old bullet}");
  expect(brief.text).toContain("Platform: Kubernetes, Go");

  const edited = TEX.replace("Old bullet", "Cut p99 latency by [QUANTIFY: ms]");
  const recorded = await callTool("edit_latex_resume", {
    session_id,
    result: {
      edited_latex: edited,
      edits: [
        {
          section: "Experience",
          latex_before: "\\resumeItem{Old bullet}",
          latex_after: "\\resumeItem{Cut p99 latency by [QUANTIFY: ms]}",
          carries: "the stage-3 experience rewrite",
        },
      ],
      edits_not_applied: [
        { change: "Skills sidebar", reason: "the template has no second column" },
      ],
      preamble_changed: false,
      compile_risks: ["an unescaped % would comment out the line"],
    },
  });
  expect(structured(recorded, "edit_latex_resume").edited_latex).toBe(edited);
  expect(recorded.text).toContain("```latex");
  expect(recorded.text).toContain("Not applied: Skills sidebar");

  // The source is stored, so a second brief needs no file passed again.
  const rebrief = await callTool("edit_latex_resume", { session_id });
  expect(rebrief.isError).toBe(false);

  const listed = await callTool("list_sessions", { limit: 20 });
  expect(structured(listed, "list_sessions").sessions).toContainEqual(
    // The optional stage is reported on its own, never folded into the count of three.
    expect.objectContaining({ session_id, stages_complete: 1, latex_edited: true }),
  );

  await callTool("delete_session", { session_id });
});

dbTest("an unknown session explains how to recover", async () => {
  const missing = await callTool("session_status", { session_id: "deadbeef99" });
  expect(missing.isError).toBe(true);
  expect(missing.text).toContain("Run list_sessions");
});
