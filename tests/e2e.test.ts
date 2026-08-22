import { afterAll, beforeAll, expect, test } from "bun:test";
import { SQL } from "bun";
import type { Subprocess } from "bun";
import { join } from "node:path";

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

let proc: Subprocess<"pipe", "pipe", "inherit">;
let nextId = 1;
const pending = new Map<number, (value: Record<string, any>) => void>();

function send(method: string, params?: unknown): Promise<Record<string, any>> {
  const id = nextId++;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    proc.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    proc.stdin.flush();
  });
}

async function callTool(name: string, args: Record<string, unknown>) {
  const response = await send("tools/call", { name, arguments: args });
  const result = response.result ?? {};
  return {
    isError: Boolean(response.error) || Boolean(result.isError),
    text: String(result.content?.[0]?.text ?? JSON.stringify(response.error)),
    structured: result.structuredContent as Record<string, any> | undefined,
  };
}

async function pumpStdout() {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of proc.stdout as ReadableStream<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true });
    let newline: number;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      const message = JSON.parse(line);
      pending.get(message.id)?.(message);
    }
  }
}

beforeAll(async () => {
  if (!DATABASE_URL) return;
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
      "drop table if exists schema_migrations;",
  );
  await sql.close();
});

dbTest("the server advertises the intake, the three stages, and the support tools", async () => {
  const { result } = await send("tools/list");
  expect(result.tools.map((tool: { name: string }) => tool.name)).toEqual([
    "start_review",
    "resume_match_report",
    "rewrite_experience_xyz",
    "ats_scroll_stopper_pass",
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
  const session_id = started.structured!.session_id as string;
  expect(session_id).toMatch(/^[a-z0-9]{10}$/);

  const blocked = await callTool("rewrite_experience_xyz", { session_id });
  expect(blocked.isError).toBe(true);
  expect(blocked.text).toContain("Call resume_match_report first");

  const brief = await callTool("resume_match_report", { session_id });
  expect(brief.structured!.mode).toBe("brief");
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
  expect(stageOne.structured!.mode).toBe("recorded");
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

  const status = await callTool("session_status", { session_id });
  expect(status.structured!.stages).toEqual({
    match_report: "complete",
    experience_rewrite: "complete",
    ats_pass: "complete",
  });

  const dossier = await callTool("export_dossier", { session_id });
  const markdown = dossier.structured!.markdown as string;
  expect(markdown).toContain("**Score: 41/100.**");
  expect(markdown).toContain("Platform: Kubernetes, Go");
  expect(markdown).toContain("p99 latency reduction in ms");

  const listed = await callTool("list_sessions", { limit: 20 });
  expect(listed.structured!.sessions).toContainEqual(
    expect.objectContaining({ session_id, stages_complete: 3 }),
  );

  const deleted = await callTool("delete_session", { session_id });
  expect(deleted.structured!.deleted).toBe(true);
  const gone = await callTool("session_status", { session_id });
  expect(gone.isError).toBe(true);
});

dbTest("an unknown session explains how to recover", async () => {
  const missing = await callTool("session_status", { session_id: "deadbeef99" });
  expect(missing.isError).toBe(true);
  expect(missing.text).toContain("Run list_sessions");
});
