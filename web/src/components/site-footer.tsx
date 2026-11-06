import Link from "next/link";
import { config, isSampleArkiv, isSimulation } from "@/lib/config";
import { PaddleMark } from "./brand";

export function SiteFooter() {
  return (
    <footer className="mt-24 border-t border-line">
      <div className="mx-auto grid w-full max-w-[76rem] gap-8 px-4 py-10 text-sm text-ink-2 sm:px-6 md:grid-cols-[1.4fr_1fr_1fr] lg:px-8">
        <div className="flex items-start gap-3">
          <PaddleMark className="size-9 shrink-0" />
          <p className="max-w-sm">
            Bid3 runs live auctions from physical paddles. Listings, bids and hammer prices are public Arkiv entities, readable
            without our server.
          </p>
        </div>
        <ul className="flex flex-col gap-2">
          <li>
            <Link className="hover:text-ink" href="/catalogue">
              Browse lots
            </Link>
          </li>
          <li>
            <Link className="hover:text-ink" href="/explorer">
              Check a result
            </Link>
          </li>
          <li>
            <Link className="hover:text-ink" href="/seller">
              Sell an item
            </Link>
          </li>
        </ul>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
          <dt className="text-ink-3">Bidding feed</dt>
          <dd>{isSimulation ? "Simulation" : "Bid3 engine"}</dd>
          <dt className="text-ink-3">Arkiv data</dt>
          <dd>{isSampleArkiv ? "Sample entities" : "Arkiv testnet"}</dd>
          <dt className="text-ink-3">Network</dt>
          <dd>
            <a className="hover:text-ink" href={config.arkivExplorerUrl} target="_blank" rel="noreferrer">
              Rabdi, chain {config.arkivChainId}
            </a>
          </dd>
        </dl>
      </div>
    </footer>
  );
}
