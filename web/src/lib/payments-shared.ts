/**
 * Paddle wallets and Sepolia payments: the parts the browser and the server routes share.
 *
 * A bidder taps a paddle's NFC sticker, which opens /seat/<alias>, and links their wallet to that paddle
 * by signing BIND_MESSAGE (no gas). When the paddle wins a lot, that wallet pays the seller on Sepolia:
 * `amountWei` (0 at the default rate, so only gas) with the lot's memo as the transaction data.
 * The engine (engine/bid3_engine/payments.py) is the record of who owes what.
 */

export const SEPOLIA = { id: 11155111, hexId: "0xaa36a7", name: "Sepolia", explorer: "https://sepolia.etherscan.io" } as const;

/** A signed link is accepted for this long after it was made. */
export const BIND_MAX_AGE_MS = 10 * 60 * 1000;

/** The exact text a wallet signs to link itself to a paddle. The server rebuilds it to check the signature. */
export function bindMessage(alias: string, wallet: string, issuedAtMs: number): string {
  return `Bid3: pay for Paddle ${alias} with this wallet.\nIf Paddle ${alias} wins a lot, this wallet pays the seller on Sepolia.\nWallet: ${wallet.toLowerCase()}\nIssued: ${issuedAtMs}`;
}

export type PaymentStatus = "DUE" | "PAID" | "UNPAID";

/** The engine's view of one sold lot's payment (GET /auctions/{id}/payment). */
export interface Payment {
  auctionId: string;
  epoch: number;
  winnerAlias: string;
  hammerPriceMinor: number;
  payer: string | null;
  payee: string | null;
  amountWei: string;
  chainId: number;
  memo: string;
  status: PaymentStatus;
  reason: string | null;
  txHash: string | null;
  dueByMs: number;
  createdAtMs: number;
  settledAtMs: number | null;
}

export interface Binding {
  wallet: string;
  boundAtMs: number;
  locked: boolean;
}

export interface PaymentSettings {
  enabled: boolean;
  weiPerCredit: string;
  windowMs: number;
  chainId: number;
}

export const txUrl = (txHash: string) => `${SEPOLIA.explorer}/tx/${txHash}`;
export const addressUrl = (address: string) => `${SEPOLIA.explorer}/address/${address}`;
