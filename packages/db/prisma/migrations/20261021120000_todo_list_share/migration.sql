-- 清单分享：免登录链接（只读 / 可勾选），与账本的账本分享同一套思路
-- AlterTable
ALTER TABLE "todo_list" ADD COLUMN     "shareToken" TEXT,
ADD COLUMN     "shareEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "shareWritable" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE UNIQUE INDEX "todo_list_shareToken_key" ON "todo_list"("shareToken");
