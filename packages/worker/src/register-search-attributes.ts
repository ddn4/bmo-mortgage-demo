import { Connection } from '@temporalio/client';
import { SEARCH_ATTRIBUTES } from '@bmo/shared';

// temporal.api.enums.v1.IndexedValueType.INDEXED_VALUE_TYPE_KEYWORD
const KEYWORD = 2;

/**
 * Register the demo's custom Search Attributes on the local dev / self-hosted
 * server, awaited before the worker starts polling so workflows can upsert them
 * (SPEC §4.6). Safe to call repeatedly — an "already exists" error is ignored.
 *
 * The OperatorService is NOT available on Temporal Cloud; there the attributes
 * are created once via the Cloud UI / tcld during the M5 cloud setup.
 */
export async function registerSearchAttributes(address: string, namespace: string): Promise<void> {
  const connection = await Connection.connect({ address });
  try {
    await connection.operatorService.addSearchAttributes({
      namespace,
      searchAttributes: Object.fromEntries(SEARCH_ATTRIBUTES.map((name) => [name, KEYWORD])),
    });
    console.log(`[worker] registered search attributes: ${SEARCH_ATTRIBUTES.join(', ')}`);
  } catch (err) {
    const msg = (err as Error).message ?? String(err);
    if (/already exist/i.test(msg)) {
      console.log('[worker] search attributes already registered');
    } else {
      console.warn(`[worker] search-attribute registration skipped: ${msg}`);
    }
  } finally {
    await connection.close();
  }
}
