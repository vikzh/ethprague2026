import Link from "next/link";
import { ChainHeaderTitle } from "@/components/ChainHeaderTitle";
import { ConfigBanner } from "@/components/ConfigBanner";
import { ConnectButton } from "@/components/ConnectButton";
import { CreateChainCard } from "@/components/CreateChainCard";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function ForkChainPage({ params }: PageProps) {
  const { id } = await params;
  return (
    <main className="min-h-screen flex flex-col bg-zinc-50">
      <header className="flex items-center justify-between px-6 py-3 border-b border-zinc-200 bg-white">
        <div className="flex items-baseline gap-3">
          <Link href="/" className="font-semibold tracking-tight text-zinc-900 hover:underline">
            Pocket<span className="text-slate-600">Chains</span>
          </Link>
          <ChainHeaderTitle id={id} />
          <span className="text-sm text-zinc-500">/ fork</span>
        </div>
        <ConnectButton />
      </header>
      <ConfigBanner />
      <div className="flex-1 flex items-start justify-center px-6 py-10">
        <div className="w-full max-w-xl flex flex-col gap-4">
          <Link
            href={`/chain/${id}`}
            className="text-xs text-slate-700 hover:text-slate-900 font-medium"
          >
            ← back to chain #{id}
          </Link>
          <CreateChainCard parentChainId={id} />
        </div>
      </div>
    </main>
  );
}
