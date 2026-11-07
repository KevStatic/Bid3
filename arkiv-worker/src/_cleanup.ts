import { createPublicClient, createWalletClient } from "@arkiv-network/sdk";
import { rabdi } from "@arkiv-network/sdk/chains";
import { http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { config } from "./config.ts";
import { ItemListing } from "./schemas.ts";
const DELETE = new Set(["bid3-cat-11", "bid3-cat-12", "bid3-cat-13", "bid3-cat-14", "bid3-cat-15", "bid3-cat-16"]);
const CLOSED = new Set(["SOLD_LOCKED", "UNSOLD", "CANCELLED"]);
const account = privateKeyToAccount(config.privateKey!);
const chain = rabdi({ accessKey: config.accessKey });
const reader = createPublicClient({ chain, transport: http() });
const wallet = createWalletClient({ chain, transport: http(), account });
const v = (x: any) => (x && typeof x === "object" && "value" in x ? x.value : x);
const phases = new Map(((await (await fetch(`${config.engineUrl}/auctions`)).json()) as any[]).map((l) => [l.auctionId, l.phase]));
const page = await reader.select().from(ItemListing).ownedBy(account.address).limit(100).fetch();
for (const e of page.entities as any[]) {
  const id = String(v(e.auctionId));
  if (!DELETE.has(id)) continue;
  if (!CLOSED.has(String(phases.get(id)))) { console.log("kept (not finished)", id, phases.get(id)); continue; }
  const { txHash } = await wallet.deleteEntity({ entityKey: e.$key });
  console.log("deleted", id, String(v(e.title)), "tx", txHash.slice(0, 12));
}
