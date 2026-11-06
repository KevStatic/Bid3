"use client";

import { shortAddress } from "@/lib/format";
import { addressUrl, paymentSentence, txUrl, usePayment } from "@/lib/payments";

/**
 * Where a sold lot's Sepolia payment stands: waiting, paid (with the transaction on Etherscan), or not
 * paid, in which case the lot stays with the seller. Renders nothing for lots without a payment.
 */
export function PaymentStatus({ auctionId, className = "" }: { auctionId: string; className?: string }) {
  const { data: payment } = usePayment(auctionId);
  if (!payment) return null;
  const tone =
    payment.status === "PAID" ? "border-live/40 bg-live-soft" : payment.status === "UNPAID" ? "border-halt/40 bg-halt-soft" : "border-cobalt/40 bg-cobalt-soft";
  const link = "font-semibold text-cobalt hover:underline";

  return (
    <div className={`rounded-panel border px-4 py-3 text-sm ${tone} ${className}`} role="status" aria-live="polite">
      <p className="font-semibold">{paymentSentence(payment)}</p>
      <p className="mt-0.5 text-ink-2">
        {payment.payer ? (
          <>
            From{" "}
            <a className={`tabular ${link}`} href={addressUrl(payment.payer)} target="_blank" rel="noreferrer">
              {shortAddress(payment.payer)}
            </a>
          </>
        ) : (
          "No wallet linked yet"
        )}
        {payment.payee ? (
          <>
            {" "}
            to the seller{" "}
            <a className={`tabular ${link}`} href={addressUrl(payment.payee)} target="_blank" rel="noreferrer">
              {shortAddress(payment.payee)}
            </a>
          </>
        ) : null}
        {payment.txHash ? (
          <>
            {". "}
            <a className={link} href={txUrl(payment.txHash)} target="_blank" rel="noreferrer">
              See the transaction on Etherscan
            </a>
          </>
        ) : null}
      </p>
    </div>
  );
}
