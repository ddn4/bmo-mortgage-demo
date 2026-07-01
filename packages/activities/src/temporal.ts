import { Client, Connection } from '@temporalio/client';

let clientPromise: Promise<Client> | undefined;

/**
 * Lazily-created, reused Temporal client for activity-side reads (e.g. the
 * syndication-fault flag from the control workflow's memo). Uses the same
 * connection env the worker does — plaintext localhost for dev, API-key + TLS for
 * Temporal Cloud. One connection per worker process / Lambda container.
 */
export function getActivityClient(): Promise<Client> {
  if (!clientPromise) {
    clientPromise = (async () => {
      const apiKey = process.env.TEMPORAL_API_KEY;
      const connection = await Connection.connect({
        address: process.env.TEMPORAL_ADDRESS ?? 'localhost:7233',
        ...(apiKey ? { apiKey, tls: true } : {}),
      });
      return new Client({ connection, namespace: process.env.TEMPORAL_NAMESPACE ?? 'default' });
    })();
  }
  return clientPromise;
}
