"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useAccount, useConnect, useDisconnect } from "wagmi";
import { shortAddress } from "@/lib/format";
import { Button } from "./ui";

const subscribeNoop = () => () => {};

/** True only after hydration, so wallet state never mismatches the server render. */
function useHydrated() {
  return useSyncExternalStore(subscribeNoop, () => true, () => false);
}

export function WalletButton({ size = "sm" }: { size?: "sm" | "md" }) {
  const hydrated = useHydrated();
  const { address, isConnected, chain } = useAccount();
  const { connect, connectors, isPending, error } = useConnect();
  const { disconnect } = useDisconnect();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!hydrated) {
    return (
      <Button variant="outline" size={size} disabled>
        Connect wallet
      </Button>
    );
  }

  if (!isConnected || !address) {
    const injectedConnector = connectors[0];
    return (
      <div className="flex flex-col items-end">
        <Button
          variant="outline"
          size={size}
          disabled={isPending || !injectedConnector}
          onClick={() => injectedConnector && connect({ connector: injectedConnector })}
        >
          {isPending ? "Waiting for wallet…" : "Connect wallet"}
        </Button>
        {error ? (
          <span role="alert" className="mt-1 max-w-56 text-right text-xs text-halt">
            {error.message.includes("Provider not found") ? "No browser wallet found. Install one, then try again." : error.message}
          </span>
        ) : null}
      </div>
    );
  }

  return (
    <div className="relative" ref={menuRef}>
      <Button variant="outline" size={size} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span className="size-2 rounded-full bg-live" aria-hidden />
        <span className="tabular">{shortAddress(address)}</span>
      </Button>
      {open ? (
        <div role="menu" className="absolute right-0 z-30 mt-2 w-64 rounded-panel border border-line bg-surface p-3 shadow-lift">
          <p className="text-xs text-ink-3">Connected to</p>
          <p className="text-sm font-semibold">{chain?.name ?? "Unsupported network"}</p>
          <p className="tabular mt-2 break-all text-xs text-ink-2">{address}</p>
          <Button
            role="menuitem"
            variant="quiet"
            size="sm"
            className="mt-3 w-full justify-start"
            onClick={() => {
              disconnect();
              setOpen(false);
            }}
          >
            Disconnect
          </Button>
        </div>
      ) : null}
    </div>
  );
}
