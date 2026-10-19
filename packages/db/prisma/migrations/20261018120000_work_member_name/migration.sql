-- 项目预设参加人员改为手填名字：系统外的人没有账号，只留名字。
-- 注意顺序：userId 还在复合主键里时不能先去掉 NOT NULL，所以先补名字、再拆主键。
ALTER TABLE "work_member" ADD COLUMN IF NOT EXISTS "name" TEXT;

UPDATE "work_member" m
SET "name" = COALESCE(u."nickname", '成员' || m."userId"::TEXT)
FROM "user" u
WHERE u."id" = m."userId" AND m."name" IS NULL;

DELETE FROM "work_member" WHERE "name" IS NULL;

ALTER TABLE "work_member" DROP CONSTRAINT IF EXISTS "work_member_pkey";
ALTER TABLE "work_member" DROP CONSTRAINT IF EXISTS "work_member_projectId_userId_key";

ALTER TABLE "work_member" ALTER COLUMN "name" SET NOT NULL;
ALTER TABLE "work_member" ALTER COLUMN "userId" DROP NOT NULL;
ALTER TABLE "work_member" ADD COLUMN IF NOT EXISTS "id" SERIAL;

ALTER TABLE "work_member" ADD PRIMARY KEY ("id");

DROP INDEX IF EXISTS "work_member_projectId_userId_key";
CREATE UNIQUE INDEX IF NOT EXISTS "work_member_projectId_name_key" ON "work_member"("projectId", "name");
CREATE INDEX IF NOT EXISTS "work_member_projectId_idx" ON "work_member"("projectId");
CREATE INDEX IF NOT EXISTS "work_member_userId_idx" ON "work_member"("userId");