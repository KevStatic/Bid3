"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useState, useSyncExternalStore } from "react";
import { Button, buttonClass } from "@/components/ui";
import { clockTime, shortAddress } from "@/lib/format";
import {
  addressUrl,
  confirmPayment,
  formatEth,
  hasBrowserWallet,
  linkMyWallet,
  openInMetaMaskUrl,
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

/**
 * The wallet behind this paddle. Tapping the paddle's NFC sticker opens this page: the bidder links
 * their wallet with a signature (no gas), and if the paddle wins, pays the seller on Sepolia from here.
 * Hidden when the engine has payments off.
 */
export function SeatWallet({ alias }: { alias: string }) {
  const queryClient = useQueryClient();
  const settings = usePaymentSettings();
  const bindings = useBindings();
  const payments = usePayments();
  const walletHere = useSyncExternalStore(noSubscribe, hasBrowserWallet, () => false);
  const [busy, setBusy] = useState<"link" | "pay" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<{ auctionId: string; txHash: string } | null>(null);

  if (!settings.data?.enabled) return null;

  const binding = bindings.data?.[alias];
  const owed = (payments.data ?? []).filter((p) => p.winnerAlias === alias && p.status === "DUE");
  const rate = settings.data.weiPerCredit === "0" ? "0 ETH, so only gas" : `${formatEth(settings.data.weiPerCredit)} per credit of the winning bid`;
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["engine"] });

  const onLink = async () => {
    setBusy("link");
    setError(null);
    try {
      await linkMyWallet(alias);
      refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const onPay = async (payment: Payment) => {
    setBusy("pay");
    setError(null);
    try {
      const txHash = await sendPayment(payment);
      setSent({ auctionId: payment.auctionId, txHash });
      await confirmPayment(payment.auctionId, txHash);
      refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="mt-6 rounded-stage border border-line bg-surface p-6" aria-labelledby="seat-wallet">
      <h2 id="seat-wallet" className="text-xl font-bold">
        Paying for Paddle {alias}
      </h2>
      <p className="mt-2 text-ink-2">
        {binding ? (
          <>
            Paddle {alias} pays from{" "}
            <a className={`tabular ${link}`} href={addressUrl(binding.wallet)} target="_blank" rel="noreferrer">
              {shortAddress(binding.wallet)}
            </a>
            . If it wins, that wallet pays the seller on Sepolia: {rate}.
          </>
        ) : (
          <>Link your wallet, and if Paddle {alias} wins, it pays the seller on Sepolia: {rate}. Linking is only a signature, so it&apos;s free.</>
        )}
      </p>

      {owed.map((p) => (
        <OwedPayment key={p.auctionId} payment={p} busy={busy !== null} onPay={() => onPay(p)} walletHere={walletHere} />
      ))}

      <div className="mt-5 flex flex-wrap items-center gap-3">
        {walletHere ? (
          <Button variant={binding ? "outline" : "paddle"} disabled={busy !== null || !!binding?.locked} onClick={onLink}>
            {busy === "link" ? "Check your wallet…" : binding ? "Use my wallet instead" : "Link my wallet"}
          </Button>
        ) : (
          <a href={openInMetaMaskUrl(`/seat/${encodeURIComponent(alias)}`)} className={buttonClass("paddle", "md")}>
            {owed.some((p) => p.payer) ? "Open in MetaMask to pay" : "Open in MetaMask to link a wallet"}
          </a>
        )}
      </div>
      {binding?.locked ? (
        <p className="mt-2 text-sm text-ink-3">This paddle&apos;s wallet is locked: it has bid on the live lot, or it owes a payment.</p>
      ) : null}

      {sent ? (
        <p className="mt-4 text-sm text-ink-2" role="status">
          {busy === "pay" ? "Sent. Waiting for Sepolia to confirm it (about 15 s)… " : "Payment sent. "}
          <a className={link} href={txUrl(sent.txHash)} target="_blank" rel="noreferrer">
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
    </section>
  );
}

function OwedPayment({ payment, busy, onPay, walletHere }: { payment: Payment; busy: boolean; onPay: () => void; walletHere: boolean }) {
  const { data: lot } = useListingByAuction(payment.auctionId);
  return (
    <div className="mt-5 rounded-panel border border-paddle bg-paddle-soft p-4">
      <p className="font-semibold">
        Paddle {payment.winnerAlias} won {lot ? lot.title : payment.auctionId}. Pay the seller {formatEth(payment.amountWei)} on Sepolia.
      </p>
      <p className="mt-1 text-sm text-ink-2">
        {payment.payer ? `From ${shortAddress(payment.payer)}. ` : "Link a wallet below first. "}
        Pay by {clockTime(payment.dueByMs)}, or the lot stays with the seller. Gas comes from your Sepolia ETH (
        <a className={link} href={SEPOLIA_FAUCET} target="_blank" rel="noreferrer">
          free faucet
        </a>
        ).
      </p>
      {walletHere && payment.payer ? (
        <Button className="mt-3" variant="paddle" disabled={busy} onClick={onPay}>
          {busy ? "Working…" : "Pay now"}
        </Button>
      ) : null}
    </div>
  );
}
