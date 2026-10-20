import { summaryForUser } from "@/server";

async function main() {
  const s = await summaryForUser(1);
  console.log(JSON.stringify(s, null, 2));
}
main();
