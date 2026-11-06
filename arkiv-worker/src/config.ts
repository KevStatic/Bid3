import { isHex, type Hex } from "viem";

/** Worker settings, from environment variables. */
export const config = {
  engineUrl: (process.env.ENGINE_URL ?? "http://localhost:8000").replace(/\/+$/, ""),
  workerToken: process.env.WORKER_TOKEN ?? "",
  /** The Bid3 publisher wallet's private key. Without it the worker runs dry and writes nothing. */
  privateKey: process.env.ARKIV_PRIVATE_KEY && isHex(process.env.ARKIV_PRIVATE_KEY) ? (process.env.ARKIV_PRIVATE_KEY as Hex) : undefined,
  accessKey: process.env.ARKIV_ACCESS_KEY ?? "",
  pollMs: Number(process.env.POLL_MS ?? 1500),
  /** Testing only: in dry runs, report fake keys back to the engine so the outbox empties. */
  dryRunAck: process.env.DRY_RUN_ACK === "1",
};

export const isDryRun = !config.privateKey;
