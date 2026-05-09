import Link from "next/link";
import { ChainHeaderTitle } from "@/components/ChainHeaderTitle";
import { ConfigBanner } from "@/components/ConfigBanner";
import { ConnectButton } from "@/components/ConnectButton";
import { ChainView } from "@/components/ChainView";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function ChainPage({ params }: PageProps) {
  const { id } = await params;
  return (
    <main className="min-h-screen flex flex-col bg-white">
      <header className="flex items-center justify-between px-6 py-3 border-b border-zinc-200 bg-white">
        <div className="flex items-baseline gap-3">
          <Link href="/" className="font-semibold tracking-tight text-zinc-900 hover:underline">
            Pocket<span className="text-slate-600">Chains</span>
          </Link>
          <ChainHeaderTitle id={id} />
        </div>
        <ConnectButton />
      </header>
      <ConfigBanner />
      <ChainView chainIdStr={id} />
    </main>
  );
}
