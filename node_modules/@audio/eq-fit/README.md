# @audio/eq-fit [![npm](https://img.shields.io/npm/v/@audio/eq-fit)](https://www.npmjs.com/package/@audio/eq-fit) [![MIT](https://img.shields.io/badge/MIT-%E0%A5%90-white)](https://github.com/krishnized/license)

Fit an N-band parametric EQ to a target magnitude curve

```
npm install @audio/eq-fit
```

```js
import fit from '@audio/eq-fit'
```

The missing math between curve producers (`@audio/spectral-target`, `@audio/measure-response`, or a plain list of `{f, gain}` points) and band consumers (`@audio/eq-parametric`). Two stages: greedy residual-peak-picking places an initial band at each remaining error's largest excursion (in the spirit of AutoEQ's — [jaakkopasanen/AutoEq](https://github.com/jaakkopasanen/AutoEq) — initial-guess heuristic, reimplemented here rather than ported); then Levenberg–Marquardt (Marquardt 1963) jointly refines every band's frequency, gain, and Q against the whole curve at once. Coefficients and `|H(f)|` come from `@audio/biquad`'s RBJ Audio-EQ-Cookbook implementation — this module only searches for good `{fc, Q, gain}`, it never derives filter math of its own.

```js
// from control points
let r = fit([{ f: 100, gain: 4 }, { f: 3000, gain: -3 }, { f: 8000, gain: 2 }], { bands: 6 })
r.bands     // [{ type: 'peak', fc, Q, gain }, ...] — ready for @audio/eq-parametric's params.bands
r.preamp    // dB, ≤ 0 — headroom so the fitted chain never clips
r.error     // weighted RMS dB error of the fit
r.response  // f => dB, the fitted cascade's response incl. preamp

// from a function
fit(f => (f > 5000 ? -6 : 0), { bands: 4, shelves: true })

// from a @audio/measure-response result
import measureResponse from '@audio/measure-response'
fit(measureResponse(impulseResponse, { fs }), { fs })

// apply it
import parametricEq from '@audio/eq-parametric'
parametricEq(data, { bands: r.bands, fs: 44100 })

// interchange with AutoEQ / Equalizer APO
import { toEqualizerApo, fromEqualizerApo } from '@audio/eq-fit'
toEqualizerApo(r)             // "Preamp: -2.1 dB\nFilter 1: ON PK Fc 100 Hz Gain 4.0 dB Q 1.41\n…"
fromEqualizerApo(apoText)     // { bands, preamp } — reads AutoEQ's own ParametricEQ.txt files too
```

| Param | Default | |
|---|---|---|
| `fs` | `44100` | Sample rate, Hz |
| `bands` | `8` | Max band count — fewer are returned once `tolerance` is met |
| `fMin` / `fMax` | `20` / `20000` | Fitted frequency range, Hz |
| `shelves` | `true` | Allow one low-shelf + one high-shelf at the range's edges |
| `maxGain` | `12` | Max \|gain\| per band, dB |
| `minQ` / `maxQ` | `0.3` / `10` | Per-band Q bounds |
| `tolerance` | `0.5` | Stop the greedy init once weighted RMS error is ≤ this, dB |
| `weight` | uniform | `f => number` — the eval grid is itself log-spaced, so uniform weight is already "uniform per octave"; only pass this to favor/discount a region |
| `grid` | `256` | Log-spaced evaluation points |
| `iterations` | `200` | Levenberg–Marquardt iteration cap (stops earlier on convergence) |
| `preamp` | `true` | `false` → skip the headroom calc, `result.preamp` is always `0` |

`target` accepts any of: `{f, gain}[]` control points (log-frequency interpolation), an `f => dB` function, a `Float32Array` of dB-per-bin over `[0, fs/2]` (the `@audio/spectral-target` bin-grid convention), or `{freqs, db}` (the `@audio/measure-response` shape). Deterministic — no randomness anywhere in either stage, so the same input always returns the same bands.

`preamp` follows AutoEQ's own `ParametricEQ.txt` convention: `-max(0, peak of the fitted cascade)`, so `response(f)` (which includes it) never exceeds 0 dB — the fitted EQ is safe to apply to a full-scale signal without digital clipping.

**Use when:** turning a measured or target curve — a headphone correction target, a room-EQ deviation curve, a captured reference spectrum — into a small parametric band list a real-time EQ (or a hardware unit that only understands PK/LSC/HSC text) can use, instead of the full-resolution FIR alternative (`@audio/eq-fir`).

## Algorithm

1. **Init** — for each side (`shelves` on): if the target's own value at `fMin`/`fMax` exceeds ±0.1 dB, place a shelf there (`Q` 0.707, corner where the (⅓-octave smoothed) curve crosses half that edge value). Remaining slots: repeatedly smooth the current residual (⅓-octave), place a peaking band at its largest excursion (`gain` = residual there, `Q` from the −3 dB-of-gain half-power width of the local lobe), subtract, repeat until `bands` is used or weighted RMS ≤ `tolerance`.
2. **Refine** — joint nonlinear least squares over every band's `(ln fc, gain, ln Q)` at once: Levenberg–Marquardt ([Marquardt 1963](https://doi.org/10.1137/0111030), the `diag(JᵀJ)`-scaled damping, not Levenberg's plain identity; initial damping `τ·max(diag(JᵀJ))` per Marquardt's own §4) with a numeric Jacobian (central differences) and box constraints enforced by clamp-and-reproject. Stops on relative cost improvement < 1e-6 or `iterations` ([Nocedal & Wright, *Numerical Optimization* 2nd ed., §10.3](https://doi.org/10.1007/978-0-387-40065-5)).
3. Bands with \|gain\| < 0.1 dB are dropped, the rest sorted by `fc`.

Measured on this package's own test suite: exact recovery (fc within 2%, gain within 0.2 dB, Q within 10%, RMS < 0.05 dB) of a synthetic 3-band target; RMS < 0.3 dB fitting a 10-band target with deliberately overlapping bands using `bands: 10`; RMS ≤ 0.5 dB / max ≤ 1.5 dB on a synthetic Harman-tilt headphone curve; the fitted bands run through `@audio/eq-parametric` and measured back via FFT of the impulse response match `response(f)` within 0.1 dB; fitting 10 bands on the default 256-point grid takes ~90 ms.

## References

- Bristow-Johnson, R. (2005). ["Audio EQ Cookbook."](https://www.w3.org/TR/audio-eq-cookbook/) — biquad coefficients, via `@audio/biquad`.
- Marquardt, D.W. (1963). ["An Algorithm for Least-Squares Estimation of Nonlinear Parameters."](https://doi.org/10.1137/0111030) *J. Soc. Indust. Appl. Math.* 11(2):431–441.
- Nocedal, J. & Wright, S. (2006). *Numerical Optimization* (2nd ed.), §10.3 — Levenberg–Marquardt as damped Gauss–Newton.
- [jaakkopasanen/AutoEq](https://github.com/jaakkopasanen/AutoEq) — the `ParametricEQ.txt` text format and the headphone-correction use case this module targets; `test.js` parses a real result file from AutoEQ's own archive.
- [Equalizer APO](https://sourceforge.net/projects/equalizerapo/) — the `ParametricEQ.txt` config syntax `toEqualizerApo`/`fromEqualizerApo` read and write.

---

Part of [@audio/eq](https://github.com/audiojs/eq) — the eq family umbrella.

MIT © [audiojs](https://github.com/audiojs)
