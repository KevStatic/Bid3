/**
 * Bid3 Arkiv worker.
 *
 * Polls the engine's outbox and writes each record to Arkiv with the Bid3
 * publisher wallet, then tells the engine the entity key. The live auction
 * never waits on this: if Arkiv is slow or down, records queue in the engine
 * and the room shows "publication pending".
 */
import { config, isDryRun } from "./config.ts";
import { createWriter, type OutboxItem, type Written } from "./writer.ts";

const headers = { Authorization: `Bearer ${config.workerToken}`, "Content-Type": "application/json" };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const log = (...args: unknown[]) => console.log(new Date().toISOString(), ...args);

async function engine<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${config.engineUrl}${path}`, { ...init, headers });
  if (!response.ok) throw new Error(`engine ${path} answered ${response.status}: ${await response.text()}`);
  return (await response.json()) as T;
}

async function main() {
  const writer = isDryRun ? null : createWriter();
  log(
    isDryRun
      ? "DRY RUN: no ARKIV_PRIVATE_KEY, so nothing is written to Arkiv."
      : `Writing to Arkiv as ${writer!.owner}. Put this address in the web app's NEXT_PUBLIC_PUBLISHER_ADDRESS.`,
  );

  let failures = 0;
  for (;;) {
    let items: OutboxItem[];
    try {
      items = await engine<OutboxItem[]>("/outbox?limit=20");
    } catch (error) {
      log("engine unreachable:", (error as Error).message);
      await sleep(Math.min(10_000, config.pollMs * 2));
      continue;
    }
    if (items.length === 0) {
      await sleep(config.pollMs);
      continue;
    }

    for (const item of items) {
      try {
        let written: Written;
        if (writer) {
          written = await writer.write(item);
        } else {
          log(`would write ${item.kind} ${item.logicalId}`, JSON.stringify(item.payload));
          if (!config.dryRunAck) continue;
          written = { entityKey: `dryrun:${item.logicalId}`, txHash: null, reused: false };
        }
        await engine(`/outbox/${item.id}/published`, {
          method: "POST",
          body: JSON.stringify({ entityKey: written.entityKey, txHash: written.txHash }),
        });
        log(`${written.reused ? "found existing" : "wrote"} ${item.kind} ${item.logicalId} -> ${written.entityKey}`);
        failures = 0;
      } catch (error) {
        failures += 1;
        const message = (error as Error).message ?? String(error);
        log(`failed ${item.kind} ${item.logicalId}: ${message}`);
        await engine(`/outbox/${item.id}/failed`, { method: "POST", body: JSON.stringify({ error: message.slice(0, 480) }) }).catch(() => {});
        await sleep(Math.min(30_000, 1_000 * 2 ** Math.min(failures, 5)));
        break; // keep order: retry this record before later ones
      }
    }
    if (isDryRun && !config.dryRunAck) await sleep(config.pollMs * 4);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
