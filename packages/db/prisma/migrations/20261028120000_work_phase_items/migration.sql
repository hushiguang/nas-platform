-- 阶段结论 + 阶段事项清单：每阶段是否 OK，研发实施 / SIT 测试单独记进度
CREATE TYPE "WorkPhaseResult" AS ENUM ('PENDING', 'DOING', 'OK', 'RISK');
CREATE TYPE "WorkPhaseItemStatus" AS ENUM ('PENDING', 'DOING', 'DONE', 'BLOCKED');

ALTER TABLE "work_phase" ADD COLUMN "result" "WorkPhaseResult" NOT NULL DEFAULT 'PENDING';
ALTER TABLE "work_phase" ADD COLUMN "resultNote" TEXT;

CREATE TABLE "work_phase_item" (
    "id" SERIAL NOT NULL,
    "phaseId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "status" "WorkPhaseItemStatus" NOT NULL DEFAULT 'PENDING',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "trackProgress" BOOLEAN NOT NULL DEFAULT false,
    "link" TEXT,
    "note" TEXT,
    "sort" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "work_phase_item_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "work_phase_item_phaseId_sort_idx" ON "work_phase_item"("phaseId", "sort");
CREATE UNIQUE INDEX "work_phase_item_phaseId_name_key" ON "work_phase_item"("phaseId", "name");

ALTER TABLE "work_phase_item" ADD CONSTRAINT "work_phase_item_phaseId_fkey" FOREIGN KEY ("phaseId") REFERENCES "work_phase"("id") ON DELETE CASCADE ON UPDATE CASCADE;
