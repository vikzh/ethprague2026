import { NextResponse } from "next/server";
import { createPublicClient, http } from "viem";
import { sepolia } from "viem/chains";
import { discoverAllChains } from "@/lib/discovery";

export const dynamic = "force-dynamic";

function rpcUrl(): string | undefined {
  const raw = process.env.NEXT_PUBLIC_RPC_URL?.trim();
  return raw || undefined;
}

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function GET() {
  const publicClient = createPublicClient({
    chain: sepolia,
    transport: http(rpcUrl()),
  });

  try {
    const chains = await discoverAllChains(publicClient);
    return NextResponse.json({
      chains: chains.map((chain) => ({
        id: chain.id.toString(),
        creator: chain.creator,
        blockNumber: chain.blockNumber.toString(),
        seedCommit: chain.seedCommit,
        expiresAt: chain.expiresAt.toString(),
      })),
    });
  } catch (e) {
    return errorResponse((e as Error).message || "Chain discovery failed.", 502);
  }
}
