-- CreateEnum
CREATE TYPE "BillAccountKind" AS ENUM ('ALIPAY', 'BANK', 'CASH', 'JD', 'OTHER', 'WECHAT');

-- CreateEnum
CREATE TYPE "BillCategoryKind" AS ENUM ('EXPENSE', 'INCOME');

-- CreateEnum
CREATE TYPE "BillBookKind" AS ENUM ('PERSONAL', 'TRAVEL', 'AA');

-- CreateEnum
CREATE TYPE "BillTxType" AS ENUM ('EXPENSE', 'INCOME', 'TRANSFER');

-- CreateEnum
CREATE TYPE "BillTxSource" AS ENUM ('MANUAL', 'ALIPAY', 'WECHAT', 'CMB', 'JD', 'CUSTOM', 'RECURRING');

-- CreateEnum
CREATE TYPE "BillFollowAction" AS ENUM ('NONE', 'REFUND', 'REIMBURSE', 'WARRANTY', 'REVIEW', 'RECEIVE');

-- CreateEnum
CREATE TYPE "BillFollowStatus" AS ENUM ('NONE', 'PENDING', 'PROCESSING', 'DONE', 'ABANDONED');

-- CreateTable
CREATE TABLE "bill_account" (
    "id" SERIAL NOT NULL,
    "ownerId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "BillAccountKind" NOT NULL,
    "initialCents" INTEGER NOT NULL DEFAULT 0,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "mergedInto" INTEGER,

    CONSTRAINT "bill_account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bill_category" (
    "id" SERIAL NOT NULL,
    "ownerId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "parentId" INTEGER,
    "kind" "BillCategoryKind" NOT NULL,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "archived" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "bill_category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bill_book" (
    "id" SERIAL NOT NULL,
    "ownerId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "BillBookKind" NOT NULL DEFAULT 'PERSONAL',
    "shareToken" TEXT,
    "shareEnabled" BOOLEAN NOT NULL DEFAULT false,
    "shareWritable" BOOLEAN NOT NULL DEFAULT false,
    "aaEnabled" BOOLEAN NOT NULL DEFAULT false,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bill_book_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bill_book_member" (
    "id" SERIAL NOT NULL,
    "bookId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bill_book_member_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bill_book_participant" (
    "id" SERIAL NOT NULL,
    "bookId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bill_book_participant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bill_transaction" (
    "id" SERIAL NOT NULL,
    "ownerId" INTEGER NOT NULL,
    "bookId" INTEGER,
    "type" "BillTxType" NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "accountId" INTEGER,
    "toAccountId" INTEGER,
    "categoryId" INTEGER,
    "categoryLabel" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "payee" TEXT,
    "note" TEXT,
    "memberName" TEXT,
    "shareWith" JSONB,
    "source" "BillTxSource" NOT NULL DEFAULT 'MANUAL',
    "externalId" TEXT,
    "recurringRuleId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "followAction" "BillFollowAction" NOT NULL DEFAULT 'NONE',
    "followStatus" "BillFollowStatus" NOT NULL DEFAULT 'NONE',
    "refundCents" INTEGER,
    "refundedAt" TIMESTAMP(3),
    "followNote" TEXT,

    CONSTRAINT "bill_transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bill_transaction_image" (
    "id" SERIAL NOT NULL,
    "transactionId" INTEGER NOT NULL,
    "url" TEXT NOT NULL,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bill_transaction_image_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bill_recurring_rule" (
    "id" SERIAL NOT NULL,
    "ownerId" INTEGER NOT NULL,
    "bookId" INTEGER,
    "type" "BillTxType" NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "accountId" INTEGER NOT NULL,
    "toAccountId" INTEGER,
    "categoryId" INTEGER,
    "payee" TEXT,
    "note" TEXT,
    "frequency" TEXT NOT NULL,
    "intervalDays" INTEGER,
    "weekdays" TEXT,
    "monthDay" INTEGER,
    "yearMonth" INTEGER,
    "yearDay" INTEGER,
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "time" TEXT NOT NULL DEFAULT '09:00',
    "nextRun" TIMESTAMP(3),
    "paused" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bill_recurring_rule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bill_account_alias" (
    "id" SERIAL NOT NULL,
    "ownerId" INTEGER NOT NULL,
    "alias" TEXT NOT NULL,
    "accountId" INTEGER NOT NULL,

    CONSTRAINT "bill_account_alias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bill_category_alias" (
    "id" SERIAL NOT NULL,
    "ownerId" INTEGER NOT NULL,
    "kind" "BillCategoryKind" NOT NULL,
    "alias" TEXT NOT NULL,
    "categoryId" INTEGER NOT NULL,

    CONSTRAINT "bill_category_alias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bill_category_rule" (
    "id" SERIAL NOT NULL,
    "ownerId" INTEGER NOT NULL,
    "keyword" TEXT NOT NULL,
    "categoryId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bill_category_rule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bill_transfer_rule" (
    "id" SERIAL NOT NULL,
    "ownerId" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "pattern" TEXT NOT NULL,
    "isRegex" BOOLEAN NOT NULL DEFAULT false,
    "targetAccountId" INTEGER,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bill_transfer_rule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bill_cmb_text_fix" (
    "id" SERIAL NOT NULL,
    "ownerId" INTEGER NOT NULL,
    "garbled" TEXT NOT NULL,
    "correct" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bill_cmb_text_fix_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bill_duplicate_ignore" (
    "id" SERIAL NOT NULL,
    "ownerId" INTEGER NOT NULL,
    "pairKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bill_duplicate_ignore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bill_import_template" (
    "id" SERIAL NOT NULL,
    "ownerId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "mapping" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bill_import_template_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bill_import_draft" (
    "id" SERIAL NOT NULL,
    "ownerId" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "filename" TEXT,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bill_import_draft_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bill_account_ownerId_idx" ON "bill_account"("ownerId");

-- CreateIndex
CREATE INDEX "bill_category_ownerId_idx" ON "bill_category"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "bill_category_ownerId_kind_name_key" ON "bill_category"("ownerId", "kind", "name");

-- CreateIndex
CREATE UNIQUE INDEX "bill_book_shareToken_key" ON "bill_book"("shareToken");

-- CreateIndex
CREATE INDEX "bill_book_ownerId_idx" ON "bill_book"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "bill_book_ownerId_name_key" ON "bill_book"("ownerId", "name");

-- CreateIndex
CREATE INDEX "bill_book_member_userId_idx" ON "bill_book_member"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "bill_book_member_bookId_userId_key" ON "bill_book_member"("bookId", "userId");

-- CreateIndex
CREATE INDEX "bill_book_participant_bookId_idx" ON "bill_book_participant"("bookId");

-- CreateIndex
CREATE UNIQUE INDEX "bill_book_participant_bookId_name_key" ON "bill_book_participant"("bookId", "name");

-- CreateIndex
CREATE INDEX "bill_transaction_ownerId_occurredAt_idx" ON "bill_transaction"("ownerId", "occurredAt");

-- CreateIndex
CREATE INDEX "bill_transaction_ownerId_type_amountCents_occurredAt_idx" ON "bill_transaction"("ownerId", "type", "amountCents", "occurredAt");

-- CreateIndex
CREATE INDEX "bill_transaction_bookId_occurredAt_idx" ON "bill_transaction"("bookId", "occurredAt");

-- CreateIndex
CREATE INDEX "bill_transaction_ownerId_followStatus_idx" ON "bill_transaction"("ownerId", "followStatus");

-- CreateIndex
CREATE UNIQUE INDEX "bill_transaction_ownerId_source_externalId_key" ON "bill_transaction"("ownerId", "source", "externalId");

-- CreateIndex
CREATE INDEX "bill_transaction_image_transactionId_idx" ON "bill_transaction_image"("transactionId");

-- CreateIndex
CREATE INDEX "bill_recurring_rule_ownerId_idx" ON "bill_recurring_rule"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "bill_account_alias_ownerId_alias_key" ON "bill_account_alias"("ownerId", "alias");

-- CreateIndex
CREATE UNIQUE INDEX "bill_category_alias_ownerId_kind_alias_key" ON "bill_category_alias"("ownerId", "kind", "alias");

-- CreateIndex
CREATE INDEX "bill_category_rule_ownerId_idx" ON "bill_category_rule"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "bill_category_rule_ownerId_keyword_key" ON "bill_category_rule"("ownerId", "keyword");

-- CreateIndex
CREATE INDEX "bill_transfer_rule_ownerId_idx" ON "bill_transfer_rule"("ownerId");

-- CreateIndex
CREATE INDEX "bill_cmb_text_fix_ownerId_idx" ON "bill_cmb_text_fix"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "bill_duplicate_ignore_ownerId_pairKey_key" ON "bill_duplicate_ignore"("ownerId", "pairKey");
