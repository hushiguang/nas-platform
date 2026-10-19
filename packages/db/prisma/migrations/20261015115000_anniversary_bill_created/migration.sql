-- 门户悬停要显示这笔账单是什么时候记下的
ALTER TABLE "anniversary_bill" ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
