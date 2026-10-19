-- 全局设置（键值对）：企业微信应用三件套等服务端参数改由门户界面配置，
-- 环境变量保留为兜底 —— 库里没有对应 key 时仍走 env。
CREATE TABLE IF NOT EXISTS "setting" (
  "key"       TEXT PRIMARY KEY,
  "value"     TEXT NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
