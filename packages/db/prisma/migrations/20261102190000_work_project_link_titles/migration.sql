-- 链接从纯地址改成标题 + 地址。已经存过的地址，标题先用地址本身。
ALTER TABLE "work_project" ADD COLUMN "changeListLinksJson" JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE "work_project" ADD COLUMN "jiraLinksJson" JSONB NOT NULL DEFAULT '[]'::jsonb;

UPDATE "work_project" AS project
SET "changeListLinksJson" = COALESCE(
  (
    SELECT jsonb_agg(jsonb_build_object('title', item, 'url', item))
    FROM unnest(project."changeListLinks") AS item
  ),
  '[]'::jsonb
);

UPDATE "work_project" AS project
SET "jiraLinksJson" = COALESCE(
  (
    SELECT jsonb_agg(jsonb_build_object('title', item, 'url', item))
    FROM unnest(project."jiraLinks") AS item
  ),
  '[]'::jsonb
);

ALTER TABLE "work_project" DROP COLUMN "changeListLinks";
ALTER TABLE "work_project" DROP COLUMN "jiraLinks";
ALTER TABLE "work_project" RENAME COLUMN "changeListLinksJson" TO "changeListLinks";
ALTER TABLE "work_project" RENAME COLUMN "jiraLinksJson" TO "jiraLinks";
