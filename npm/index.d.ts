export interface Candidate {
  text: string;
  /** 0–1. Relative to the other candidates; short inputs are less reliable. */
  confidence: number;
  /** How the text was broken, outermost first. e.g. [{ misreadAs: 'windows-1252', actual: 'utf-8' }] */
  chain: { misreadAs: string; actual: string }[];
}
export interface Analysis {
  text: string;
  changed: boolean;
  /** whole: one fix for the whole input · lines: each line fixed on its own · segments: only the broken parts replaced */
  mode: 'whole' | 'lines' | 'segments' | 'none';
  candidates: Candidate[];
}
type Bytes = Uint8Array | ArrayBuffer;
/** Returns the repaired string, or the input unchanged if it does not look broken. */
export function fix(text: string): string;
export function analyze(text: string): Analysis;
/** Detects the encoding of raw file bytes and returns UTF-8 text. More accurate than fix() because no bytes were lost yet. */
export function decode(bytes: Bytes): { text: string | null; encoding: string | null; certain: boolean; binary: boolean };
/** Rewrites non-UTF-8 filenames inside a ZIP as UTF-8 (sets GP bit 11). Compressed data is copied untouched. */
export function fixZipNames(bytes: Bytes): { zip: Uint8Array; names: string[]; encoding: string; changed: boolean };
export const engine: Record<string, unknown>;
