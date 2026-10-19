-- 项目管理：优先级、当前阶段、上线日，以及每个项目自己的阶段和阶段人员。
CREATE TYPE "WorkPriority" AS ENUM ('URGENT', 'HIGH', 'MEDIUM', 'LOW');
CREATE TYPE "WorkPhaseKind" AS ENUM ('BUSINESS', 'DEV', 'SIT', 'UAT', 'PRELAUNCH', 'LIVE');
CREATE TYPE "IssueKind" AS ENUM ('BUG', 'IMPROVEMENT');

ALTER TABLE "work_project" ADD COLUMN "priority" "WorkPriority" NOT NULL DEFAULT 'MEDIUM';
ALTER TABLE "work_project" ADD COLUMN "phase" "WorkPhaseKind" NOT NULL DEFAULT 'BUSINESS';
ALTER TABLE "work_project" ADD COLUMN "launchDate" DATE;

ALTER TABLE "work_issue" ADD COLUMN "kind" "IssueKind" NOT NULL DEFAULT 'BUG';

CREATE TABLE "work_phase" (
    "id" SERIAL NOT NULL,
    "projectId" INTEGER NOT NULL,
    "kind" "WorkPhaseKind" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "startDate" DATE,
    "endDate" DATE,
    "devEnterDate" DATE,
    "sort" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "work_phase_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "work_phase_member" (
    "id" SERIAL NOT NULL,
    "phaseId" INTEGER NOT NULL,
    "userId" INTEGER,
    "name" TEXT NOT NULL,
    "role" TEXT,
    "startDate" DATE,
    "endDate" DATE,
    "ratio" INTEGER NOT NULL DEFAULT 100,

    CONSTRAINT "work_phase_member_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "work_phase_projectId_kind_key" ON "work_phase"("projectId", "kind");
CREATE INDEX "work_phase_projectId_sort_idx" ON "work_phase"("projectId", "sort");
CREATE INDEX "work_phase_member_phaseId_idx" ON "work_phase_member"("phaseId");
CREATE INDEX "work_phase_member_userId_idx" ON "work_phase_member"("userId");

ALTER TABLE "work_phase" ADD CONSTRAINT "work_phase_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "work_project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "work_phase_member" ADD CONSTRAINT "work_phase_member_phaseId_fkey" FOREIGN KEY ("phaseId") REFERENCES "work_phase"("id") ON DELETE CASCADE ON UPDATE CASCADE;
