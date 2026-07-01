import { condition, setHandler, upsertMemo } from '@temporalio/workflow';
import { getSyndicationFault, setSyndicationFault } from './definitions';

/**
 * Singleton control workflow (workflowId `bmo-fault-control`) holding the
 * syndication-fault toggle — a Temporal-native control plane that replaces the
 * old in-process :8088 control server, so fault injection works identically
 * local and in cloud with no AWS SSM/IAM.
 *
 * The flag is mirrored to a **memo** on every change, so the API and the
 * syndication activity can read the current state via `describe()` WITHOUT a live
 * worker — the UI can poll it under scale-to-zero without cold-starting a worker.
 * The API toggles it via `signalWithStart` (which cold-starts a worker just long
 * enough to process the signal + update the memo, then it can scale back to zero).
 */
export async function faultControlWorkflow(initial = false): Promise<void> {
  let fault = initial;
  upsertMemo({ syndicationFault: fault });
  setHandler(getSyndicationFault, () => fault);
  setHandler(setSyndicationFault, (on: boolean) => {
    fault = on;
    upsertMemo({ syndicationFault: fault });
  });
  // Long-lived: parks here forever, toggled purely via the signal handler.
  await condition(() => false);
}
