import type { AbiEvent, Log } from "viem";
import { CHAINPOOL_ADDRESS, CHAINPOOL_DEPLOY_BLOCK, LOGS_BLOCK_RANGE } from "./contract";

interface ChunkedLogOptions {
  fromBlock?: bigint;
  toBlock?: bigint;
  delayMs?: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRateLimitError(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error);
  return (
    text.includes("exceeded its compute units per second capacity") ||
    text.includes("rate limit") ||
    text.includes("429")
  );
}

/**
 * Fetch logs in `LOGS_BLOCK_RANGE`-sized windows from `CHAINPOOL_DEPLOY_BLOCK` to
 * the current head. Most public RPCs reject a single query that spans more than
 * ~10k blocks, so we chunk.
 *
 * Typed as `unknown` to side-step viem's heavily-overloaded `getLogs` generics —
 * we only need the two methods at runtime.
 */
export async function getChunkedLogs<TEvent extends AbiEvent>(
  publicClient: unknown,
  event: TEvent,
  args?: object,
  options: ChunkedLogOptions = {},
): Promise<Log[]> {
  const client = publicClient as {
    getBlockNumber: () => Promise<bigint>;
    getLogs: (params: Record<string, unknown>) => Promise<Log[]>;
  };

  const head = options.toBlock ?? (await client.getBlockNumber());
  let from = options.fromBlock ?? (CHAINPOOL_DEPLOY_BLOCK < 0n ? 0n : CHAINPOOL_DEPLOY_BLOCK);
  if (from < 0n) from = 0n;
  if (from > head) return [];

  const out: Log[] = [];
  while (from <= head) {
    const candidate = from + LOGS_BLOCK_RANGE - 1n;
    const to = candidate > head ? head : candidate;
    let batch: Log[] | null = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        batch = await client.getLogs({
          address: CHAINPOOL_ADDRESS,
          event,
          args,
          fromBlock: from,
          toBlock: to,
        });
        break;
      } catch (e) {
        if (!isRateLimitError(e) || attempt === 3) throw e;
        await sleep(500 * 2 ** attempt);
      }
    }
    if (batch === null) {
      throw new Error("Failed to fetch logs.");
    }
    out.push(...batch);
    from = to + 1n;
    if (options.delayMs && from <= head) {
      await sleep(options.delayMs);
    }
  }
  return out;
}
