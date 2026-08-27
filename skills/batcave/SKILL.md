---
name: batcave
description: "Tailor a resume to one specific job posting and return an updated LaTeX source to submit. Runs a four-stage review — recruiter match report, XYZ experience rewrite, ATS + hiring-manager scan, then applies the result to the candidate's own .tex. Use when the user is applying for a job, says 'tailor my resume', 'apply to this posting', 'run batcave', or attaches a resume plus a job description. Never compiles LaTeX and never produces a PDF."
---

# Batcave — resume review

Four stages, run in order, in one pass. The output is an updated `.tex` file the user edits and
submits themselves.

You are doing the reasoning here. There is no external service and no API key — this skill is the
briefs, not a program.

## Inputs

Collect before starting. Ask only for what is missing:

| Input | Notes |
|---|---|
| Resume | Attached or pasted. `.tex` is ideal — it doubles as the stage-4 source. `.pdf` / `.docx` / `.md` / plain text all fine |
| Job description | Attached or pasted |
| Company and role | Read them off the posting; ask only if the posting doesn't say |

Read attached files directly — PDF and DOCX included. Do not shell out to a conversion tool.

**If the user has no `.tex` source, stop after stage 3** and give them the final resume as
markdown. Stage 4 has nothing to edit. Say so; do not offer to build them a LaTeX template unless
they ask.

A `.tex` file is often attached as plain text with a different extension, or pasted inline. Take
it however it arrives. What you must not accept is **text extracted from a compiled PDF** — if
there is no `\documentclass` and no `\begin{document}`, it is not source, and editing it would
throw the template away. Ask for the real `.tex` instead.

## Two rules that hold across every stage

1. **Never invent a number.** Where the source resume has no metric, write
   `[QUANTIFY: what to measure]` and collect it in a list you show the user at the end. An
   invented metric gets them caught in the interview, which is worse than a blank.
2. **Never stuff keywords.** A keyword goes in only where real experience supports it. Ones you
   cannot place honestly get reported with the reason, not forced in.

Do not summarise a stage and move on — each stage's actual output feeds the next one.

---

## Stage 1 — Recruiter match report

Act as a senior in-house recruiter at the target company, screening for this exact req. You have
already pushed dozens of candidates through this pipeline and you know which ones the hiring
manager rejects. You are not a career coach. You are the person who decides whether this resume
moves forward.

Produce:

1. **Match score** — out of 100, calibrated against *this req only*, not against resumes in
   general. A generically strong resume for the wrong req scores low.
   `90+` near-perfect, fast-track · `75-89` strong, would interview · `60-74` borderline, depends
   on the pile · `40-59` unlikely · `<40` reject.
   Add 2-3 sentences of rationale a recruiter would actually say in a pipeline review.
2. **Top 5 missing keywords** — the highest-leverage terms the JD demands that a keyword scan of
   this resume would not hit. A term counts as missing if the resume never uses the JD's own
   phrasing, even when the underlying experience is arguably there. For each: quote the JD line
   that demands it, why it matters, and which resume bullet or section should carry it.
3. **3 red flags** — what a hiring manager spots in under 10 seconds. Ten seconds means *shape,
   not substance*: employment gaps, job-hopping, title or level mismatch, zero metrics, walls of
   text, stack mismatch, seniority inflation, a summary that says nothing. If something only
   surfaces on a careful read, it is not a 10-second flag. Rank worst first, mark each
   critical/moderate/minor, and set severity honestly — do not inflate a minor flag to fill the
   slot.

Judge only what is on the page. Never invent employers, dates, or tools. Cite the resume or the JD
for every claim. Be blunt — a polite score the candidate cannot act on is a wasted screen.

Show the user the score, the keywords, and the flags before continuing.

## Stage 2 — Rewrite the experience section (XYZ)

Rewrite the EXPERIENCE section so it naturally carries stage 1's missing keywords and removes its
red flags. Every bullet uses the Google XYZ form:

> Accomplished **X** as measured by **Y** by doing **Z**.

- Every bullet needs all three parts. Lead with the accomplishment, not the task. A bullet that
  describes responsibilities instead of outcomes has failed.
- Unknown metric → `[QUANTIFY: what to measure]` in place of Y. Never guess.
- Place a keyword only where the candidate's actual experience supports it. List the ones you
  could not place, with the reason.
- Address each red flag **structurally** — reframe scope, merge or group short stints, cut the
  wall of text, surface the level. Do not paper over a gap by moving dates.
- Company names, titles, and dates stay exactly as written in the original.
- Keep bullets to one or two lines. Front-load the verb and the outcome.

Carry forward the **whole resume** with the rewritten experience swapped in and every other
section reproduced unchanged. Stage 3 reads that, not the original.

## Stage 3 — ATS filter + 200-resume hiring manager pass

Two passes over the stage-2 resume, in order.

**Pass A — ATS parser.** You are a literal parsing machine, not a reader. You do not infer. Flag
anything that breaks extraction or scoring: nonstandard section headers, multi-column layouts,
tables, text in graphics or headers/footers, inconsistent date formats, a contact block the parser
cannot key on, acronyms used without their expansion (or the reverse), skills that exist only in a
graphic, and required JD terms still absent after stage 2.

**Pass B — Hiring manager, resume #147 of 200, seven seconds.** You are tired and you are looking
for a reason to stop. Go section by section and say which ones you skip and why. Skipping is the
default: a section earns attention or it does not get it. Be specific — "generic summary" is a
finding, "could be stronger" is not.

Then rewrite every skipped section so it stops the scroll: concrete outcome or number in the first
line, no throat-clearing, no adjective stacks, scannable in one glance. Same honesty rule — no
invented metrics.

Produce the **complete final resume**, plus a verdict: ATS pass likelihood, would-shortlist
yes/no, and any remaining gaps.

## Stage 4 — Apply it to the LaTeX source

**Ask first.** Stage 3 is a complete review on its own. Ask the user: *is your resume in LaTeX, and
do you want the source edited?* If no, stop — give them the stage-3 resume and the
`[QUANTIFY: ...]` list, and you are done.

If yes, read their `.tex` source and apply the stage-3 resume to it.

**Deliver the result as one fenced ```latex block containing the complete file**, top to bottom,
`\documentclass` through `\end{document}` — not a diff, not the body alone, not an excerpt with
elisions. The user copies it out, makes their own edits, compiles, and submits. That block is the
deliverable and it is never optional.

If — and only if — you have a working filesystem, additionally save it as
`<original-stem>-<company>.tex` and offer the download. Never overwrite their original: they keep
one master source and apply to many jobs from it. If you have no filesystem, the fenced block
alone is a complete result. Do not apologise for it and do not describe the file you did not write.

Rules:

- **The template is not yours to redesign.** Document class, packages, custom macros, spacing, and
  section ordering stay exactly as the candidate wrote them. You are changing the content inside
  the existing structure and nothing else.
- Use the macros the file already defines. If it has `\resumeItem{...}`, a new bullet is
  `\resumeItem{...}` too — do not hand-roll `\item` next to them.
- **Escape LaTeX specials in every string you insert:** `&` `%` `$` `#` `_` become `\&` `\%` `\$`
  `\#` `\_`; `~` and `^` become `\textasciitilde{}` and `\textasciicircum{}`. An unescaped `%`
  comments out the rest of its line — the most common way this stage quietly breaks a resume.
- Leave every `[QUANTIFY: ...]` marker in the file exactly as written. The user fills those in.
- If the template cannot carry a stage-3 change — no slot for the section, a macro with a different
  arity, content that would clearly overflow the page — **report it and move on**. A reported miss
  is a correct outcome; a silent drop is not.
- **Never compile. Never produce a PDF.** Do not run `pdflatex`, `xelatex`, `latexmk`, or Tectonic.
  The `.tex` file is the deliverable — the user compiles and submits it themselves.

## Finish

Show the user:

1. **The complete `.tex`**, in one fenced block — plus the saved file, if you were able to write one.
2. **What changed** — a short list of section-level edits, and what carries which stage-3 change.
3. **`[QUANTIFY: ...]` markers still open** — the numbers they have to supply before submitting.
   List every one. This is the part they must act on.
4. **Anything the template could not carry**, with the reason.
5. **Compile risks** — an unescaped special that slipped through, a macro used outside where the
   template defines it, content long enough to push to a second page. Tell them to compile once
   before submitting. Say plainly that you did not.
