"use client";

import { QRCodeSVG } from "qrcode.react";
import { useState } from "react";

export function InviteQR({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-4 flex flex-col items-center gap-3 shadow-sm">
      <div className="rounded-lg bg-white p-3 border border-zinc-100">
        <QRCodeSVG value={url} size={180} marginSize={0} fgColor="#2aabee" />
      </div>
      <div className="flex w-full items-center gap-2">
        <code className="flex-1 truncate rounded-md bg-zinc-50 border border-zinc-200 px-2 py-1.5 text-xs font-mono text-zinc-700">
          {url}
        </code>
        <button
          type="button"
          onClick={async () => {
            await navigator.clipboard.writeText(url);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          className="rounded-md bg-sky-500 text-white text-xs font-medium px-3 py-1.5 hover:bg-sky-600 transition"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <p className="text-xs text-zinc-500 text-center">
        Anyone who scans this can join the chain. Single secret in the URL fragment is
        never sent to a server.
      </p>
    </div>
  );
}
