"use client";

import { useState } from "react";

/** Shows the Arkiv query behind a page, with a copy button. */
export function QueryDisclosure({ query, label = "Show the Arkiv query" }: { query: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <details className="group rounded-panel border border-line bg-surface">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-semibold text-ink-2 hover:text-ink">
        {label}
        <svg viewBox="0 0 16 16" className="size-4 transition-transform group-open:rotate-180" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
          <path d="M4 6l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </summary>
      <div className="border-t border-line px-4 py-3">
        <pre className="overflow-x-auto text-[0.8125rem] leading-relaxed text-ink">
          <code>{query}</code>
        </pre>
        <button
          type="button"
          className="mt-3 text-sm font-semibold text-cobalt hover:underline"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(query);
              setCopied(true);
              setTimeout(() => setCopied(false), 1_600);
            } catch {
              setCopied(false);
            }
          }}
        >
          {copied ? "Copied" : "Copy query"}
        </button>
      </div>
    </details>
  );
}
