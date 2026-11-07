/**
 * Sepolia gas station: keeps every wallet linked to a paddle (GET /bindings) topped up with a little
 * Sepolia ETH, so a phone wallet can pay the seller without anyone funding it by hand.
 *
 * Off unless GAS_STATION_KEY is set (a testnet-only key in arkiv-worker/.env; fund its address once).
 * Runs beside the outbox loop and never touches it: any error here is logged and retried.
 *
 *   GAS_MIN_ETH              top up below this balance           (default 0.002)
 *   GAS_TOPUP_ETH            amount sent per top-up               (default 0.005)
 *   GAS_MAX_TOPUPS_PER_HOUR  cap, in case many wallets get linked (default 12)
 */
import { createPublicClient, createWalletClient, fallback, formatEther, http, parseEther, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { config } from "./config.ts";

type Log = (...args: unknown[]) => void;

export function startGasStation(log: Log): void {
  const key = process.env.GAS_STATION_KEY;
  if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) {
    log("Gas station off (no GAS_STATION_KEY): paddle wallets need Sepolia ETH sent by hand.");
    return;
  }
  const min = parseEther(process.env.GAS_MIN_ETH ?? "0.002");
  const topUp = parseEther(process.env.GAS_TOPUP_ETH ?? "0.005");
  const maxPerHour = Number(process.env.GAS_MAX_TOPUPS_PER_HOUR ?? 12);

  const account = privateKeyToAccount(key as Hex);
  const transport = fallback([
    http(process.env.SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com", { timeout: 10_000 }),
    http("https://sepolia.drpc.org", { timeout: 10_000 }),
  ]);
  const reader = createPublicClient({ chain: sepolia, transport });
  const wallet = createWalletClient({ account, chain: sepolia, transport });
  const lastTopUp = new Map<string, number>();
  const sentAt: number[] = [];
  let lastWarning = 0;
  const warn = (...args: unknown[]) => {
    if (Date.now() - lastWarning < 60_000) return;
    lastWarning = Date.now();
    log(...args);
  };

  log(`Gas station on: tops up paddle wallets below ${formatEther(min)} Sepolia ETH with ${formatEther(topUp)}, from ${account.address}.`);

  const tick = async () => {
    const response = await fetch(`${config.engineUrl}/bindings`);
    if (!response.ok) return;
    const bindings = (await response.json()) as Record<string, { wallet: string }>;
    for (const [alias, binding] of Object.entries(bindings)) {
      const target = binding.wallet.toLowerCase() as Hex;
      if (Date.now() - (lastTopUp.get(target) ?? 0) < 3 * 60_000) continue; // let the last top-up land first
      if ((await reader.getBalance({ address: target })) >= min) continue;
      while (sentAt.length && sentAt[0] < Date.now() - 3_600_000) sentAt.shift();
      if (sentAt.length >= maxPerHour) {
        warn(`Gas station: ${maxPerHour} top-ups this hour, so Paddle ${alias}'s wallet waits.`);
        continue;
      }
      const own = await reader.getBalance({ address: account.address });
      if (own < topUp * 2n) {
        warn(`Gas station is low (${formatEther(own)} Sepolia ETH). Send some to ${account.address}.`);
        return;
      }
      lastTopUp.set(target, Date.now());
      sentAt.push(Date.now());
      const hash = await wallet.sendTransaction({ to: target, value: topUp });
      log(`Gas station: sent ${formatEther(topUp)} Sepolia ETH to Paddle ${alias}'s wallet ${target} (tx ${hash}).`);
    }
  };

  void (async () => {
    for (;;) {
      try {
        await tick();
      } catch (error) {
        warn("Gas station error:", String((error as Error).message ?? error).split("\n")[0]);
      }
      await new Promise((r) => setTimeout(r, 5_000));
    }
  })();
}
