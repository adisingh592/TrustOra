/**
 * Browser-safe copy of the evaluator's input limit (the evaluation package imports node:crypto, so the browser
 * cannot import it). test/limits.test.ts fails if this ever drifts from packages/evaluation.
 */
export const MAX_DELIVERABLE_CHARS = 24_000;
