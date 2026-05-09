import { ConfigBanner } from "@/components/ConfigBanner";
import { ConnectButton } from "@/components/ConnectButton";
import { HomeBody } from "@/components/HomeBody";

export default function Home() {
  return (
    <main className="min-h-screen flex flex-col bg-zinc-50">
      <header className="flex items-center justify-between px-6 py-4 border-b border-zinc-200 bg-white">
        <div className="font-semibold tracking-tight text-zinc-900">
          Pocket<span className="text-sky-500">Chains</span>
        </div>
        <ConnectButton />
      </header>
      <ConfigBanner />
      <HomeBody />
    </main>
  );
}
