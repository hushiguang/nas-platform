-- CreateEnum
CREATE TYPE "TodoListKind" AS ENUM ('PERSONAL', 'SHARED');

-- CreateEnum
CREATE TYPE "TodoListRole" AS ENUM ('OWNER', 'MEMBER');

-- AlterTable
ALTER TABLE "todo" ADD COLUMN     "images" JSONB,
ADD COLUMN     "listId" INTEGER,
ADD COLUMN     "sort" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "todo_list" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "icon" TEXT,
    "color" TEXT,
    "kind" "TodoListKind" NOT NULL DEFAULT 'PERSONAL',
    "ownerId" INTEGER NOT NULL,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "todo_list_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "todo_list_member" (
    "id" SERIAL NOT NULL,
    "listId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "role" "TodoListRole" NOT NULL DEFAULT 'MEMBER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "todo_list_member_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "todo_list_ownerId_archived_sort_idx" ON "todo_list"("ownerId", "archived", "sort");

-- CreateIndex
CREATE UNIQUE INDEX "todo_list_member_listId_userId_key" ON "todo_list_member"("listId", "userId");

-- CreateIndex
CREATE INDEX "todo_listId_status_dueTime_idx" ON "todo"("listId", "status", "dueTime");

-- AddForeignKey
ALTER TABLE "todo" ADD CONSTRAINT "todo_listId_fkey" FOREIGN KEY ("listId") REFERENCES "todo_list"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "todo_list" ADD CONSTRAINT "todo_list_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "todo_list_member" ADD CONSTRAINT "todo_list_member_listId_fkey" FOREIGN KEY ("listId") REFERENCES "todo_list"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "todo_list_member" ADD CONSTRAINT "todo_list_member_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
