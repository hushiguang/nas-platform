-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'MEMBER');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "DataScope" AS ENUM ('SELF', 'ALL');

-- CreateEnum
CREATE TYPE "TodoSource" AS ENUM ('MANUAL', 'BILL', 'ANNIVERSARY', 'WORK', 'PREGNANCY', 'TRAVEL');

-- CreateEnum
CREATE TYPE "TodoPriority" AS ENUM ('HIGH', 'MEDIUM', 'LOW');

-- CreateEnum
CREATE TYPE "TodoStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'DONE', 'CANCELLED', 'OVERDUE');

-- CreateEnum
CREATE TYPE "NotifyStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- CreateEnum
CREATE TYPE "NotifyChannelType" AS ENUM ('WECOM', 'WX', 'MAIL');

-- CreateEnum
CREATE TYPE "CalendarType" AS ENUM ('LUNAR', 'SOLAR');

-- CreateEnum
CREATE TYPE "AnniversaryType" AS ENUM ('BIRTHDAY', 'MARRIAGE', 'PROPOSAL', 'OTHER');

-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('PREPARING', 'RUNNING', 'PAUSED', 'DONE');

-- CreateEnum
CREATE TYPE "NodeStatus" AS ENUM ('PENDING', 'DONE', 'DELAYED');

-- CreateEnum
CREATE TYPE "IssueStatus" AS ENUM ('OPEN', 'RESOLVING', 'RESOLVED');

-- CreateEnum
CREATE TYPE "PregStage" AS ENUM ('EARLY', 'MID', 'LATE', 'POSTPARTUM');

-- CreateEnum
CREATE TYPE "CityStatus" AS ENUM ('VISITED', 'WISHLIST');

-- CreateTable
CREATE TABLE "user" (
    "id" SERIAL NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "nickname" TEXT NOT NULL,
    "email" TEXT,
    "wecomId" TEXT,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "role" "Role" NOT NULL DEFAULT 'MEMBER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "icon" TEXT NOT NULL DEFAULT '🧩',
    "group" TEXT,
    "url" TEXT,
    "isExternal" BOOLEAN NOT NULL DEFAULT true,
    "sort" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "platform_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_platform" (
    "userId" INTEGER NOT NULL,
    "platformId" INTEGER NOT NULL,
    "dataScope" "DataScope" NOT NULL DEFAULT 'SELF',

    CONSTRAINT "user_platform_pkey" PRIMARY KEY ("userId","platformId")
);

-- CreateTable
CREATE TABLE "todo" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "source" "TodoSource" NOT NULL DEFAULT 'MANUAL',
    "sourceBizId" TEXT,
    "priority" "TodoPriority" NOT NULL DEFAULT 'MEDIUM',
    "dueTime" TIMESTAMP(3),
    "remindRules" JSONB,
    "status" "TodoStatus" NOT NULL DEFAULT 'PENDING',
    "ownerId" INTEGER NOT NULL,
    "triggerDate" DATE,
    "snoozeUntil" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "todo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notify_log" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "todoId" INTEGER,
    "channel" "NotifyChannelType" NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "dedupeKey" TEXT,
    "status" "NotifyStatus" NOT NULL DEFAULT 'PENDING',
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "nextRetryAt" TIMESTAMP(3),
    "lastError" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notify_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notify_channel" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "type" "NotifyChannelType" NOT NULL,
    "config" JSONB NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "notify_channel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "anniversary" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "type" "AnniversaryType" NOT NULL DEFAULT 'OTHER',
    "date" DATE NOT NULL,
    "calendar" "CalendarType" NOT NULL DEFAULT 'SOLAR',
    "ownerId" INTEGER NOT NULL,
    "remindDays" INTEGER[],
    "remindTime" TEXT,
    "note" TEXT,
    "icon" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "anniversary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_project" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "status" "ProjectStatus" NOT NULL DEFAULT 'PREPARING',
    "startDate" DATE,
    "endDate" DATE,
    "ownerId" INTEGER NOT NULL,
    "description" TEXT,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "work_project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_node" (
    "id" SERIAL NOT NULL,
    "projectId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "planDate" DATE NOT NULL,
    "actualDate" DATE,
    "status" "NodeStatus" NOT NULL DEFAULT 'PENDING',
    "ownerId" INTEGER,

    CONSTRAINT "work_node_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_member" (
    "projectId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "role" TEXT,
    "ratio" INTEGER NOT NULL DEFAULT 100,

    CONSTRAINT "work_member_pkey" PRIMARY KEY ("projectId","userId")
);

-- CreateTable
CREATE TABLE "work_issue" (
    "id" SERIAL NOT NULL,
    "projectId" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "impact" TEXT,
    "solution" TEXT,
    "status" "IssueStatus" NOT NULL DEFAULT 'OPEN',
    "ownerId" INTEGER,
    "nodeId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "work_issue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pregnancy" (
    "id" SERIAL NOT NULL,
    "lmpDate" DATE NOT NULL,
    "dueDate" DATE NOT NULL,
    "currentWeek" INTEGER NOT NULL DEFAULT 0,
    "stage" "PregStage" NOT NULL DEFAULT 'EARLY',
    "ownerId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pregnancy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "preg_node" (
    "id" SERIAL NOT NULL,
    "pregnancyId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "week" INTEGER,
    "planDate" DATE,
    "done" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,

    CONSTRAINT "preg_node_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "preg_medicine" (
    "id" SERIAL NOT NULL,
    "pregnancyId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "dosage" TEXT,
    "startDate" DATE,
    "endDate" DATE,
    "freq" TEXT,
    "category" TEXT,

    CONSTRAINT "preg_medicine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "preg_daily" (
    "id" SERIAL NOT NULL,
    "pregnancyId" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "week" INTEGER,
    "weight" DECIMAL(5,2),
    "bloodPressure" TEXT,
    "bloodSugar" DECIMAL(5,2),
    "symptom" TEXT,
    "mood" TEXT,
    "note" TEXT,
    "photos" JSONB,

    CONSTRAINT "preg_daily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "preg_checkup" (
    "id" SERIAL NOT NULL,
    "pregnancyId" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "items" TEXT,
    "result" TEXT,
    "attachments" JSONB,

    CONSTRAINT "preg_checkup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "preg_bag_item" (
    "id" SERIAL NOT NULL,
    "pregnancyId" INTEGER NOT NULL,
    "category" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "packed" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "preg_bag_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "travel_city" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "country" TEXT NOT NULL DEFAULT '中国',
    "status" "CityStatus" NOT NULL DEFAULT 'WISHLIST',
    "visits" INTEGER NOT NULL DEFAULT 0,
    "firstVisit" DATE,
    "lastVisit" DATE,
    "ownerId" INTEGER NOT NULL,
    "geo" JSONB,

    CONSTRAINT "travel_city_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "travel_trip" (
    "id" SERIAL NOT NULL,
    "cityId" INTEGER,
    "title" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "companions" TEXT,
    "cost" DECIMAL(12,2),
    "albumPath" TEXT,
    "shareToken" TEXT,
    "shareExpiry" TIMESTAMP(3),
    "ownerId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "travel_trip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "travel_photo" (
    "id" SERIAL NOT NULL,
    "tripId" INTEGER NOT NULL,
    "nasPath" TEXT NOT NULL,
    "takenAt" TIMESTAMP(3),
    "geo" JSONB,

    CONSTRAINT "travel_photo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_username_key" ON "user"("username");

-- CreateIndex
CREATE UNIQUE INDEX "platform_code_key" ON "platform"("code");

-- CreateIndex
CREATE INDEX "platform_sort_idx" ON "platform"("sort");

-- CreateIndex
CREATE INDEX "todo_ownerId_status_dueTime_idx" ON "todo"("ownerId", "status", "dueTime");

-- CreateIndex
CREATE UNIQUE INDEX "todo_source_sourceBizId_triggerDate_key" ON "todo"("source", "sourceBizId", "triggerDate");

-- CreateIndex
CREATE UNIQUE INDEX "notify_log_dedupeKey_key" ON "notify_log"("dedupeKey");

-- CreateIndex
CREATE INDEX "notify_log_userId_status_idx" ON "notify_log"("userId", "status");

-- CreateIndex
CREATE INDEX "notify_log_status_nextRetryAt_idx" ON "notify_log"("status", "nextRetryAt");

-- CreateIndex
CREATE UNIQUE INDEX "notify_channel_userId_type_key" ON "notify_channel"("userId", "type");

-- CreateIndex
CREATE INDEX "anniversary_ownerId_idx" ON "anniversary"("ownerId");

-- CreateIndex
CREATE INDEX "work_project_ownerId_status_idx" ON "work_project"("ownerId", "status");

-- CreateIndex
CREATE INDEX "work_node_projectId_planDate_idx" ON "work_node"("projectId", "planDate");

-- CreateIndex
CREATE INDEX "work_issue_projectId_status_idx" ON "work_issue"("projectId", "status");

-- CreateIndex
CREATE INDEX "preg_node_pregnancyId_planDate_idx" ON "preg_node"("pregnancyId", "planDate");

-- CreateIndex
CREATE UNIQUE INDEX "preg_daily_pregnancyId_date_key" ON "preg_daily"("pregnancyId", "date");

-- CreateIndex
CREATE INDEX "travel_city_ownerId_status_idx" ON "travel_city"("ownerId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "travel_trip_shareToken_key" ON "travel_trip"("shareToken");

-- CreateIndex
CREATE INDEX "travel_trip_ownerId_startDate_idx" ON "travel_trip"("ownerId", "startDate");

-- CreateIndex
CREATE INDEX "travel_photo_tripId_idx" ON "travel_photo"("tripId");

-- AddForeignKey
ALTER TABLE "user_platform" ADD CONSTRAINT "user_platform_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_platform" ADD CONSTRAINT "user_platform_platformId_fkey" FOREIGN KEY ("platformId") REFERENCES "platform"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "todo" ADD CONSTRAINT "todo_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notify_log" ADD CONSTRAINT "notify_log_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notify_log" ADD CONSTRAINT "notify_log_todoId_fkey" FOREIGN KEY ("todoId") REFERENCES "todo"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notify_channel" ADD CONSTRAINT "notify_channel_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_node" ADD CONSTRAINT "work_node_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "work_project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_member" ADD CONSTRAINT "work_member_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "work_project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_issue" ADD CONSTRAINT "work_issue_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "work_project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "preg_node" ADD CONSTRAINT "preg_node_pregnancyId_fkey" FOREIGN KEY ("pregnancyId") REFERENCES "pregnancy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "preg_medicine" ADD CONSTRAINT "preg_medicine_pregnancyId_fkey" FOREIGN KEY ("pregnancyId") REFERENCES "pregnancy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "preg_daily" ADD CONSTRAINT "preg_daily_pregnancyId_fkey" FOREIGN KEY ("pregnancyId") REFERENCES "pregnancy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "preg_checkup" ADD CONSTRAINT "preg_checkup_pregnancyId_fkey" FOREIGN KEY ("pregnancyId") REFERENCES "pregnancy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "preg_bag_item" ADD CONSTRAINT "preg_bag_item_pregnancyId_fkey" FOREIGN KEY ("pregnancyId") REFERENCES "pregnancy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "travel_trip" ADD CONSTRAINT "travel_trip_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "travel_city"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "travel_photo" ADD CONSTRAINT "travel_photo_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "travel_trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

