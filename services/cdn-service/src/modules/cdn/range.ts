// HTTP Range helpers (RFC 9110 §14) — single byte-range only.
// Multi-range / malformed headers are ignored and the full file is served (allowed by the RFC).

export type RangeSpec =
  | { kind: 'bounded'; start: number; end: number } // bytes=100-199
  | { kind: 'open'; start: number } //                 bytes=100-
  | { kind: 'suffix'; length: number }; //             bytes=-500 (last 500 bytes)

export interface ResolvedRange {
  start: number;
  end: number; // inclusive
}

/** Parse a `Range` header. Returns `null` when it should be ignored (absent, other unit, multi-range, malformed). */
export function parseRangeSpec(header: string | undefined): RangeSpec | null {
  if (!header) return null;
  const value = header.trim();
  if (!value.toLowerCase().startsWith('bytes=')) return null;

  const set = value.slice(6).trim();
  if (set.includes(',')) return null;

  const match = /^(\d*)\s*-\s*(\d*)$/.exec(set);
  if (!match) return null;
  const [, rawStart, rawEnd] = match;
  if (rawStart === '' && rawEnd === '') return null;

  if (rawStart === '') {
    const length = Number(rawEnd);
    return Number.isSafeInteger(length) ? { kind: 'suffix', length } : null;
  }

  const start = Number(rawStart);
  if (!Number.isSafeInteger(start)) return null;
  if (rawEnd === '') return { kind: 'open', start };

  const end = Number(rawEnd);
  if (!Number.isSafeInteger(end) || end < start) return null;
  return { kind: 'bounded', start, end };
}

/** Clamp a parsed range to the real file size. Returns `null` when unsatisfiable (→ 416). */
export function resolveRange(spec: RangeSpec, size: number): ResolvedRange | null {
  if (size <= 0) return null;
  switch (spec.kind) {
    case 'bounded':
      return spec.start >= size ? null : { start: spec.start, end: Math.min(spec.end, size - 1) };
    case 'open':
      return spec.start >= size ? null : { start: spec.start, end: size - 1 };
    case 'suffix':
      return spec.length === 0 ? null : { start: Math.max(0, size - spec.length), end: size - 1 };
  }
}

