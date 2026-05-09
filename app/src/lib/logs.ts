import type { AbiEvent, Log } from "viem";
import { CHAINPOOL_ADDRESS, CHAINPOOL_DEPLOY_BLOCK, LOGS_BLOCK_RANGE } from "./contract";

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
): Promise<Log[]> {
  const client = publicClient as {
    getBlockNumber: () => Promise<bigint>;
    getLogs: (params: Record<string, unknown>) => Promise<Log[]>;
  };

  const head = await client.getBlockNumber();
  let from = CHAINPOOL_DEPLOY_BLOCK < 0n ? 0n : CHAINPOOL_DEPLOY_BLOCK;
  if (from > head) return [];

  const out: Log[] = [];
  while (from <= head) {
    const candidate = from + LOGS_BLOCK_RANGE - 1n;
    const to = candidate > head ? head : candidate;
    const batch = await client.getLogs({
      address: CHAINPOOL_ADDRESS,
      event,
      args,
      fromBlock: from,
      toBlock: to,
    });
    out.push(...batch);
    from = to + 1n;
  }
  return out;
}
