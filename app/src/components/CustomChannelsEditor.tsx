"use client";

import type { CustomChannelDef, ChannelWritePolicy } from "@/lib/eip712";

const WRITE_OPTIONS: { value: ChannelWritePolicy; label: string }[] = [
  { value: "anyone", label: "anyone with a chat key" },
  { value: "verified", label: "verified members only" },
  { value: "creator", label: "creator only" },
];

export function CustomChannelsEditor({
  value,
  onChange,
}: {
  value: CustomChannelDef[];
  onChange: (next: CustomChannelDef[]) => void;
}) {
  function setAt(i: number, patch: Partial<CustomChannelDef>) {
    const next = value.slice();
    next[i] = { ...next[i]!, ...patch };
    onChange(next);
  }
  function addRow() {
    if (value.length >= 8) return;
    onChange([...value, { name: "", write: "anyone" }]);
  }
  function removeAt(i: number) {
    onChange(value.filter((_, idx) => idx !== i));
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <span className="text-[11px] uppercase tracking-wide text-zinc-500">
          Custom channels (optional)
        </span>
        <span className="text-[10px] text-zinc-500">
          # public &amp; # verified are always included
        </span>
      </div>
      {value.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {value.map((ch, i) => (
            <li key={i} className="flex items-center gap-2">
              <span className="text-zinc-400 text-sm">#</span>
              <input
                value={ch.name}
                onChange={(e) =>
                  setAt(i, { name: e.target.value.replace(/[^a-zA-Z0-9-_]/g, "") })
                }
                placeholder="channel-name"
                maxLength={32}
                className="flex-1 rounded-lg bg-white border border-zinc-200 px-2 py-1.5 text-sm placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-sky-200 focus:border-sky-400"
              />
              <select
                value={ch.write}
                onChange={(e) =>
                  setAt(i, { write: e.target.value as ChannelWritePolicy })
                }
                className="rounded-lg bg-white border border-zinc-200 px-2 py-1.5 text-sm"
              >
                {WRITE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => removeAt(i)}
                className="text-zinc-500 hover:text-zinc-700 text-xs"
                title="Remove this channel"
              >
                remove
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {value.length < 8 ? (
        <button
          type="button"
          onClick={addRow}
          className="self-start text-xs text-sky-600 hover:text-sky-700 font-medium"
        >
          + add channel
        </button>
      ) : null}
      {value.length > 0 ? (
        <p className="text-[10px] text-zinc-500">
          Names are normalized (lowercased) and dedupe by name. Replay drops
          messages in restricted channels from senders that don&apos;t match the
          policy.
        </p>
      ) : null}
    </div>
  );
}
