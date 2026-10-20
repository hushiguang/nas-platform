import { prisma } from "@nas/db";
import { present } from "@/server/anniversary";

async function main() {
  const rows = await prisma.anniversary.findMany({ include: { bills: true } });
  const list = rows.map((r) => ({ r, o: present(r) }));
  list.sort((a, b) => (a.o.occurrence.days ?? 9e9) - (b.o.occurrence.days ?? 9e9));
  for (const x of list) {
    console.log(x.r.id, x.r.name, x.r.ownerId, x.r.calendar, "days=", x.o.occurrence.days, x.o.occurrence.when, x.o.occurrence.countdown);
  }
}
main();
