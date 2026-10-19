-- 账单是否计入收支合计。已有账单默认计入，行为与改之前一致。
ALTER TABLE "bill_transaction" ADD COLUMN "countExpense" BOOLEAN NOT NULL DEFAULT true;
