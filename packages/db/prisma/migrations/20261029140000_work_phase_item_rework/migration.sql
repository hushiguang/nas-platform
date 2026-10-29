-- UAT 新增需求：单独一轮研发进入，不计入阶段百分比。
ALTER TABLE "work_phase_item" ADD COLUMN "rework" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "work_phase_item" ADD COLUMN "devEnterDate" DATE;
