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
    <main className="min-h-screen flex flex-col">
      <header className="flex items-center justify-between px-6 py-3 border-b border-zinc-800">
        <div className="flex items-baseline gap-3">
          <a href="/" className="font-semibold tracking-tight hover:underline">
            Pocket<span className="text-zinc-500">Chains</span>
          </a>
          <ChainHeaderTitle id={id} />
        </div>
        <ConnectButton />
      </header>
      <ConfigBanner />
      <ChainView chainIdStr={id} />
    </main>
  );
}
