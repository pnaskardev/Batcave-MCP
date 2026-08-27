import { homedir } from "node:os";
import { extname, isAbsolute, resolve } from "node:path";
import type { StoredDocument } from "./stored-document";

const TEXT_EXTENSIONS = new Set([".txt", ".md", ".markdown", ".text", ".rtf", ""]);

function expandPath(path: string): string {
  const expanded = path.startsWith("~/") ? path.replace("~", homedir()) : path;
  return isAbsolute(expanded) ? expanded : resolve(expanded);
}

async function extractPdf(path: string): Promise<string> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const bytes = new Uint8Array(await Bun.file(path).arrayBuffer());
  const pdf = await getDocumentProxy(bytes);
  const { text } = await extractText(pdf, { mergePages: true });
  return text;
}

async function extractDocx(path: string): Promise<string> {
  const mammoth = (await import("mammoth")).default;
  const buffer = Buffer.from(await Bun.file(path).arrayBuffer());
  const { value } = await mammoth.extractRawText({ buffer });
  return value;
}

async function extractFile(path: string): Promise<{ text: string; format: string }> {
  const file = Bun.file(path);
  if (!(await file.exists())) {
    throw new Error(`File not found: ${path}`);
  }
  const ext = extname(path).toLowerCase();
  if (ext === ".pdf") return { text: await extractPdf(path), format: "pdf" };
  if (ext === ".docx") return { text: await extractDocx(path), format: "docx" };
  if (TEXT_EXTENSIONS.has(ext)) return { text: await file.text(), format: ext.slice(1) || "text" };
  throw new Error(
    `Unsupported file type "${ext}" for ${path}. Supported: .pdf, .docx, .txt, .md. ` +
      `For .doc or .pages, export to PDF first, or pass the text directly.`,
  );
}

function normalize(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Trims a caller-supplied field down to a real value, treating whitespace as absent. */
function present(value: string | undefined): string | undefined {
  return value?.trim() ? value : undefined;
}

function describe(label: string, text: string, source: string, format: string): StoredDocument {
  if (text.length < 120) {
    throw new Error(
      `Extracted only ${text.length} characters for ${label} from ${source}. ` +
        `That is too short to analyse — the file may be image-only (scanned) or empty.`,
    );
  }
  return { text, source, format, chars: text.length, words: text.split(/\s+/).length };
}

/**
 * Turns a text-or-path argument into a stored document. Exactly one of the two must be given —
 * silently preferring one would hide a caller mistake behind an analysis of the wrong document.
 */
export async function loadDocument(
  label: string,
  input: { text?: string; path?: string },
): Promise<StoredDocument> {
  const text = present(input.text);
  const path = present(input.path);
  const bothOrNeither = `Provide exactly one of ${label}_text or ${label}_path`;

  if (path !== undefined) {
    if (text !== undefined) throw new Error(`${bothOrNeither} (got both).`);
    const resolved = expandPath(path);
    const extracted = await extractFile(resolved);
    return describe(label, normalize(extracted.text), resolved, extracted.format);
  }

  if (text === undefined) throw new Error(`${bothOrNeither} (got neither).`);
  return describe(label, normalize(text), "inline text", "text");
}

const LATEX_EXTENSIONS = new Set([".tex", ".latex"]);

/** Cheap proof the caller sent source and not the rendered output of it. */
function assertLatex(text: string, source: string): void {
  if (!/\\(?:documentclass|begin\s*\{document\})/.test(text)) {
    throw new Error(
      `${source} does not look like LaTeX source: no \\documentclass and no \\begin{document}. ` +
        `Pass the .tex file the candidate compiles, not the text extracted from the PDF it ` +
        `produces — editing extracted text would throw the template away.`,
    );
  }
}

/**
 * Reads a LaTeX resume. Deliberately not `loadDocument`: that one collapses runs of blank lines,
 * and here the file goes back to the candidate for a line-by-line review, where reflowed
 * whitespace is a diff they have to read and dismiss. The bytes stay as they arrived.
 */
export async function loadLatex(input: { text?: string; path?: string }): Promise<StoredDocument> {
  const text = present(input.text);
  const path = present(input.path);
  const bothOrNeither = "Provide exactly one of latex_text or latex_path";

  if (path !== undefined) {
    if (text !== undefined) throw new Error(`${bothOrNeither} (got both).`);
    const resolved = expandPath(path);
    const ext = extname(resolved).toLowerCase();
    if (!LATEX_EXTENSIONS.has(ext)) {
      throw new Error(
        `${resolved} is not a LaTeX source file (expected .tex or .latex, got "${ext}"). ` +
          `This stage edits the source the candidate compiles; a .pdf or .docx has no source ` +
          `to edit.`,
      );
    }
    const file = Bun.file(resolved);
    if (!(await file.exists())) throw new Error(`File not found: ${resolved}`);
    const contents = await file.text();
    assertLatex(contents, resolved);
    return describe("latex_resume", contents, resolved, "latex");
  }

  if (text === undefined) throw new Error(`${bothOrNeither} (got neither).`);
  assertLatex(text, "The text passed as latex_text");
  return describe("latex_resume", text, "inline text", "latex");
}
