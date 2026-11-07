"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui";
import { clockTime, shortAddress } from "@/lib/format";
import {
  addressUrl,
  confirmPayment,
  connectedAccount,
  formatEth,
  hasBrowserWallet,
  linkMyWallet,
  onAccountsChanged,
  openInMetaMaskUrl,
  paymentTrace,
  SEPOLIA_FAUCET,
  sendPayment,
  txUrl,
  useBindings,
  usePayments,
  usePaymentSettings,
  type Payment,
} from "@/lib/payments";
import { useListingByAuction } from "@/lib/use-arkiv";

const noSubscribe = () => () => {};
const link = "font-semibold text-cobalt hover:underline";

/** Reopens this page inside MetaMask's browser, where the bidder's wallet is. */
const openInMetaMask = () => window.location.assign(openInMetaMaskUrl(window.location.pathname));

function Address({ wallet }: { wallet: string }) {
  return (
    <a className={`tabular ${link}`} href={addressUrl(wallet)} target="_blank" rel="noreferrer">
      {shortAddress(wallet)}
    </a>
  );
}

/**
 * The wallet behind this paddle. Tapping the paddle's NFC sticker opens this page on the bidder's phone.
 * The paddle pays from the bidder's own wallet: in MetaMask's browser, "Link my wallet" has the wallet
 * share its account and sign a short message (free), and the site saves exactly that address. Nothing
 * is typed in and no wallet is made up. A paddle keeps its wallet until the auctioneer unlinks it in
 * /admin, so another phone can't replace it by accident. If the paddle wins, that wallet pays the
 * seller from this page. Hidden when the engine has payments off.
 */
export function SeatWallet({ alias }: { alias: string }) {
  const queryClient = useQueryClient();
  const settings = usePaymentSettings();
  const bindings = useBindings();
  const payments = usePayments();
  const hasWallet = useSyncExternalStore(noSubscribe, hasBrowserWallet, () => false);
  const host = useSyncExternalStore(noSubscribe, () => window.location.host, () => "");
  const account = useQuery({ queryKey: ["wallet", "account"], enabled: hasWallet, queryFn: connectedAccount });
  useEffect(() => onAccountsChanged(() => void queryClient.invalidateQueries({ queryKey: ["wallet"] })), [queryClient]);

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [trace, setTrace] = useState<string[]>([]);
  const [sent, setSent] = useState<string | null>(null);

  const binding = bindings.data?.[alias];
  const linked = binding?.wallet.toLowerCase() ?? null;
  const here = account.data ?? null;
  const mine = !!linked && here === linked;
  const owed = (payments.data ?? []).filter((p) => p.winnerAlias === alias && p.status === "DUE");

  const run = async (label: string, action: () => Promise<unknown>) => {
    setBusy(label);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError((e as Error).message);
      setTrace(paymentTrace());
    } finally {
      setBusy(null);
      void queryClient.invalidateQueries({ queryKey: ["engine"] });
      void queryClient.invalidateQueries({ queryKey: ["wallet"] });
    }
  };

  const pay = (p: Payment) =>
    run(`pay:${p.auctionId}`, async () => {
      const txHash = await sendPayment(p);
      setSent(txHash);
      await confirmPayment(p.auctionId, txHash);
    });

  if (!settings.data?.enabled) return null;
  const rate = settings.data.weiPerCredit === "0" ? "0 ETH, so only gas" : `${formatEth(settings.data.weiPerCredit)} per credit of the winning bid`;

  return (
    <section className="mt-6 rounded-stage border border-line bg-surface p-6" aria-labelledby="seat-wallet">
      <h2 id="seat-wallet" className="text-xl font-bold">
        Paying for Paddle {alias}
      </h2>

      <p className="mt-3 text-ink-2">
        {!linked ? (
          <>
            Paddle {alias} has no wallet yet. Link yours: if the paddle wins, your wallet pays the seller ({rate}). Linking is free: your wallet signs a
            short message, with no gas.
          </>
        ) : mine ? (
          <>
            <span className="font-semibold text-live">Linked.</span> Paddle {alias} pays from this wallet, <Address wallet={linked} />. If it wins, you
            pay the seller from this page ({rate}).
          </>
        ) : (
          <>
            Paddle {alias} pays from <Address wallet={linked} />.
            {here ? (
              <>
                {" "}
                This wallet is <Address wallet={here} />: to link it instead, ask the auctioneer to unlink the paddle first.
              </>
            ) : null}
          </>
        )}
      </p>

      {!hasWallet && (!linked || owed.length > 0) ? (
        <>
          <Button className="mt-4" variant="paddle" onClick={openInMetaMask}>
            Open in MetaMask
          </Button>
          <p className="mt-2 text-sm text-ink-3">
            Your address comes from your wallet app, so linking and paying happen in MetaMask&apos;s browser. No MetaMask? Install it, then tap the sticker
            again.
          </p>
          {host ? (
            <p className="mt-2 text-sm text-ink-3">
              If MetaMask opens without this page: tap its Browser and go to{" "}
              <span className="tabular font-semibold text-ink-2">
                {host}/seat/{alias}
              </span>
              .
            </p>
          ) : null}
        </>
      ) : null}

      {hasWallet && !linked ? (
        <Button className="mt-4" variant="paddle" disabled={busy !== null} onClick={() => run("link", () => linkMyWallet(alias))}>
          {busy === "link" ? "Check your wallet…" : `Link my wallet to Paddle ${alias}`}
        </Button>
      ) : null}

      {binding?.locked ? <p className="mt-2 text-sm text-ink-3">Its wallet is locked for now: the paddle has bid on the live lot, or it owes a payment.</p> : null}

      {owed.map((p) => (
        <OwedPayment
          key={p.auctionId}
          payment={p}
          fromHere={!!here && p.payer?.toLowerCase() === here}
          paying={busy === `pay:${p.auctionId}`}
          disabled={busy !== null}
          onPay={hasWallet ? () => pay(p) : openInMetaMask}
          inWallet={hasWallet}
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
    </section>
  );
}

function OwedPayment({
  payment,
  fromHere,
  paying,
  disabled,
  onPay,
  inWallet,
}: {
  payment: Payment;
  fromHere: boolean;
  paying: boolean;
  disabled: boolean;
  onPay: () => void;
  inWallet: boolean;
}) {
  const { data: lot } = useListingByAuction(payment.auctionId);

  return (
    <div className="mt-5 rounded-panel border border-paddle bg-paddle-soft p-4">
      <p className="font-semibold">
        Paddle {payment.winnerAlias} won {lot ? lot.title : payment.auctionId}. It pays the seller {formatEth(payment.amountWei)} on Sepolia.
      </p>
      <p className="mt-1 text-sm text-ink-2">
        {payment.payer ? (
          <>
            From <Address wallet={payment.payer} />
            {inWallet && !fromHere ? ": switch MetaMask to that account to pay." : "."}
          </>
        ) : (
          "Link a wallet above, then pay."
        )}{" "}
        Due by {clockTime(payment.dueByMs)}, or the lot stays with the seller.
      </p>
      {payment.payer ? (
        <Button className="mt-3" variant={fromHere || !inWallet ? "paddle" : "outline"} disabled={disabled} onClick={onPay}>
          {paying ? "Check your wallet…" : inWallet ? "Pay with MetaMask" : "Open in MetaMask to pay"}
        </Button>
      ) : null}
    </div>
  );
}
