-- 新增需求自己的起止，用来排期并按天数计入进度。
ALTER TABLE "work_phase_item" ADD COLUMN "startDate" DATE;
ALTER TABLE "work_phase_item" ADD COLUMN "endDate" DATE;
