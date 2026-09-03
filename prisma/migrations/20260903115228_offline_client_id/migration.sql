-- AlterTable
ALTER TABLE "TaskEvent" ADD COLUMN     "clientId" TEXT;

-- AlterTable
ALTER TABLE "WorkSession" ADD COLUMN     "clientId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "TaskEvent_clientId_key" ON "TaskEvent"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkSession_clientId_key" ON "WorkSession"("clientId");
