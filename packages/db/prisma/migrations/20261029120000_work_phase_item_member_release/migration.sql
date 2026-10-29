-- 事项上的人各自有预计释放日。原来记在阶段人员上的释放日，按名字抄到已有的事项投入上。
ALTER TABLE "work_phase_item_member" ADD COLUMN "endDate" DATE;

UPDATE "work_phase_item_member" AS member
SET "endDate" = roster."endDate"
FROM "work_phase_item" AS item, "work_phase_member" AS roster
WHERE member."itemId" = item."id"
  AND roster."phaseId" = item."phaseId"
  AND roster."name" = member."name"
  AND member."endDate" IS NULL
  AND roster."endDate" IS NOT NULL;
