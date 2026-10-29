-- 纪念日增加每年的备注：25 年留下一句话，26 年留下一句话
CREATE TABLE "anniversary_note" (
    "id" SERIAL NOT NULL,
    "anniversaryId" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "note" TEXT NOT NULL,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "anniversary_note_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "anniversary_note_anniversaryId_idx" ON "anniversary_note"("anniversaryId");

ALTER TABLE "anniversary_note" ADD CONSTRAINT "anniversary_note_anniversaryId_fkey" FOREIGN KEY ("anniversaryId") REFERENCES "anniversary"("id") ON DELETE CASCADE ON UPDATE CASCADE;
