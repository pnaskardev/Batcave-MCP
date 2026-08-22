/** A document after extraction: the text, plus where it came from and how big it is. */
export interface StoredDocument {
  text: string;
  source: string;
  format: string;
  chars: number;
  words: number;
}
