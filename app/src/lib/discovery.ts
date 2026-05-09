import { type Address, getAbiItem } from "viem";
import { CHAINPOOL_ABI } from "./contract";
import { getChunkedLogs } from "./logs";

export interface DiscoveredChain {
  id: bigint;
  creator: Address;
  blockNumber: bigint;
  seedCommit: `0x${string}`;
  expiresAt: bigint; // 0 = no expiry, unix seconds otherwise
}

const chainCreatedEvent = getAbiItem({ abi: CHAINPOOL_ABI, name: "ChainCreated" });

/** Read every ChainCreated event from deploy block to head. Newest first. */
export async function discoverAllChains(publicClient: unknown): Promise<DiscoveredChain[]> {
  const logs = await getChunkedLogs(publicClient, chainCreatedEvent);
  const out: DiscoveredChain[] = [];
  for (const l of logs) {
    const log = l as unknown as {
      blockNumber: bigint | null;
      args: { id: bigint; creator: Address; seedCommit: `0x${string}`; expiresAt?: bigint };
    };
    out.push({
      id: log.args.id,
      creator: log.args.creator,
      blockNumber: log.blockNumber ?? 0n,
      seedCommit: log.args.seedCommit,
      expiresAt: BigInt(log.args.expiresAt ?? 0n),
    });
  }
  // newest first
  out.sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
  return out;
}
