# Reach

> **TODO (Kev):** everything marked TODO needs a real answer from the team. Don't leave a guess in.

## Who is it for, and would they use it?

**Organisers of small, in-person auctions:**
- charity and fundraiser auctions
- college fests
- meetups and hackathons auctioning swag
- collector meet-ups

Today that's a paper paddle and the auctioneer's word. They need two things:
- **Fast, obvious bidding.** Press a button, no app or wallet for the bidder.
- **A result people can check later.** Donors, sellers and losing bidders can see that the hammer price came from real bids, under rules fixed before the round, without asking the organiser.

> **TODO (Kev): evidence that they'd use it.** For example: how many people used the paddles at Mumbai, a quote from someone who runs auctions, an organiser who wants to try it. Leave this out rather than invent it.

## Can they try it today?

| Way in | What they need | Link |
|---|---|---|
| Watch a round and check results | A browser | **TODO (Kev):** live URL |
| Run a round with no hardware | A browser (labelled simulation) | **TODO (Kev):** live URL `/room/...` |
| Check every result themselves, without our app | Node.js | `cd arkiv-worker && npm install && npm run query-results -- <publisher address>` (see the [README](../README.md#arkiv)) |
| Run a real round | Two Bid3 tags, the gateway, a laptop | [README: run it locally](../README.md#run-it-locally) |

## Numbers

> **TODO (Kev):** fill in after the live rounds, with a query anyone can rerun:
> - rounds run on testnet: __
> - `AuctionBid` entities written: __
> - `AuctionResult` entities written: __
> - median press-to-acknowledgement on real hardware: __ ms

## Will we keep building it after Mumbai?

> **TODO (team):** answer honestly, with something concrete: a next event to run it at, the next feature, who owns it. Possible next steps from where the code stands:
> - seller sign-in, and "open the round" from the seller page without an operator
> - a "keep this result longer" button using permissionless extension
> - signed paddle presses (the engine already supports secp256k1 intents; the firmware doesn't sign yet)
