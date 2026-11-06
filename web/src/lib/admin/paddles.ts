/**
 * The paddle roster every lot started from the admin page seats. Any of these tags can switch on
 * during a lot and bid straight away.
 *
 * Must match the enrolled seats in firmware/integration/auction-template.json (same tagRef, alias and
 * public key): the engine rejects a press whose signature doesn't verify against the key here.
 * Check with:
 *   jq -c '[.seats[] | {tagRef, alias, publicKey}]' firmware/integration/auction-template.json
 * To add a tag, add its seat in both places.
 */
export const PADDLE_ROSTER = [
  {
    tagRef: "TAG1",
    alias: "K7",
    publicKey:
      "0471f77bfab9e161869957f4e734197acd9977e3f8bef5e81e3b53b731a3a872298144ebdf6fc36f55eb74558a1877f5f4c907193f49b713fe2ffcc2a3046d7dea",
  },
  {
    tagRef: "TAG2",
    alias: "M4",
    publicKey:
      "04e4c3d6dbb3817ab725ad3397cbffee5b91206830fb1eefcd67c2436fdf8ee08d73c78f5e1ee6f407dcae6dcb4b480491e791496577b69a14e8dba9fbc0486538",
  },
] as const;
