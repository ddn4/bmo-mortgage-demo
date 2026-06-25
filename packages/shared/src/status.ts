/**
 * Mortgage application lifecycle status (SPEC §4.1).
 *
 * The first seven values form a linear pipeline order used for "status >= X"
 * comparisons (the field-locking gate). NEEDS_REVIEW is an orthogonal "stuck"
 * state surfaced by the Triage view, not part of the linear order.
 */
export enum ApplicationStatus {
  INTAKE = 'INTAKE',
  INCOME_VERIFICATION = 'INCOME_VERIFICATION',
  CROSS_REFERENCE = 'CROSS_REFERENCE',
  DECISION = 'DECISION',
  RATE_ASSIGNED = 'RATE_ASSIGNED',
  SYNDICATION = 'SYNDICATION',
  COMPLETED = 'COMPLETED',
  NEEDS_REVIEW = 'NEEDS_REVIEW',
}

/** Linear pipeline order. NEEDS_REVIEW is intentionally excluded. */
export const STATUS_ORDER: readonly ApplicationStatus[] = [
  ApplicationStatus.INTAKE,
  ApplicationStatus.INCOME_VERIFICATION,
  ApplicationStatus.CROSS_REFERENCE,
  ApplicationStatus.DECISION,
  ApplicationStatus.RATE_ASSIGNED,
  ApplicationStatus.SYNDICATION,
  ApplicationStatus.COMPLETED,
];

/** True when `current` is at or past `target` in the linear pipeline order. */
export function statusAtOrAfter(current: ApplicationStatus, target: ApplicationStatus): boolean {
  const c = STATUS_ORDER.indexOf(current);
  const t = STATUS_ORDER.indexOf(target);
  if (c === -1 || t === -1) return false;
  return c >= t;
}
