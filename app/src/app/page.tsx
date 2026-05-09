import { ConfigBanner } from "@/components/ConfigBanner";
import { ConnectButton } from "@/components/ConnectButton";
import { HomeBody } from "@/components/HomeBody";

export default function Home() {
  return (
    <main className="min-h-screen flex flex-col">
      <header className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
        <div className="font-semibold tracking-tight">
          Pocket<span className="text-zinc-500">Chains</span>
        </div>
        <ConnectButton />
      </header>
      <ConfigBanner />
      <HomeBody />
    </main>
  );
}
