-- CreateTable
CREATE TABLE "file_attachment" (
    "id" SERIAL NOT NULL,
    "scope" TEXT NOT NULL,
    "refId" INTEGER NOT NULL DEFAULT 0,
    "filename" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "createdBy" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "file_attachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "file_attachment_storageKey_key" ON "file_attachment"("storageKey");

-- CreateIndex
CREATE INDEX "file_attachment_scope_refId_idx" ON "file_attachment"("scope", "refId");
