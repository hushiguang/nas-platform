-- 项目详情上的 ChangeList / Jira 链接。一条项目可以挂多条。
ALTER TABLE "work_project" ADD COLUMN "changeListLinks" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "work_project" ADD COLUMN "jiraLinks" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- 阶段事项里已经填过的单条链接，搬到项目上，避免详情页是空的。
UPDATE "work_project" AS project
SET "changeListLinks" = ARRAY[btrim(item."link")]
FROM "work_phase_item" AS item
JOIN "work_phase" AS phase ON phase."id" = item."phaseId"
WHERE phase."projectId" = project."id"
  AND item."name" = 'ChangeList'
  AND item."link" IS NOT NULL
  AND btrim(item."link") <> ''
  AND cardinality(project."changeListLinks") = 0;

UPDATE "work_project" AS project
SET "jiraLinks" = ARRAY[btrim(item."link")]
FROM "work_phase_item" AS item
JOIN "work_phase" AS phase ON phase."id" = item."phaseId"
WHERE phase."projectId" = project."id"
  AND item."name" = 'Jira链接'
  AND item."link" IS NOT NULL
  AND btrim(item."link") <> ''
  AND cardinality(project."jiraLinks") = 0;
