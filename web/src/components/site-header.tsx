"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, useState } from "react";
import { Wordmark } from "./brand";
import { WalletButton } from "./wallet-button";

const NAV = [
  { href: "/room", match: "/room", label: "Live room" },
  { href: "/catalogue", match: "/catalogue", label: "Lots" },
  { href: "/explorer", match: "/explorer", label: "Results" },
  { href: "/seller", match: "/seller", label: "Sell an item" },
];

const isActive = (pathname: string | null, match: string) =>
  !!pathname && (pathname === match || pathname.startsWith(`${match}/`) || (match === "/catalogue" && pathname.startsWith("/auction")));

/** The link list; `pathname` is null in the prerendered shell, before URL data streams in. */
function NavItems({ pathname, variant, onNavigate }: { pathname: string | null; variant: "bar" | "sheet"; onNavigate?: () => void }) {
  if (variant === "sheet") {
    return (
      <ul className="flex flex-col">
        {NAV.map((item) => (
          <li key={item.href}>
            <Link
              href={item.href}
              onClick={onNavigate}
              aria-current={isActive(pathname, item.match) ? "page" : undefined}
              className="flex h-12 items-center border-b border-line text-base font-medium text-ink-2 aria-[current=page]:text-ink"
            >
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    );
  }
  return (
    <>
      {NAV.map((item) => {
        const active = isActive(pathname, item.match);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className="relative rounded-md px-3 py-2 text-[0.9375rem] font-medium text-ink-2 transition-colors hover:text-ink aria-[current=page]:text-ink"
          >
            {item.label}
            {active ? <span className="absolute inset-x-3 -bottom-[13px] h-[3px] rounded-full bg-paddle" aria-hidden /> : null}
          </Link>
        );
      })}
    </>
  );
}

function ActiveNavItems(props: { variant: "bar" | "sheet"; onNavigate?: () => void }) {
  const pathname = usePathname();
  return <NavItems pathname={pathname} {...props} />;
}

export function SiteHeader() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-wall/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 w-full max-w-[76rem] items-center gap-6 px-4 sm:px-6 lg:px-8">
        <Link href="/" className="shrink-0 rounded-md" aria-label="Bid3 home">
          <Wordmark />
        </Link>

        <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
          <Suspense fallback={<NavItems pathname={null} variant="bar" />}>
            <ActiveNavItems variant="bar" />
          </Suspense>
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <div className="hidden sm:block">
            <WalletButton />
          </div>
          <button
            type="button"
            className="inline-flex size-10 items-center justify-center rounded-lg text-ink hover:bg-surface-2 md:hidden"
            aria-expanded={menuOpen}
            aria-controls="mobile-nav"
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            onClick={() => setMenuOpen((v) => !v)}
          >
            <svg viewBox="0 0 20 20" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
              {menuOpen ? <path d="M5 5l10 10M15 5L5 15" /> : <path d="M3 6h14M3 10h14M3 14h14" />}
            </svg>
          </button>
        </div>
      </div>

      {menuOpen ? (
        <nav id="mobile-nav" aria-label="Main" className="border-t border-line bg-wall px-4 pb-4 pt-2 md:hidden">
          <Suspense fallback={<NavItems pathname={null} variant="sheet" />}>
            <ActiveNavItems variant="sheet" onNavigate={() => setMenuOpen(false)} />
          </Suspense>
          <div className="mt-4">
            <WalletButton size="md" />
          </div>
        </nav>
      ) : null}
    </header>
  );
}
