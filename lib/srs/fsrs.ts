// Pure FSRS (Free Spaced Repetition Scheduler) core — the memory model that replaces SM-2 (F1).
// NO file system, NO Date.now(): every function is a deterministic function of its inputs, so it stays
// unit-testable (E2) under the same explicit-clock discipline the SM-2 scheduler already used.
//
// FSRS in one breath: where SM-2 carried a single "ease factor", FSRS models each card with THREE
// quantities tied together by a forgetting curve:
//   - Stability (S): days until the recall probability of the card falls to 90%. Bigger S = the memory
//     lasts longer. This is what grows each time you successfully review.
//   - Difficulty (D, 1..10): how intrinsically hard the card is. Higher D makes S grow more slowly.
//   - Retrievability (R, 0..1): the probability you can recall the card *right now*. It decays with the
//     time elapsed since the last review along the curve R(t,S).
// The next interval is just the time it takes R to decay from 1 back down to the requested retention
// (90%) — which works out to ≈ S. The grade (Again/Hard/Good/Easy) drives how S and D update, so the
// four buttons differentiate retention *by construction* — no grade-aware bolt-on like SM-2 needed (C3).
//
// This is FSRS-4.5 with its published default parameters. Formulas + weights:
//   https://github.com/open-spaced-repetition/awesome-fsrs/wiki/The-Algorithm
import type { Grade } from "./types";

/**
 * The 17 trained FSRS-4.5 default parameters (w0..w16). In real FSRS these are *fitted* to a user's own
 * review history by an optimizer; we ship the published defaults — building the optimizer is a project of
 * its own and out of F1's scope. Each weight's role is documented where it is used below.
 */
export const FSRS_PARAMS = [
  0.4872, 1.4003, 3.7145, 13.8206, 5.1618, 1.2298, 0.8975, 0.031, 1.6474, 0.1367, 1.0461, 2.1072,
  0.0793, 0.3246, 1.587, 0.2272, 2.8755,
] as const;

/** Forgetting-curve shape constants. R(t,S) = (1 + FACTOR·t/S)^DECAY, tuned so R = 0.9 exactly when t = S. */
const DECAY = -0.5;
const FACTOR = 19 / 81; // = 0.9^(1/DECAY) − 1

/** The retention we schedule for: a card is due again once its recall probability has decayed to this. */
export const REQUEST_RETENTION = 0.9;

/** Bounds: difficulty lives in [1,10]; stability never drops below a tiny floor; intervals are capped. */
const MIN_DIFFICULTY = 1;
const MAX_DIFFICULTY = 10;
const MIN_STABILITY = 0.01;
const MAX_INTERVAL = 36500; // 100 years — FSRS's default ceiling

/** Map the 4-button grade onto FSRS's 1..4 rating scale (Again/Hard/Good/Easy). */
const RATING: Record<Grade, 1 | 2 | 3 | 4> = { again: 1, hard: 2, good: 3, easy: 4 };

const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

/** Probability of recalling a card `elapsedDays` after its last review, given its stability. */
export function retrievability(elapsedDays: number, stability: number): number {
  const t = Math.max(0, elapsedDays);
  const s = Math.max(MIN_STABILITY, stability);
  return Math.pow(1 + FACTOR * (t / s), DECAY);
}

/** Days until retrievability decays from 1 to REQUEST_RETENTION — i.e. the next interval (≈ stability). */
export function intervalFromStability(stability: number): number {
  const raw = (stability / FACTOR) * (Math.pow(REQUEST_RETENTION, 1 / DECAY) - 1);
  return clamp(Math.round(raw), 1, MAX_INTERVAL);
}

/** First-ever stability after the opening rating: S0(G) = w[G−1]. */
export function initStability(grade: Grade): number {
  return Math.max(MIN_STABILITY, FSRS_PARAMS[RATING[grade] - 1]);
}

/** First-ever difficulty: D0(G) = w4 − (G−3)·w5, clamped to [1,10]. A harder opening grade → higher D. */
export function initDifficulty(grade: Grade): number {
  const g = RATING[grade];
  return clamp(FSRS_PARAMS[4] - (g - 3) * FSRS_PARAMS[5], MIN_DIFFICULTY, MAX_DIFFICULTY);
}

/** D0 for a "good" first rating (G=3) — the anchor the difficulty update mean-reverts toward. */
const DIFFICULTY_GOOD_ANCHOR = FSRS_PARAMS[4]; // = D0(3), since the (G−3)·w5 term is 0

/**
 * Difficulty after a review: nudge it by the grade (−w6·(G−3); a fail raises it, "easy" lowers it), then
 * mean-revert toward the "good" anchor by w7 so difficulty drifts back to centre instead of running away.
 * Clamped to [1,10].
 */
export function nextDifficulty(difficulty: number, grade: Grade): number {
  const g = RATING[grade];
  const nudged = difficulty - FSRS_PARAMS[6] * (g - 3);
  const reverted = FSRS_PARAMS[7] * DIFFICULTY_GOOD_ANCHOR + (1 - FSRS_PARAMS[7]) * nudged;
  return clamp(reverted, MIN_DIFFICULTY, MAX_DIFFICULTY);
}

/**
 * Stability after a SUCCESSFUL recall (Hard/Good/Easy). The lower the retrievability was (you nearly
 * forgot it) and the lower the difficulty, the bigger the jump; Hard is penalised (w15), Easy bonused (w16):
 *   S' = S · ( e^w8 · (11−D) · S^(−w9) · (e^(w10·(1−R)) − 1) · hardPenalty · easyBonus + 1 )
 */
export function nextRecallStability(difficulty: number, stability: number, r: number, grade: Grade): number {
  const s = Math.max(MIN_STABILITY, stability);
  const hardPenalty = grade === "hard" ? FSRS_PARAMS[15] : 1;
  const easyBonus = grade === "easy" ? FSRS_PARAMS[16] : 1;
  const inc =
    Math.exp(FSRS_PARAMS[8]) *
    (11 - difficulty) *
    Math.pow(s, -FSRS_PARAMS[9]) *
    (Math.exp(FSRS_PARAMS[10] * (1 - r)) - 1) *
    hardPenalty *
    easyBonus;
  return Math.max(MIN_STABILITY, s * (inc + 1));
}

/**
 * Stability after a LAPSE (Again). It drops to a (usually much smaller) post-forgetting stability that
 * the next successful interval will then grow from:
 *   S' = w11 · D^(−w12) · ((S+1)^w13 − 1) · e^(w14·(1−R))
 */
export function nextLapseStability(difficulty: number, stability: number, r: number): number {
  const s = Math.max(MIN_STABILITY, stability);
  const next =
    FSRS_PARAMS[11] *
    Math.pow(difficulty, -FSRS_PARAMS[12]) *
    (Math.pow(s + 1, FSRS_PARAMS[13]) - 1) *
    Math.exp(FSRS_PARAMS[14] * (1 - r));
  return Math.max(MIN_STABILITY, next);
}
