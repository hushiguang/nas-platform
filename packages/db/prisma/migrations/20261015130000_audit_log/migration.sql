-- 各应用编辑时写入的操作日志。门户按 app 筛选查看。
CREATE TABLE "audit_log" (
    "id" SERIAL NOT NULL,
    "app" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "target" TEXT NOT NULL DEFAULT '',
    "targetId" TEXT,
    "summary" TEXT NOT NULL,
    "actorId" INTEGER,
    "actorName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "audit_log_app_createdAt_idx" ON "audit_log"("app", "createdAt");
CREATE INDEX "audit_log_createdAt_idx" ON "audit_log"("createdAt");
