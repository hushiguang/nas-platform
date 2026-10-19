-- 纪念日：背景图、账单链接、农历月日（含闰月）
ALTER TABLE "anniversary" ADD COLUMN "background" TEXT;
ALTER TABLE "anniversary" ADD COLUMN "billHref" TEXT;
ALTER TABLE "anniversary" ADD COLUMN "billLabel" TEXT;
ALTER TABLE "anniversary" ADD COLUMN "lunarLeap" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "anniversary" ADD COLUMN "lunarMonth" INTEGER;
ALTER TABLE "anniversary" ADD COLUMN "lunarDay" INTEGER;
