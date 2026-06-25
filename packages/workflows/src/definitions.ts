import { defineQuery, defineSignal, defineUpdate } from '@temporalio/workflow';
import type { ApplicationState, EditRequest, LenderCallback } from '@bmo/shared';

/**
 * Signal / Query / Update definitions, kept in their own module so the client
 * can import them WITHOUT loading the workflow implementation (which uses
 * workflow-only APIs). These define* calls are pure and safe to import anywhere.
 */

/** UI state / observability timeline — read-only (SPEC §4.2). */
export const getApplication = defineQuery<ApplicationState>('getApplication');

/**
 * Edit = Update with a validator (NOT a Signal). The validator rejects edits to
 * risk-sensitive fields once status >= RATE_ASSIGNED, giving the UI synchronous
 * accept/reject feedback (SPEC §4.2).
 */
export const editApplication = defineUpdate<ApplicationState, [EditRequest]>('editApplication');

/** Fire-and-forget lender-partner callback that resumes syndication (SPEC §4.5). */
export const lenderCallback = defineSignal<[LenderCallback]>('lenderCallback');

/**
 * Partner sales-channel intake (SPEC §4.5, the "hub"). Delivered via
 * signalWithStart so ingestion is idempotent — a new application starts, an
 * existing one just records the touch. No queue, no DLQ, no lost messages.
 */
export const partnerIntake = defineSignal<[{ source: string }]>('partnerIntake');
