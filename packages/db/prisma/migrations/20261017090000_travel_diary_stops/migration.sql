-- AlterTable
ALTER TABLE "travel_trip" ADD COLUMN "cover" TEXT,
ADD COLUMN "summary" TEXT,
ADD COLUMN "content" TEXT;

-- CreateTable
CREATE TABLE "travel_stop" (
    "id" SERIAL NOT NULL,
    "tripId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "stopDate" DATE,
    "note" TEXT,
    "photos" JSONB,
    "sort" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "travel_stop_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "travel_photo" ADD COLUMN "caption" TEXT,
ADD COLUMN "sort" INTEGER NOT NULL DEFAULT 0;

-- DropIndex
DROP INDEX "travel_photo_tripId_idx";

-- CreateIndex
CREATE INDEX "travel_stop_tripId_sort_idx" ON "travel_stop"("tripId", "sort");

-- CreateIndex
CREATE INDEX "travel_photo_tripId_sort_idx" ON "travel_photo"("tripId", "sort");

-- AddForeignKey
ALTER TABLE "travel_stop" ADD CONSTRAINT "travel_stop_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "travel_trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;
