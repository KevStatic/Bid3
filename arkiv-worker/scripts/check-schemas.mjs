// The worker's schemas must be byte-identical to the web app's, or reads and writes drift apart.
import { readFileSync } from "node:fs";

const worker = readFileSync(new URL("../src/schemas.ts", import.meta.url), "utf8");
const web = readFileSync(new URL("../../web/src/lib/arkiv/schemas.ts", import.meta.url), "utf8");
if (worker !== web) {
  console.error("arkiv-worker/src/schemas.ts differs from web/src/lib/arkiv/schemas.ts. Copy the web file over.");
  process.exit(1);
}
console.log("schemas match");
