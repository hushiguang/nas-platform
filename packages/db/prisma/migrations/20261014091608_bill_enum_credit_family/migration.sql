-- AlterEnum
ALTER TYPE "BillAccountKind" ADD VALUE 'CREDIT';

-- AlterEnum
ALTER TYPE "BillBookKind" ADD VALUE 'FAMILY';

-- AlterTable
ALTER TABLE "bill_account" ADD COLUMN     "createdAt" TIMESTAMP(3);
