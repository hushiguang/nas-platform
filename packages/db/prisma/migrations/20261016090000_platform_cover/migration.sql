-- 门户应用卡片背景，复用纪念日同一套写法：gallery:<id> / gradient:<id> / 图床 URL
ALTER TABLE "platform" ADD COLUMN IF NOT EXISTS "cover" TEXT;
