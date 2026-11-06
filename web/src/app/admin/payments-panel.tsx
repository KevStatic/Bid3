"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useId, useState, type FormEvent } from "react";
import { formatEther } from "viem";
import { Button, Panel } from "@/components/ui";
import { PADDLE_ROSTER } from "@/lib/admin/paddles";
import { shortAddress } from "@/lib/format";
import { addressUrl, useBindings, usePaymentSettings } from "@/lib/payments";
import { adminPost, type Reply } from "./admin-post";

/**
 * Sepolia payments: how much ETH each credit of the hammer price costs (0 = a 0 ETH payment, only
 * gas), and which wallet each paddle pays from. Paddles get their wallet when a bidder taps the NFC
 * sticker and links it on the seat page; the auctioneer can unlink one here.
 */
export function PaymentsPanel({ password, onFailure }: { password: string; onFailure: (reply: Extract<Reply, { ok: false }>) => void }) {
  const queryClient = useQueryClient();
  const settings = usePaymentSettings();
  const bindings = useBindings();
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const rateId = useId();

  if (!settings.data) return null; // engine unreachable, or older than payments
  const current = formatEther(BigInt(settings.data.weiPerCredit));
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["engine"] });

  const onSave = async (event: FormEvent) => {
    event.preventDefault();
    if (draft === null) return;
    setBusy("rate");
    setSaved(null);
    const reply = await adminPost("/api/admin/payments", password, { ethPerCredit: draft });
    setBusy(null);
    if (!reply.ok) return onFailure(reply);
    setDraft(null);
    setSaved(`Saved: ${draft} ETH per credit, for lots that sell from now on.`);
    refresh();
  };

  const onUnlink = async (alias: string) => {
    setBusy(alias);
    const reply = await adminPost("/api/admin/unbind", password, { alias });
    setBusy(null);
    if (!reply.ok) return onFailure(reply);
    refresh();
  };

  return (
    <Panel className="mt-6 p-5 sm:p-6">
      <h2 className="text-base font-bold">Payments on Sepolia</h2>
      {!settings.data.enabled ? (
        <p className="mt-2 text-sm text-ink-2">
          Off. Sold lots aren&apos;t paid for. To switch on, add <code className="tabular">PAYMENTS=1</code> to <code>engine/.env</code> and restart the engine and the worker.
        </p>
      ) : (
        <p className="mt-2 text-sm text-ink-2">
          When a lot sells, the winning paddle&apos;s wallet pays the seller. The winner has {Math.round(settings.data.windowMs / 60_000)} min; after
          that, the lot stays with the seller.
        </p>
      )}

      <form onSubmit={onSave} className="mt-4 flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor={rateId} className="mb-1.5 block text-sm font-semibold">
            ETH per credit of the winning bid
          </label>
          <input
            id={rateId}
            inputMode="decimal"
            value={draft ?? current}
            onChange={(e) => setDraft(e.target.value)}
            className="tabular h-11 w-48 rounded-lg border border-line bg-surface-2 px-3 text-ink focus:border-cobalt focus:bg-surface focus:outline-none"
          />
        </div>
        <Button type="submit" variant="outline" disabled={draft === null || draft === current || busy !== null}>
          {busy === "rate" ? "Saving…" : "Save"}
        </Button>
        <p className="w-full text-sm text-ink-3">
          0 means the winner sends a 0 ETH payment and spends only gas. For example, 0.000001 makes a 296.99-credit lot cost 0.00029699 ETH.
        </p>
        {saved ? (
          <p role="status" className="w-full text-sm text-live">
            {saved}
          </p>
        ) : null}
      </form>

      <h3 className="mt-6 text-sm font-semibold">Paddle wallets</h3>
      <ul className="mt-2 divide-y divide-line rounded-lg border border-line">
        {PADDLE_ROSTER.map(({ alias }) => {
          const binding = bindings.data?.[alias];
          return (
            <li key={alias} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
              <span className="font-narrow tabular w-10 text-lg font-extrabold">{alias}</span>
              <span className="min-w-0 flex-1 text-ink-2">
                {binding ? (
                  <a className="tabular font-semibold text-cobalt hover:underline" href={addressUrl(binding.wallet)} target="_blank" rel="noreferrer">
                    {shortAddress(binding.wallet)}
                  </a>
                ) : (
                  "No wallet: tap the paddle's NFC sticker to link one"
                )}
                {binding?.locked ? " · locked (bid on the live lot, or owes a payment)" : ""}
              </span>
              {binding ? (
                <Button variant="quiet" size="sm" disabled={busy !== null || binding.locked} onClick={() => onUnlink(alias)}>
                  {busy === alias ? "Unlinking…" : "Unlink"}
                </Button>
              ) : null}
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}
