-- 项目经理单独留一个名字：导入的人员是系统外人员、没有账号，
-- ownerId 只能记系统内的人，负责人显示改看这个字段。
ALTER TABLE "work_project" ADD COLUMN IF NOT EXISTS "managerName" TEXT;
