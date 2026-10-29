-- 事项上的投入人员。百分比按事项记，同一个人在不同事项上可以不一样。
CREATE TABLE "work_phase_item_member" (
    "id" SERIAL NOT NULL,
    "itemId" INTEGER NOT NULL,
    "userId" INTEGER,
    "name" TEXT NOT NULL,
    "ratio" INTEGER NOT NULL DEFAULT 100,

    CONSTRAINT "work_phase_item_member_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "work_phase_item_member_itemId_idx" ON "work_phase_item_member"("itemId");
CREATE INDEX "work_phase_item_member_userId_idx" ON "work_phase_item_member"("userId");
CREATE UNIQUE INDEX "work_phase_item_member_itemId_name_key" ON "work_phase_item_member"("itemId", "name");

ALTER TABLE "work_phase_item_member" ADD CONSTRAINT "work_phase_item_member_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "work_phase_item"("id") ON DELETE CASCADE ON UPDATE CASCADE;
