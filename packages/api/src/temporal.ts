import { Client, Connection } from '@temporalio/client';

let clientPromise: Promise<Client> | undefined;

/** Lazily-created, reused Temporal client (one connection per API process). */
export function getClient(): Promise<Client> {
  if (!clientPromise) {
    clientPromise = (async () => {
      const connection = await Connection.connect({
        address: process.env.TEMPORAL_ADDRESS ?? 'localhost:7233',
      });
      return new Client({ connection, namespace: process.env.TEMPORAL_NAMESPACE ?? 'default' });
    })();
  }
  return clientPromise;
}
