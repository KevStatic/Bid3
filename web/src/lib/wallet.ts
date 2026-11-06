import { rabdi } from "@arkiv-network/sdk/chains";
import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors/injected";
import { config } from "./config";

/**
 * Sellers sign their own ItemListing writes, so the wallet connects to the
 * Arkiv testnet (Rabdi). The publisher key never reaches the browser.
 */
export const arkivChain = rabdi({ accessKey: config.arkivAccessKey });

export const wagmiConfig = createConfig({
  chains: [arkivChain],
  connectors: [injected()],
  transports: { [arkivChain.id]: http() },
  ssr: true,
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
