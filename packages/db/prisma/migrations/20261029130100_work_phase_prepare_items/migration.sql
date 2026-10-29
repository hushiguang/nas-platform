-- 每个项目补上项目准备阶段，排在商务之后、研发之前。
UPDATE "work_phase" SET "sort" = "sort" + 1 WHERE "sort" >= 1;

INSERT INTO "work_phase" ("projectId", "kind", "enabled", "sort")
SELECT "id", 'PREPARE', true, 1
FROM "work_project"
ON CONFLICT ("projectId", "kind") DO NOTHING;

-- 计划、原型、UI、链接从研发节点挪到项目准备，人和百分比跟着事项走。
UPDATE "work_phase_item" AS item
SET "phaseId" = prep."id",
    "sort" = CASE item."name"
      WHEN '项目计划' THEN 0
      WHEN '原型交付' THEN 1
      WHEN 'UI交付' THEN 2
      WHEN 'ChangeList' THEN 3
      WHEN 'Jira链接' THEN 4
      ELSE item."sort"
    END
FROM "work_phase" AS dev, "work_phase" AS prep
WHERE item."phaseId" = dev."id"
  AND dev."kind" = 'DEV'
  AND prep."projectId" = dev."projectId"
  AND prep."kind" = 'PREPARE'
  AND item."name" IN ('项目计划', '原型交付', 'UI交付', 'ChangeList', 'Jira链接');

-- 研发节点留下的事项重新编号，研发实施排在最前。
WITH ranked AS (
  SELECT item."id",
         ROW_NUMBER() OVER (
           PARTITION BY item."phaseId"
           ORDER BY CASE WHEN item."name" = '研发实施' THEN 0 ELSE 1 END, item."sort", item."id"
         ) - 1 AS next_sort
  FROM "work_phase_item" AS item
  JOIN "work_phase" AS dev ON dev."id" = item."phaseId" AND dev."kind" = 'DEV'
)
UPDATE "work_phase_item" AS item
SET "sort" = ranked.next_sort
FROM ranked
WHERE item."id" = ranked."id";
