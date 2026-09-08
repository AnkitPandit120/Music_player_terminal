/** One fitted band — directly usable as an `@audio/eq-parametric` `ParametricBand`. */
export interface FitBand {
  /** band type */
  type: 'peak' | 'lowshelf' | 'highshelf'
  /** center/corner frequency, Hz */
  fc: number
  /** bandwidth (peak) or shelf slope (shelf) */
  Q: number
  /** band gain, dB (positive boosts, negative cuts) */
  gain: number
}

/** A magnitude-response control point: gain in dB at a given frequency. */
export interface FitTargetPoint {
  /** frequency, Hz */
  f: number
  /** gain, dB */
  gain: number
}

/** The `@audio/measure-response` result shape — per-bin dB curve with explicit bin frequencies. */
export interface FitTargetCurve {
  /** bin center frequencies, Hz, ascending */
  freqs: Float32Array | Float64Array
  /** magnitude, dB, one per bin */
  db: Float32Array | Float64Array
}

/**
 * Target magnitude response, any of:
 * - `{f, gain}[]` — control points, linearly interpolated in log-frequency, clamped outside
 * - `(f: number) => number` — dB at any frequency
 * - `Float32Array` — dB per bin over `[0, fs/2]` (`opts.fs`), bin `k` ↔ `k·fs/(2·(len−1))` —
 *   the `@audio/spectral-target` / `@audio/measure-response` bin-grid convention
 * - `{freqs, db}` — explicit per-bin frequencies + dB (the `@audio/measure-response` result)
 */
export type FitTarget = FitTargetPoint[] | ((f: number) => number) | Float32Array | Float64Array | FitTargetCurve

export interface FitOptions {
  /** sample rate, Hz. Default 44100 */
  fs?: number
  /** maximum band count — fewer are returned if `tolerance` is met early. Default 8 */
  bands?: number
  /** lowest fitted frequency, Hz. Default 20 */
  fMin?: number
  /** highest fitted frequency, Hz. Default 20000 */
  fMax?: number
  /** allow one low-shelf + one high-shelf band at the range edges. Default true */
  shelves?: boolean
  /** max |gain| per band, dB. Default 12 */
  maxGain?: number
  /** min Q per band. Default 0.3 */
  minQ?: number
  /** max Q per band. Default 10 */
  maxQ?: number
  /** stop the greedy init early once weighted RMS error, dB, is ≤ this. Default 0.5 */
  tolerance?: number
  /**
   * error weight at frequency `f`. Default uniform (`1`) — the evaluation grid is itself
   * log-spaced, so uniform per-point weight already means "uniform per octave"; only pass
   * this to weight some region more/less than that.
   */
  weight?: (f: number) => number
  /** log-spaced evaluation grid size. Default 256 */
  grid?: number
  /** Levenberg–Marquardt iteration cap (stops earlier on convergence). Default 200 */
  iterations?: number
  /** compute headroom preamp (see `FitResult.preamp`). `false` → preamp always 0. Default true */
  preamp?: boolean
}

export interface FitResult {
  /** fitted bands, sorted by `fc` — pass straight into `@audio/eq-parametric`'s `params.bands` */
  bands: FitBand[]
  /**
   * headroom make-up gain, dB: `-max(0, peak of the fitted cascade)`, so `response(f)` never
   * exceeds 0 dB (the AutoEQ `ParametricEQ.txt` convention) — or `0` if `opts.preamp === false`
   */
  preamp: number
  /** weighted RMS error, dB, of the fitted cascade (no preamp) vs the target, over the eval grid */
  error: number
  /** max |error|, dB, over the eval grid */
  maxError: number
  /** fitted cascade response incl. preamp — same as `response(bands, preamp, fs)` */
  response: (f: number) => number
}

/**
 * Fit an N-band parametric EQ to a target magnitude curve: greedy residual-peak-picking
 * initialization, then joint Levenberg–Marquardt refinement of every band's (fc, gain, Q).
 */
export default function fit(target: FitTarget, opts?: FitOptions): FitResult

/** Cascade magnitude response (incl. preamp) of a band list — via `@audio/biquad`'s `cascadeMagnitude`. */
export function response(bands: FitBand[], preamp?: number, fs?: number): (f: number) => number

/**
 * `{bands, preamp}` → Equalizer APO / AutoEQ `ParametricEQ.txt` text (`PK`/`LSC`/`HSC`,
 * 1 decimal gain, 2 decimal Q, integer Hz — matches AutoEQ's own writer).
 */
export function toEqualizerApo(result: { bands: FitBand[], preamp?: number }): string

/**
 * Parse Equalizer APO / AutoEQ `ParametricEQ.txt` text → `{bands, preamp}`. Tolerant: `ON`/`OFF`
 * filter lines (`OFF` skipped), `PK`/`PEQ`/`LS`/`LSC`/`HS`/`HSC` type codes, `"Filter N:"` or
 * `"Filter:"` forms.
 */
export function fromEqualizerApo(text: string): { bands: FitBand[], preamp: number }
