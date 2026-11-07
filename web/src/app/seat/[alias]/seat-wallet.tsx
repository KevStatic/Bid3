"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useEffectEvent, useState, useSyncExternalStore } from "react";
import { formatEther, type Hex } from "viem";
import { Button } from "@/components/ui";
import { clockTime, shortAddress } from "@/lib/format";
import {
  addressUrl,
  confirmPayment,
  formatEth,
  hasBrowserWallet,
  linkMyWallet,
  paymentTrace,
  SEPOLIA_FAUCET,
  sendPayment,
  txUrl,
  useBindings,
  usePayments,
  usePaymentSettings,
  type Payment,
} from "@/lib/payments";
import { confirmPhonePayment, linkPhoneWallet, payFromPhone, phoneBalance, phoneWallet, sentFor } from "@/lib/phone-wallet";
import { useListingByAuction } from "@/lib/use-arkiv";

const noSubscribe = () => () => {};
const link = "font-semibold text-cobalt hover:underline";

let cachedPhone: string | null | undefined;
/** This browser's phone wallet address (created on first read), lowercase. */
const phoneAddress = () => {
  if (cachedPhone === undefined) cachedPhone = phoneWallet()?.address.toLowerCase() ?? null;
  return cachedPhone;
};

/** Auction ids this page has already tried to pay automatically (once per lot per page load). */
const autoPaid = new Set<string>();

/**
 * The wallet behind this paddle. Tapping the paddle's NFC sticker opens this page in the phone's
 * browser. The page has its own Sepolia wallet ("this phone's wallet"): one tap links it to the paddle,
 * and if the paddle wins, it pays the seller by itself, with no wallet app and nothing to confirm.
 * MetaMask stays available as a fallback. Hidden when the engine has payments off.
 */
export function SeatWallet({ alias }: { alias: string }) {
  const queryClient = useQueryClient();
  const settings = usePaymentSettings();
  const bindings = useBindings();
  const payments = usePayments();
  const phone = useSyncExternalStore(noSubscribe, phoneAddress, () => null);
  const browserWallet = useSyncExternalStore(noSubscribe, hasBrowserWallet, () => false);
  const balance = useQuery({
    queryKey: ["sepolia", "balance", phone],
    enabled: !!phone,
    refetchInterval: 10_000,
    queryFn: () => phoneBalance(phone as Hex),
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [trace, setTrace] = useState<string[]>([]);
  const [sent, setSent] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const binding = bindings.data?.[alias];
  const linkedHere = !!phone && binding?.wallet.toLowerCase() === phone;
  const owed = (payments.data ?? []).filter((p) => p.winnerAlias === alias && p.status === "DUE");
  const dueHere = owed.find((p) => !!phone && p.payer?.toLowerCase() === phone);
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["engine"] });
    void queryClient.invalidateQueries({ queryKey: ["sepolia"] });
  };

  const run = async (label: string, action: () => Promise<unknown>) => {
    setBusy(label);
    setError(null);
    try {
      await action();
      refresh();
    } catch (e) {
      setError((e as Error).message);
      setTrace(paymentTrace());
    } finally {
      setBusy(null);
    }
  };

  const payHere = (p: Payment) =>
    run(`pay:${p.auctionId}`, async () => {
      const txHash = await payFromPhone(p);
      setSent(txHash);
      await confirmPhonePayment(p.auctionId, txHash);
    });

  // When the hammer falls on this paddle, this phone pays by itself (once per lot; payFromPhone never pays twice).
  const autoPay = useEffectEvent((p: Payment) => {
    if (autoPaid.has(p.auctionId) || busy) return;
    autoPaid.add(p.auctionId);
    void payHere(p);
  });
  const dueId = dueHere?.auctionId;
  useEffect(() => {
    if (!dueHere) return;
    const timer = setTimeout(() => autoPay(dueHere), 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once per lot that becomes due here
  }, [dueId]);

  if (!settings.data?.enabled) return null;

  const rate = settings.data.weiPerCredit === "0" ? "0 ETH, so only gas" : `${formatEth(settings.data.weiPerCredit)} per credit of the winning bid`;
  const empty = balance.data === 0n;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(phone ?? "");
      setCopied(true);
      setTimeout(() => setCopied(false), 2_000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <section className="mt-6 rounded-stage border border-line bg-surface p-6" aria-labelledby="seat-wallet">
      <h2 id="seat-wallet" className="text-xl font-bold">
        Paying for Paddle {alias}
      </h2>

      {phone ? (
        <div className="mt-3 rounded-panel border border-line bg-surface-2 p-4">
          <p className="text-sm font-semibold text-ink-2">This phone&apos;s wallet (Sepolia)</p>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
            <a className={`tabular ${link}`} href={addressUrl(phone)} target="_blank" rel="noreferrer">
              {shortAddress(phone)}
            </a>
            <span className="tabular text-sm text-ink-2">{balance.data === undefined ? "…" : `${formatEther(balance.data)} ETH`}</span>
            <Button variant="quiet" size="sm" onClick={copy}>
              {copied ? "Copied" : "Copy address"}
            </Button>
          </div>
          {empty ? (
            <p className="mt-2 text-sm text-ink-2">
              It needs a little Sepolia ETH for gas (0.01 is plenty). Send some to this address from any wallet, or use the{" "}
              <a className={link} href={SEPOLIA_FAUCET} target="_blank" rel="noreferrer">
                free faucet
              </a>
              .
            </p>
          ) : null}
        </div>
      ) : (
        <p className="mt-3 text-ink-2">This browser can&apos;t keep a wallet (private browsing?). Open the page in a normal tab.</p>
      )}

      <p className="mt-4 text-ink-2">
        {linkedHere ? (
          <>
            <span className="font-semibold text-live">Linked.</span> Paddle {alias} pays from this phone. If it wins, the seller is paid automatically: {rate}.
          </>
        ) : binding ? (
          <>
            Paddle {alias} pays from another wallet,{" "}
            <a className={`tabular ${link}`} href={addressUrl(binding.wallet)} target="_blank" rel="noreferrer">
              {shortAddress(binding.wallet)}
            </a>
            .
          </>
        ) : (
          <>Link this phone to Paddle {alias}. If it wins, this phone pays the seller automatically: {rate}. Linking is free.</>
        )}
      </p>

      {phone && !linkedHere ? (
        <Button className="mt-4" variant="paddle" disabled={busy !== null || !!binding?.locked} onClick={() => run("link", () => linkPhoneWallet(alias))}>
          {busy === "link" ? "Linking…" : `Link this phone to Paddle ${alias}`}
        </Button>
      ) : null}
      {binding?.locked && !linkedHere ? (
        <p className="mt-2 text-sm text-ink-3">Its wallet is locked for now: the paddle has bid on the live lot, or it owes a payment.</p>
      ) : null}

      {owed.map((p) => (
        <OwedPayment
          key={p.auctionId}
          payment={p}
          phone={phone}
          busy={busy}
          onPayHere={() => payHere(p)}
          onPayMetaMask={
            browserWallet
              ? () =>
                  run(`pay:${p.auctionId}`, async () => {
                    const txHash = await sendPayment(p);
                    setSent(txHash);
                    await confirmPayment(p.auctionId, txHash);
                  })
              : null
          }
        />
      ))}

      {sent ? (
        <p className="mt-4 text-sm text-ink-2" role="status">
          {busy?.startsWith("pay:") ? "Payment sent. Waiting for Sepolia to confirm it (about 15 s)… " : "Payment sent. "}
          <a className={link} href={txUrl(sent)} target="_blank" rel="noreferrer">
            See it on Etherscan
          </a>
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-4 text-sm text-halt">
          {error}{" "}
          {/sepolia eth/i.test(error) ? (
            <a className={link} href={SEPOLIA_FAUCET} target="_blank" rel="noreferrer">
              Sepolia faucet
            </a>
          ) : null}
        </p>
      ) : null}
      {error && trace.length ? (
        <details className="mt-2 text-xs text-ink-3">
          <summary className="cursor-pointer">What happened, step by step</summary>
          <pre className="mt-2 whitespace-pre-wrap break-all font-mono">{trace.join("\n")}</pre>
        </details>
      ) : null}

      {browserWallet && !linkedHere ? (
        <details className="mt-6 text-sm text-ink-3">
          <summary className="cursor-pointer">Use the wallet app in this browser instead (MetaMask)</summary>
          <p className="mt-2">Less reliable on phones: the wallet app has to approve each step.</p>
          <Button className="mt-2" variant="outline" size="sm" disabled={busy !== null || !!binding?.locked} onClick={() => run("link-mm", () => linkMyWallet(alias))}>
            {busy === "link-mm" ? "Check your wallet…" : "Link my MetaMask wallet"}
          </Button>
        </details>
      ) : null}
    </section>
  );
}

function OwedPayment({
  payment,
  phone,
  busy,
  onPayHere,
  onPayMetaMask,
}: {
  payment: Payment;
  phone: string | null;
  busy: string | null;
  onPayHere: () => void;
  onPayMetaMask: (() => void) | null;
}) {
  const { data: lot } = useListingByAuction(payment.auctionId);
  const fromHere = !!phone && payment.payer?.toLowerCase() === phone;
  const paying = busy === `pay:${payment.auctionId}`;
  const signed = fromHere ? sentFor(payment.auctionId) : null;

  return (
    <div className="mt-5 rounded-panel border border-paddle bg-paddle-soft p-4">
      <p className="font-semibold">
        Paddle {payment.winnerAlias} won {lot ? lot.title : payment.auctionId}. It pays the seller {formatEth(payment.amountWei)} on Sepolia.
      </p>
      <p className="mt-1 text-sm text-ink-2">
        {fromHere
          ? paying
            ? "Paying from this phone now…"
            : signed
              ? "Sent from this phone. Waiting for the site to confirm it."
              : "This phone pays it automatically."
          : payment.payer
            ? `It's paid from ${shortAddress(payment.payer)}.`
            : "Link a wallet above and it pays straight away."}{" "}
        Due by {clockTime(payment.dueByMs)}, or the lot stays with the seller.
      </p>
      {fromHere && !paying ? (
        <Button className="mt-3" variant="paddle" disabled={busy !== null} onClick={onPayHere}>
          {signed ? "Check the payment again" : "Pay now"}
        </Button>
      ) : null}
      {!fromHere && payment.payer && onPayMetaMask ? (
        <Button className="mt-3" variant="outline" disabled={busy !== null} onClick={onPayMetaMask}>
          {paying ? "Check your wallet…" : "Pay with MetaMask"}
        </Button>
      ) : null}
    </div>
  );
}
