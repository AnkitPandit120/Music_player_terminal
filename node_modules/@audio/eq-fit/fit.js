// Fit an N-band parametric EQ (RBJ peaking + optional low/high shelves) to a target
// magnitude curve. The missing math between curve producers (@audio/spectral-target,
// @audio/measure-response, @audio/eq-fir's own {f,gain}/function targets) and band
// consumers (@audio/eq-parametric).
//
// Coefficients and |H(f)| come from @audio/biquad (RBJ Audio-EQ-Cookbook, Bristow-Johnson
// 2005) — this module never re-derives them.
//
// Algorithm, two stages:
//  1. Greedy residual-peak-picking init, in the spirit of AutoEQ's (jaakkopasanen/AutoEq)
//     `optimize_parametric_eq` initial guess: smooth the current error, place a band at its
//     largest excursion, subtract the band's contribution, repeat. Adapted (not a literal
//     port — reimplemented from the general approach described in the project's README/wiki)
//     to this package's log-frequency evaluation grid.
//  2. Joint nonlinear least squares refinement over every band's (fc, gain, Q) at once —
//     Levenberg–Marquardt (Marquardt, D.W. 1963, "An Algorithm for Least-Squares Estimation
//     of Nonlinear Parameters," J. Soc. Indust. Appl. Math. 11(2):431–441 — the diag(JᵀJ)
//     scaling, as opposed to Levenberg's plain identity damping) with a numeric Jacobian
//     (central differences) and trust-region-style damping updates per Nocedal & Wright,
//     "Numerical Optimization" 2nd ed. (2006), §10.3.
//
// Preamp convention (headroom make-up gain so the fitted chain never clips at unity input)
// matches AutoEQ's ParametricEQ.txt output: preamp = -max(0, peak of the fitted cascade).

import { peaking, lowshelf, highshelf, magnitude, cascadeMagnitude } from '@audio/biquad'

const clamp = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v
const HALF_POWER_DB = 3.0103 // 10·log10(2) — the −3 dB / half-power point
const MIN_GAIN_DB = 0.1 // a band below this |gain| is inaudible noise, not a feature — same floor the final trim uses

function coefsFor (type, fc, Q, fs, gain) {
	let fn = type === 'lowshelf' ? lowshelf : type === 'highshelf' ? highshelf : peaking
	return fn(fc, Q, fs, gain)
}

function toSOS (bands, fs) {
	return bands.map(b => coefsFor(b.type, b.fc, b.Q, fs, b.gain))
}

/** log-spaced grid of `n` frequencies in [fMin, fMax], inclusive both ends. */
function logGrid (fMin, fMax, n) {
	let g = new Float64Array(n)
	if (n === 1) { g[0] = fMin; return g }
	let lo = Math.log(fMin), hi = Math.log(fMax)
	for (let i = 0; i < n; i++) g[i] = Math.exp(lo + (hi - lo) * i / (n - 1))
	return g
}

// ── target sampling — accepts the same forms @audio/eq-fir and @audio/spectral-target do ──

function interpPointsLogF (pts, f) {
	let last = pts.length - 1
	if (f <= pts[0].f) return pts[0].gain
	if (f >= pts[last].f) return pts[last].gain
	for (let i = 1; i <= last; i++) {
		if (f <= pts[i].f) {
			let f0 = pts[i - 1].f, f1 = pts[i].f
			let t = (Math.log(f) - Math.log(f0)) / (Math.log(f1) - Math.log(f0))
			return pts[i - 1].gain + t * (pts[i].gain - pts[i - 1].gain)
		}
	}
	return pts[last].gain
}

// Float32Array/Float64Array dB-per-bin: bins over [0, fs/2], bin k ↔ k·fs/(2·(len−1)) —
// the @audio/spectral-target / @audio/measure-response bin-grid convention. Bins are
// linearly spaced by construction, so interpolation is linear in f (not log-f).
function sampleBinArray (arr, fs, f) {
	let bins = arr.length, n = 2 * (bins - 1)
	let kf = f * n / fs
	if (kf <= 0) return arr[0]
	if (kf >= bins - 1) return arr[bins - 1]
	let k0 = Math.floor(kf), t = kf - k0
	return arr[k0] + t * (arr[k0 + 1] - arr[k0])
}

// { freqs, db } — the @audio/measure-response shape. freqs ascending, not necessarily
// uniform, so binary-search + linear interpolation in f.
function sampleFreqsDb (freqs, db, f) {
	let n = freqs.length
	if (f <= freqs[0]) return db[0]
	if (f >= freqs[n - 1]) return db[n - 1]
	let lo = 0, hi = n - 1
	while (hi - lo > 1) {
		let mid = (lo + hi) >> 1
		if (freqs[mid] <= f) lo = mid; else hi = mid
	}
	let t = (f - freqs[lo]) / (freqs[hi] - freqs[lo])
	return db[lo] + t * (db[hi] - db[lo])
}

function sampleTarget (target, freqsGrid, fs) {
	let n = freqsGrid.length
	let out = new Float64Array(n)
	if (typeof target === 'function') {
		for (let i = 0; i < n; i++) out[i] = target(freqsGrid[i])
	} else if (target instanceof Float32Array || target instanceof Float64Array) {
		for (let i = 0; i < n; i++) out[i] = sampleBinArray(target, fs, freqsGrid[i])
	} else if (Array.isArray(target)) {
		if (!target.length) throw new Error('@audio/eq-fit: fit(): target array is empty')
		let pts = [...target].sort((a, b) => a.f - b.f)
		for (let i = 0; i < n; i++) out[i] = interpPointsLogF(pts, freqsGrid[i])
	} else if (target && target.freqs && target.db) {
		for (let i = 0; i < n; i++) out[i] = sampleFreqsDb(target.freqs, target.db, freqsGrid[i])
	} else {
		throw new Error('@audio/eq-fit: fit(): unrecognized target — expected {f,gain}[], f => dB, Float32Array dB-per-bin, or {freqs, db}')
	}
	return out
}

// ── weighted error metrics on the eval grid ──

function weightedRms (residual, freqsGrid, weight) {
	let sumSq = 0, sumW = 0
	for (let i = 0; i < residual.length; i++) {
		let w = weight(freqsGrid[i])
		sumSq += w * residual[i] * residual[i]
		sumW += w
	}
	return Math.sqrt(sumSq / sumW)
}

function maxAbs (residual) {
	let m = 0
	for (let i = 0; i < residual.length; i++) m = Math.max(m, Math.abs(residual[i]))
	return m
}

// ── per-band response curve on the grid, dB (additive across a cascade: Σ 20·log10|H_b(f)|
// = 20·log10 Π|H_b(f)| = 20·log10|H_cascade(f)| — same value @audio/biquad's cascadeMagnitude
// would give, just computed incrementally per band so the optimizer never re-evaluates
// bands it didn't touch) ──

function bandCurve (band, freqsGrid, fs) {
	let c = coefsFor(band.type, band.fc, band.Q, fs, band.gain)
	let n = freqsGrid.length
	let out = new Float64Array(n)
	for (let i = 0; i < n; i++) out[i] = 20 * Math.log10(magnitude(c, freqsGrid[i], fs))
	return out
}

function evalTotal (bands, freqsGrid, fs) {
	let n = freqsGrid.length
	let total = new Float64Array(n)
	for (let b of bands) {
		let c = bandCurve(b, freqsGrid, fs)
		for (let i = 0; i < n; i++) total[i] += c[i]
	}
	return total
}

// ── stage 1: greedy residual-peak-picking init ──

// Fractional-octave smoothing on a log-uniform grid: since the grid's Δlog2(f) step is
// constant by construction, an ±oct/2 octave window is a fixed count of neighbouring
// samples — no re-derivation of frequency needed per point (contrast with
// @audio/spectral-target's smooth(), which operates on a linear FFT-bin grid instead).
function smoothGrid (arr, freqsGrid, oct) {
	let n = arr.length
	let logStep = Math.log2(freqsGrid[n - 1] / freqsGrid[0]) / (n - 1)
	let half = Math.max(0, Math.round((oct / 2) / logStep))
	let out = new Float64Array(n)
	for (let i = 0; i < n; i++) {
		let lo = Math.max(0, i - half), hi = Math.min(n - 1, i + half)
		let sum = 0
		for (let j = lo; j <= hi; j++) sum += arr[j]
		out[i] = sum / (hi - lo + 1)
	}
	return out
}

function argmaxAbs (arr) {
	let bi = 0, bv = -1
	for (let i = 0; i < arr.length; i++) {
		let v = Math.abs(arr[i])
		if (v > bv) { bv = v; bi = i }
	}
	return bi
}

// A shelf's defining property is the asymptotic gain it settles to far from its corner — so
// the natural place to detect whether one is needed is the fit range's own edge, not a
// mid-loop proximity/monotonicity guess about some other band's peak location. Walking
// inward from the edge, the corner is where the curve crosses half the edge's asymptotic
// value (a Q=0.707 shelf's transition sits close to that half-gain point) — the shelf
// analogue of estimateQ's half-power crossing below.
function estimateShelfCorner (curve, freqsGrid, dir) {
	let n = curve.length
	let edgeIdx = dir === -1 ? 0 : n - 1
	let step = -dir // walk from the edge *inward*, toward the center
	let asymptote = curve[edgeIdx]
	if (!asymptote) return freqsGrid[edgeIdx]
	let half = asymptote / 2
	let crosses = v => asymptote >= 0 ? v <= half : v >= half
	for (let i = edgeIdx; dir === -1 ? i < n - 1 : i > 0; i += step) {
		let next = i + step
		if (crosses(curve[next])) {
			let t = (curve[i] - half) / (curve[i] - curve[next])
			return Math.exp(Math.log(freqsGrid[i]) + t * (Math.log(freqsGrid[next]) - Math.log(freqsGrid[i])))
		}
	}
	return freqsGrid[dir === -1 ? n - 1 : 0] // never crosses — shelf spans the whole range
}

// Q from the −3 dB-of-gain (half-power) width of the lobe around idx: walk outward until
// the (smoothed) residual crosses peakVal ∓ 3.0103 dB, interpolating the exact log-f
// crossing point, then Q = fc / bandwidth — the RBJ cookbook's bandwidth-form Q.
function estimateQ (curve, freqsGrid, idx, peakVal) {
	if (!peakVal) return 1
	let n = curve.length
	let thresh = peakVal - Math.sign(peakVal) * HALF_POWER_DB
	let crosses = v => peakVal >= 0 ? v <= thresh : v >= thresh
	let logF = i => Math.log(freqsGrid[i])

	let fLo = freqsGrid[0]
	for (let i = idx; i > 0; i--) {
		if (crosses(curve[i - 1])) {
			let t = (curve[i] - thresh) / (curve[i] - curve[i - 1])
			fLo = Math.exp(logF(i) + t * (logF(i - 1) - logF(i)))
			break
		}
		fLo = freqsGrid[i - 1]
	}
	let fHi = freqsGrid[n - 1]
	for (let i = idx; i < n - 1; i++) {
		if (crosses(curve[i + 1])) {
			let t = (curve[i] - thresh) / (curve[i] - curve[i + 1])
			fHi = Math.exp(logF(i) + t * (logF(i + 1) - logF(i)))
			break
		}
		fHi = freqsGrid[i + 1]
	}
	let bw = fHi - fLo
	return bw > 0 ? freqsGrid[idx] / bw : 1
}

const SMOOTH_OCT = 1 / 3 // AutoEQ-style residual smoothing width

function addBand (bands, total, freqsGrid, o, band) {
	let curve = bandCurve(band, freqsGrid, o.fs)
	for (let i = 0; i < total.length; i++) total[i] += curve[i]
	bands.push(band)
}

function initBands (freqsGrid, targetDb, o) {
	let n = freqsGrid.length
	let bands = []
	let total = new Float64Array(n)

	// Shelves first, decided from the target's own values at fMin/fMax (its asymptotes),
	// each capped at one per side.
	for (let dir = -1; dir <= 1; dir += 2) {
		if (!o.shelves || bands.length >= o.maxBands) continue
		let residual = new Float64Array(n)
		for (let i = 0; i < n; i++) residual[i] = targetDb[i] - total[i]
		let smoothed = smoothGrid(residual, freqsGrid, SMOOTH_OCT)
		let edgeGain = clamp(smoothed[dir === -1 ? 0 : n - 1], -o.maxGain, o.maxGain)
		if (Math.abs(edgeGain) < MIN_GAIN_DB) continue
		let fc = estimateShelfCorner(smoothed, freqsGrid, dir)
		addBand(bands, total, freqsGrid, o, { type: dir === -1 ? 'lowshelf' : 'highshelf', fc, Q: 0.707, gain: edgeGain })
	}

	// Remaining slots: classical greedy residual-peak-picking.
	for (let iter = bands.length; iter < o.maxBands; iter++) {
		let residual = new Float64Array(n)
		for (let i = 0; i < n; i++) residual[i] = targetDb[i] - total[i]
		if (weightedRms(residual, freqsGrid, o.weight) <= o.tolerance) break

		let smoothed = smoothGrid(residual, freqsGrid, SMOOTH_OCT)
		let idx = argmaxAbs(smoothed)
		let gain = clamp(residual[idx], -o.maxGain, o.maxGain)
		let Q = clamp(estimateQ(smoothed, freqsGrid, idx, smoothed[idx]), o.minQ, o.maxQ)
		addBand(bands, total, freqsGrid, o, { type: 'peak', fc: freqsGrid[idx], Q, gain })
	}
	return bands
}

// ── stage 2: joint Levenberg–Marquardt refinement ──

// Gaussian elimination with partial pivoting. A: P×P row-major, b: length P. Returns the
// solution or null if A is (numerically) singular — small dense systems only (P ≤ ~30 here).
function solveLinear (A, b, P) {
	let M = Float64Array.from(A), x = Float64Array.from(b)
	for (let col = 0; col < P; col++) {
		let piv = col, pivVal = Math.abs(M[col * P + col])
		for (let r = col + 1; r < P; r++) {
			let v = Math.abs(M[r * P + col])
			if (v > pivVal) { pivVal = v; piv = r }
		}
		if (pivVal < 1e-14) return null
		if (piv !== col) {
			for (let c = 0; c < P; c++) { let t = M[col * P + c]; M[col * P + c] = M[piv * P + c]; M[piv * P + c] = t }
			let t = x[col]; x[col] = x[piv]; x[piv] = t
		}
		let d = M[col * P + col]
		for (let r = col + 1; r < P; r++) {
			let f = M[r * P + col] / d
			if (!f) continue
			for (let c = col; c < P; c++) M[r * P + c] -= f * M[col * P + c]
			x[r] -= f * x[col]
		}
	}
	let sol = new Float64Array(P)
	for (let r = P - 1; r >= 0; r--) {
		let s = x[r]
		for (let c = r + 1; c < P; c++) s -= M[r * P + c] * sol[c]
		sol[r] = s / M[r * P + r]
	}
	return sol
}

const H_LOG = 1e-4 // central-difference step in ln(fc)/ln(Q) space
const H_GAIN = 1e-3 // central-difference step in gain (dB)
const LM_DOWN = 0.3, LM_UP = 2, LM_MAX_TRIES = 15
const LM_TAU = 1e-3 // Marquardt 1963 §4's own recommendation for the initial damping: τ·max(diag(JᵀJ))
const REL_TOL = 1e-6

function decodeParams (p, types, o) {
	let B = types.length
	let out = new Array(B)
	for (let b = 0; b < B; b++) out[b] = {
		type: types[b],
		fc: clamp(Math.exp(p[3 * b]), o.fMin, o.fMax),
		gain: clamp(p[3 * b + 1], -o.maxGain, o.maxGain),
		Q: clamp(Math.exp(p[3 * b + 2]), o.minQ, o.maxQ),
	}
	return out
}

function refine (bands, freqsGrid, targetDb, o) {
	let B = bands.length
	if (!B) return bands
	let n = freqsGrid.length, P = 3 * B
	let types = bands.map(b => b.type)

	let p = new Float64Array(P)
	for (let b = 0; b < B; b++) {
		p[3 * b] = Math.log(bands[b].fc)
		p[3 * b + 1] = bands[b].gain
		p[3 * b + 2] = Math.log(bands[b].Q)
	}

	let w = new Float64Array(n)
	for (let i = 0; i < n; i++) w[i] = Math.sqrt(o.weight(freqsGrid[i]))

	// curve for band b alone, from full parameter vector pv (reads only band b's own slice)
	function curveOf (pv, b) {
		let bd = decodeParams(pv, types, o)[b]
		return bandCurve(bd, freqsGrid, o.fs)
	}

	let curves = new Array(B)
	for (let b = 0; b < B; b++) curves[b] = curveOf(p, b)
	let total = new Float64Array(n)
	for (let b = 0; b < B; b++) for (let i = 0; i < n; i++) total[i] += curves[b][i]

	let cost = 0
	for (let i = 0; i < n; i++) { let r = w[i] * (targetDb[i] - total[i]); cost += r * r }

	let lambda = null // set from the problem's own curvature scale on the first Jacobian below

	for (let iter = 0; iter < o.iterations; iter++) {
		// Jacobian: perturbing band b's param only changes band b's curve — reuse `total`
		// with the delta swapped in, instead of re-summing every band (O(B·grid) total
		// instead of O(B²·grid) for the whole Jacobian).
		let J = new Array(P)
		for (let b = 0; b < B; b++) {
			for (let k = 0; k < 3; k++) {
				let j = 3 * b + k
				let h = k === 1 ? H_GAIN : H_LOG
				let pPlus = p.slice(), pMinus = p.slice()
				pPlus[j] += h; pMinus[j] -= h
				let cPlus = curveOf(pPlus, b), cMinus = curveOf(pMinus, b)
				let col = new Float64Array(n)
				for (let i = 0; i < n; i++) {
					let rPlus = w[i] * (targetDb[i] - (total[i] - curves[b][i] + cPlus[i]))
					let rMinus = w[i] * (targetDb[i] - (total[i] - curves[b][i] + cMinus[i]))
					col[i] = (rPlus - rMinus) / (2 * h)
				}
				J[j] = col
			}
		}

		let r = new Float64Array(n)
		for (let i = 0; i < n; i++) r[i] = w[i] * (targetDb[i] - total[i])

		// Gauss-Newton/LM normal equations: minimizing ½‖r(p+δ)‖² ≈ ½‖r + Jδ‖² over δ sets
		// Jᵀ(r + Jδ) = 0, i.e. (JᵀJ)δ = −Jᵀr (Nocedal & Wright §10.3, eq. 10.20's damped form
		// below) — note the sign: without it, δ climbs the cost surface instead of descending it.
		let JTJ = new Float64Array(P * P), negJTr = new Float64Array(P)
		for (let a = 0; a < P; a++) {
			let colA = J[a], s = 0
			for (let i = 0; i < n; i++) s += colA[i] * r[i]
			negJTr[a] = -s
			for (let bb = a; bb < P; bb++) {
				let colB = J[bb], s2 = 0
				for (let i = 0; i < n; i++) s2 += colA[i] * colB[i]
				JTJ[a * P + bb] = s2; JTJ[bb * P + a] = s2
			}
		}
		if (lambda === null) {
			let maxDiag = 0
			for (let d = 0; d < P; d++) maxDiag = Math.max(maxDiag, JTJ[d * P + d])
			lambda = LM_TAU * Math.max(maxDiag, 1e-12)
		}

		let stepAccepted = false
		for (let tries = 0; tries < LM_MAX_TRIES; tries++) {
			let A = JTJ.slice()
			for (let d = 0; d < P; d++) A[d * P + d] += lambda * Math.max(JTJ[d * P + d], 1e-12)
			let delta = solveLinear(A, negJTr, P)
			if (!delta) { lambda *= LM_UP; continue }

			let pTrial = new Float64Array(P)
			for (let j = 0; j < P; j++) pTrial[j] = p[j] + delta[j]
			let trialCurves = new Array(B)
			let trialTotal = new Float64Array(n)
			for (let b = 0; b < B; b++) {
				trialCurves[b] = curveOf(pTrial, b)
				for (let i = 0; i < n; i++) trialTotal[i] += trialCurves[b][i]
			}
			let trialCost = 0
			for (let i = 0; i < n; i++) { let rr = w[i] * (targetDb[i] - trialTotal[i]); trialCost += rr * rr }

			if (trialCost < cost) {
				let relImprove = (cost - trialCost) / Math.max(cost, 1e-30)
				// re-derive p from the *clamped* decoded bands (box-constraint projection),
				// so a parameter driven to its bound doesn't keep exploding in log-space
				let decoded = decodeParams(pTrial, types, o)
				for (let b = 0; b < B; b++) {
					p[3 * b] = Math.log(decoded[b].fc)
					p[3 * b + 1] = decoded[b].gain
					p[3 * b + 2] = Math.log(decoded[b].Q)
				}
				curves = trialCurves; total = trialTotal
				cost = trialCost
				lambda = Math.max(lambda * LM_DOWN, 1e-12)
				stepAccepted = true
				if (relImprove < REL_TOL) return decodeParams(p, types, o)
				break
			}
			lambda *= LM_UP
		}
		if (!stepAccepted) break // damping maxed out without an improving step: converged/stuck
	}

	return decodeParams(p, types, o)
}

// ── preamp: headroom make-up gain so the fitted chain never clips at unity input ──

function scanPeakDb (bands, fs, fMin, fMax) {
	if (!bands.length) return 0
	let sos = toSOS(bands, fs)
	// oversampled relative to the fit grid so a high-Q resonance's true peak (which can sit
	// between two fit-grid samples) isn't underestimated
	const N = 2048
	let g = logGrid(fMin, fMax, N)
	let peak = -Infinity
	for (let i = 0; i < N; i++) peak = Math.max(peak, 20 * Math.log10(cascadeMagnitude(sos, g[i], fs)))
	return peak
}

/** Cascade magnitude response (incl. preamp), via @audio/biquad's cascadeMagnitude. */
export function response (bands, preamp = 0, fs = 44100) {
	let sos = toSOS(bands, fs)
	return f => 20 * Math.log10(cascadeMagnitude(sos, f, fs)) + preamp
}

export default function fit (target, opts = {}) {
	let {
		fs = 44100, bands: maxBands = 8, fMin = 20, fMax = 20000, shelves = true,
		maxGain = 12, minQ = 0.3, maxQ = 10, tolerance = 0.5,
		weight = () => 1, grid = 256, iterations = 200, preamp: preampOpt = true,
	} = opts

	if (fMin <= 0 || fMax <= fMin) throw new Error('@audio/eq-fit: fit(): fMin must be > 0 and fMax > fMin')
	if (maxBands < 0) throw new Error('@audio/eq-fit: fit(): bands must be ≥ 0')

	let freqsGrid = logGrid(fMin, fMax, grid)
	let targetDb = sampleTarget(target, freqsGrid, fs)

	let o = { fs, maxBands, fMin, fMax, shelves, maxGain, minQ, maxQ, tolerance, weight, iterations }
	let bands = initBands(freqsGrid, targetDb, o)
	bands = refine(bands, freqsGrid, targetDb, o)

	// drop negligible bands, keep the parametric-EQ convention of sorting by frequency
	bands = bands.filter(b => Math.abs(b.gain) >= MIN_GAIN_DB).sort((a, b) => a.fc - b.fc)

	let preamp = preampOpt === false ? 0 : -Math.max(0, scanPeakDb(bands, fs, fMin, fMax))

	let fitted = evalTotal(bands, freqsGrid, fs)
	let residual = new Float64Array(freqsGrid.length)
	for (let i = 0; i < freqsGrid.length; i++) residual[i] = targetDb[i] - fitted[i]

	return {
		bands,
		preamp,
		error: weightedRms(residual, freqsGrid, weight),
		maxError: maxAbs(residual),
		response: response(bands, preamp, fs),
	}
}

// ── Equalizer APO / AutoEQ ParametricEQ.txt format ──
// Filter type codes as AutoEQ writes them: PK (peaking), LSC (low-shelf), HSC (high-shelf).
// Equalizer APO's own config syntax additionally accepts LS/HS (no trailing "C") and PEQ for
// peaking — fromEqualizerApo() reads all of them; toEqualizerApo() always writes AutoEQ's PK/LSC/HSC.

const TYPE_TO_CODE = { peak: 'PK', lowshelf: 'LSC', highshelf: 'HSC' }
const CODE_TO_TYPE = { PK: 'peak', PEQ: 'peak', LS: 'lowshelf', LSC: 'lowshelf', HS: 'highshelf', HSC: 'highshelf' }

/** Preamp + N-band cascade → AutoEQ / Equalizer APO ParametricEQ.txt text. */
export function toEqualizerApo (result) {
	let { bands, preamp = 0 } = result
	let lines = [`Preamp: ${(preamp || 0).toFixed(1)} dB`]
	bands.forEach((b, i) => {
		let code = TYPE_TO_CODE[b.type]
		if (!code) throw new Error(`@audio/eq-fit: toEqualizerApo(): unknown band type "${b.type}"`)
		lines.push(`Filter ${i + 1}: ON ${code} Fc ${Math.round(b.fc)} Hz Gain ${b.gain.toFixed(1)} dB Q ${b.Q.toFixed(2)}`)
	})
	return lines.join('\n') + '\n'
}

const FILTER_LINE = /^filter\s*\d*\s*:\s*(on|off)\s+(\S+)\s+fc\s+([\d.]+)\s*hz\s+gain\s+(-?[\d.]+)\s*dB\s+q\s+([\d.]+)/i

/** Parse Equalizer APO / AutoEQ ParametricEQ.txt text → { bands, preamp }. */
export function fromEqualizerApo (text) {
	let bands = [], preamp = 0
	for (let raw of String(text).split(/\r?\n/)) {
		let line = raw.trim()
		if (!line) continue
		let mPre = line.match(/^preamp\s*:\s*(-?[\d.]+)\s*dB/i)
		if (mPre) { preamp = parseFloat(mPre[1]); continue }
		let m = line.match(FILTER_LINE)
		if (!m) continue
		let [, onoff, code, fc, gain, Q] = m
		if (onoff.toLowerCase() === 'off') continue
		let type = CODE_TO_TYPE[code.toUpperCase()]
		if (!type) throw new Error(`@audio/eq-fit: fromEqualizerApo(): unknown filter type "${code}"`)
		bands.push({ type, fc: parseFloat(fc), Q: parseFloat(Q), gain: parseFloat(gain) })
	}
	bands.sort((a, b) => a.fc - b.fc)
	return { bands, preamp }
}
