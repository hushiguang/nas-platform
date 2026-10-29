-- 项目准备阶段。新枚举值单独提交，下一条迁移才能用它搬事项。
ALTER TYPE "WorkPhaseKind" ADD VALUE 'PREPARE' BEFORE 'DEV';
