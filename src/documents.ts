import { homedir } from "node:os";
import { extname, isAbsolute, resolve } from "node:path";
import type { DocumentRecord } from "./store";

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
  return text.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Turns a text-or-path argument into a stored document. Exactly one of the two must be given —
 * silently preferring one would hide a caller mistake behind an analysis of the wrong document.
 */
export async function loadDocument(
  label: string,
  input: { text?: string; path?: string },
): Promise<DocumentRecord> {
  const hasText = Boolean(input.text?.trim());
  const hasPath = Boolean(input.path?.trim());
  if (hasText === hasPath) {
    throw new Error(
      `Provide exactly one of ${label}_text or ${label}_path (got ` +
        `${hasText && hasPath ? "both" : "neither"}).`,
    );
  }

  let text: string;
  let source: string;
  let format: string;
  if (hasPath) {
    const path = expandPath(input.path!);
    const extracted = await extractFile(path);
    text = normalize(extracted.text);
    source = path;
    format = extracted.format;
  } else {
    text = normalize(input.text!);
    source = "inline text";
    format = "text";
  }

  if (text.length < 120) {
    throw new Error(
      `Extracted only ${text.length} characters for ${label} from ${source}. ` +
        `That is too short to analyse — the file may be image-only (scanned) or empty.`,
    );
  }

  return { text, source, format, chars: text.length, words: text.split(/\s+/).length };
}
