/**
 * Temporal-free control flags the business Lambdas read (SPEC §4.4).
 *
 * Locally these are in-memory (toggled at runtime by the API for the fault demo)
 * with an env-var initial value. In the cloud these become SSM params / a tiny
 * control store the deployed Lambdas read. No Temporal dependency either way.
 */

let syndicationFault = process.env.BMO_SYNDICATION_FAULT === 'true';

/** Flip the syndication-partner schema break on/off (UI "Inject fault" / "Clear fault"). */
export function setSyndicationFault(on: boolean): void {
  syndicationFault = on;
}

export function syndicationFaultEnabled(): boolean {
  return syndicationFault;
}
