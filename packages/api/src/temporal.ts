import { Client, Connection } from '@temporalio/client';

let clientPromise: Promise<Client> | undefined;

/** Lazily-created, reused Temporal client (one connection per API process). */
export function getClient(): Promise<Client> {
  if (!clientPromise) {
    clientPromise = (async () => {
      // API-key + TLS when connecting to Temporal Cloud (creds injected via env /
      // k8s Secret at runtime); plaintext localhost for local dev.
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
