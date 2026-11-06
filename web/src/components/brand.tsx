import Image from "next/image";

/** The owner's final, transparent BID3 symbol. */
export function PaddleMark({ className = "size-11" }: { className?: string }) {
  return (
    <Image src="/brand/bid3-logo.png" width={44} height={44} sizes="44px" className={className} alt="" aria-hidden />
  );
}

export function Wordmark() {
  return (
    <span className="flex items-center">
      <PaddleMark className="-mr-0.5 size-11" />
      <span className="font-wide text-[1.35rem] font-extrabold tracking-[-0.03em]">Bid3</span>
    </span>
  );
}
