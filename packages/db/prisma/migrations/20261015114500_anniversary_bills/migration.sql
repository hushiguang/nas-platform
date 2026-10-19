-- 纪念日的账单从「一条链接」改成列表：每年买的东西可以各记一笔
CREATE TABLE "anniversary_bill" (
    "id" SERIAL NOT NULL,
    "anniversaryId" INTEGER NOT NULL,
    "year" INTEGER,
    "label" TEXT NOT NULL,
    "href" TEXT NOT NULL,
    "sort" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "anniversary_bill_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "anniversary_bill_anniversaryId_idx" ON "anniversary_bill"("anniversaryId");

ALTER TABLE "anniversary_bill" ADD CONSTRAINT "anniversary_bill_anniversaryId_fkey" FOREIGN KEY ("anniversaryId") REFERENCES "anniversary"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "anniversary_bill" ("anniversaryId", "label", "href", "sort")
SELECT "id", COALESCE(NULLIF(BTRIM("billLabel"), ''), '查看账单'), "billHref", 0
FROM "anniversary"
WHERE "billHref" IS NOT NULL AND BTRIM("billHref") <> '';

ALTER TABLE "anniversary" DROP COLUMN "billHref";
ALTER TABLE "anniversary" DROP COLUMN "billLabel";
