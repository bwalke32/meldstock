-- CreateEnum
CREATE TYPE "LotType" AS ENUM ('HAVE', 'WANTED');

-- CreateEnum
CREATE TYPE "LotVisibility" AS ENUM ('PUBLIC', 'VERIFIED_COMPANIES_ONLY', 'SELECTED_COMPANIES', 'MY_NETWORK', 'ANONYMOUS');

-- CreateEnum
CREATE TYPE "Polymer" AS ENUM ('ABS', 'PC', 'PP', 'PE_HDPE', 'PE_LDPE', 'PE_LLDPE', 'PA6', 'PA66', 'PA612', 'PBT', 'PET', 'POM', 'PPS', 'TPU', 'TPV', 'TPE', 'HIPS', 'GPPS', 'OTHER');

-- CreateEnum
CREATE TYPE "LotCondition" AS ENUM ('PRIME_VIRGIN', 'OFF_GRADE_WIDE_SPEC', 'REPROCESSED', 'RECYCLED_CONTENT', 'REGRIND_GRANULATED', 'SCRAP', 'PARTS_SPRUES_RUNNERS', 'PURGE', 'POST_INDUSTRIAL', 'POST_CONSUMER', 'MASTERBATCH_COMPOUND', 'OTHER');

-- CreateEnum
CREATE TYPE "LotLifecycleStatus" AS ENUM ('ACTIVE', 'SOLD', 'EXPIRED', 'DEACTIVATED');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('COA', 'TDS', 'SDS', 'CERTIFICATION', 'TEST_REPORT', 'OTHER');

-- CreateEnum
CREATE TYPE "ThreadKind" AS ENUM ('LISTING', 'RFQ', 'BROKER_GROUP');

-- CreateEnum
CREATE TYPE "TransactionStatus" AS ENUM ('PENDING', 'COMPLETED', 'CANCELED');

-- CreateEnum
CREATE TYPE "DealStatus" AS ENUM ('OFFER', 'ACCEPTED', 'PO_ISSUED', 'PICKUP_SCHEDULED', 'IN_TRANSIT', 'DELIVERED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "NotificationKind" AS ENUM ('SAVED_SEARCH_MATCH', 'THREAD_MESSAGE');

-- CreateEnum
CREATE TYPE "OfferStatus" AS ENUM ('PENDING', 'COUNTERED', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "PriceUnit" AS ENUM ('PER_LB', 'PER_KG');

-- CreateEnum
CREATE TYPE "FreightTerm" AS ENUM ('EXW', 'FOB', 'DELIVERED', 'FREIGHT_COLLECT', 'FREIGHT_PREPAID');

-- CreateEnum
CREATE TYPE "BusinessRole" AS ENUM ('BROKER_TRADER', 'INJECTION_MOLDER', 'EXTRUDER', 'BLOW_MOLDER', 'THERMOFORMER', 'RECYCLER_REPROCESSOR', 'COMPOUNDER', 'DISTRIBUTOR', 'RESIN_PRODUCER', 'SCRAP_GENERATOR', 'MANUFACTURER', 'BUYER');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('UNVERIFIED', 'PENDING', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "RatingDimension" AS ENUM ('MATERIAL_MATCH', 'DOCUMENTATION', 'PAYMENT', 'SHIPPING', 'COMMUNICATION');

-- CreateEnum
CREATE TYPE "WantedResponseStatus" AS ENUM ('PENDING', 'COUNTERED', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'WITHDRAWN');

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "actor" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT,
    "metadata" JSONB NOT NULL,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lot" (
    "id" TEXT NOT NULL,
    "type" "LotType" NOT NULL DEFAULT 'HAVE',
    "polymer" "Polymer" NOT NULL,
    "condition" "LotCondition" NOT NULL,
    "color" TEXT NOT NULL,
    "form" TEXT NOT NULL,
    "manufacturer" TEXT,
    "grade" TEXT,
    "quantityLb" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "packaging" TEXT NOT NULL,
    "location" TEXT,
    "country" TEXT NOT NULL DEFAULT '',
    "askingPricePerLb" DECIMAL(65,30),
    "hasCoa" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "postedByName" TEXT NOT NULL,
    "postedByUserId" TEXT,
    "visibility" "LotVisibility" NOT NULL DEFAULT 'PUBLIC',
    "selectedCompanyIdentifiers" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "postedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "quantityRemaining" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "status" "LotLifecycleStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastNudgedAt" TIMESTAMP(3),
    "lastConfirmedAt" TIMESTAMP(3),

    CONSTRAINT "Lot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LotMessage" (
    "id" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "senderName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LotMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "type" "DocumentType" NOT NULL DEFAULT 'OTHER',
    "filename" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL DEFAULT 'application/pdf',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageThread" (
    "id" TEXT NOT NULL,
    "lotId" TEXT,
    "buyerId" TEXT,
    "sellerId" TEXT,
    "subject" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "kind" "ThreadKind" NOT NULL DEFAULT 'LISTING',
    "description" TEXT,
    "createdById" TEXT,
    "rfqId" TEXT,
    "status" "TransactionStatus" NOT NULL DEFAULT 'PENDING',
    "completedAt" TIMESTAMP(3),
    "canceledAt" TIMESTAMP(3),
    "dealStatus" "DealStatus" NOT NULL DEFAULT 'OFFER',
    "dealStatusUpdatedAt" TIMESTAMP(3),
    "dealStatusAdvancedBy" TEXT,

    CONSTRAINT "MessageThread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ThreadReadState" (
    "threadId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "lastReadAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ThreadReadState_pkey" PRIMARY KEY ("threadId","userId")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "attachmentUrl" TEXT,
    "attachmentFilename" TEXT,
    "attachmentMimeType" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ThreadParticipant" (
    "threadId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "addedBy" TEXT,

    CONSTRAINT "ThreadParticipant_pkey" PRIMARY KEY ("threadId","userId")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "NotificationKind" NOT NULL,
    "payload" JSONB NOT NULL,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Offer" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "parentOfferId" TEXT,
    "quantityLb" DECIMAL(65,30) NOT NULL,
    "pricePerUnit" DECIMAL(65,30) NOT NULL,
    "priceUnit" "PriceUnit" NOT NULL DEFAULT 'PER_LB',
    "freightTerm" "FreightTerm" NOT NULL,
    "shipToZipCode" TEXT,
    "shipToCity" TEXT,
    "shipToState" TEXT,
    "shipToCountry" TEXT,
    "requestedDeliveryDate" TIMESTAMP(3),
    "paymentTerms" TEXT,
    "comments" TEXT,
    "offerExpiresAt" TIMESTAMP(3) NOT NULL,
    "status" "OfferStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "counteredAt" TIMESTAMP(3),
    "acceptedAt" TIMESTAMP(3),
    "declinedAt" TIMESTAMP(3),
    "withdrawnAt" TIMESTAMP(3),

    CONSTRAINT "Offer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Profile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accountType" TEXT NOT NULL DEFAULT 'INDIVIDUAL',
    "displayName" TEXT NOT NULL,
    "companyName" TEXT,
    "positionTitle" TEXT,
    "role" "BusinessRole" NOT NULL,
    "location" TEXT,
    "country" TEXT,
    "companyDescription" TEXT,
    "materialsBought" JSONB,
    "materialsSold" JSONB,
    "yearsInBusiness" INTEGER,
    "websiteUrl" TEXT,
    "phone" TEXT,
    "publicEmail" TEXT,
    "socialTwitter" TEXT,
    "socialLinkedin" TEXT,
    "socialInstagram" TEXT,
    "isAdmin" BOOLEAN NOT NULL DEFAULT false,
    "verificationStatus" "VerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "verifiedAt" TIMESTAMP(3),
    "handle" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Profile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationRequest" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    "status" "VerificationStatus" NOT NULL DEFAULT 'PENDING',
    "requestedDocumentsText" TEXT,
    "reviewerNote" TEXT,
    "reviewedByUserId" TEXT,

    CONSTRAINT "VerificationRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Rating" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "raterId" TEXT NOT NULL,
    "rateeId" TEXT NOT NULL,
    "dimension" "RatingDimension" NOT NULL,
    "score" INTEGER NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Rating_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SavedSearch" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "filterJson" JSONB NOT NULL,
    "alertEnabled" BOOLEAN NOT NULL DEFAULT true,
    "lastAlertSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SavedSearch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WantedResponse" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "parentResponseId" TEXT,
    "quantityLb" DECIMAL(65,30) NOT NULL,
    "pricePerUnit" DECIMAL(65,30) NOT NULL,
    "priceUnit" "PriceUnit" NOT NULL DEFAULT 'PER_LB',
    "freightTerm" "FreightTerm" NOT NULL,
    "materialLocation" TEXT NOT NULL,
    "leadTimeDays" INTEGER,
    "packaging" TEXT,
    "lotInfo" TEXT,
    "coaAvailable" BOOLEAN NOT NULL DEFAULT false,
    "paymentTerms" TEXT,
    "comments" TEXT,
    "offerExpiresAt" TIMESTAMP(3) NOT NULL,
    "status" "WantedResponseStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "counteredAt" TIMESTAMP(3),
    "acceptedAt" TIMESTAMP(3),
    "declinedAt" TIMESTAMP(3),
    "withdrawnAt" TIMESTAMP(3),

    CONSTRAINT "WantedResponse_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AuditEvent_resourceType_resourceId_createdAt_idx" ON "AuditEvent"("resourceType", "resourceId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "AuditEvent_userId_createdAt_idx" ON "AuditEvent"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "AuditEvent_action_createdAt_idx" ON "AuditEvent"("action", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "AuditEvent_createdAt_idx" ON "AuditEvent"("createdAt" DESC);

-- CreateIndex
CREATE INDEX "Lot_type_createdAt_idx" ON "Lot"("type", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Lot_createdAt_idx" ON "Lot"("createdAt" DESC);

-- CreateIndex
CREATE INDEX "Lot_postedByUserId_idx" ON "Lot"("postedByUserId");

-- CreateIndex
CREATE INDEX "Lot_visibility_idx" ON "Lot"("visibility");

-- CreateIndex
CREATE INDEX "Lot_postedByUserId_visibility_idx" ON "Lot"("postedByUserId", "visibility");

-- CreateIndex
CREATE INDEX "Lot_postedByUserId_status_idx" ON "Lot"("postedByUserId", "status");

-- CreateIndex
CREATE INDEX "Lot_status_lastUpdatedAt_idx" ON "Lot"("status", "lastUpdatedAt");

-- CreateIndex
CREATE INDEX "LotMessage_lotId_createdAt_idx" ON "LotMessage"("lotId", "createdAt");

-- CreateIndex
CREATE INDEX "Document_lotId_createdAt_idx" ON "Document"("lotId", "createdAt");

-- CreateIndex
CREATE INDEX "MessageThread_buyerId_lastMessageAt_idx" ON "MessageThread"("buyerId", "lastMessageAt" DESC);

-- CreateIndex
CREATE INDEX "MessageThread_sellerId_lastMessageAt_idx" ON "MessageThread"("sellerId", "lastMessageAt" DESC);

-- CreateIndex
CREATE INDEX "MessageThread_lotId_idx" ON "MessageThread"("lotId");

-- CreateIndex
CREATE INDEX "MessageThread_rfqId_idx" ON "MessageThread"("rfqId");

-- CreateIndex
CREATE INDEX "MessageThread_kind_lastMessageAt_idx" ON "MessageThread"("kind", "lastMessageAt" DESC);

-- CreateIndex
CREATE INDEX "MessageThread_createdById_idx" ON "MessageThread"("createdById");

-- CreateIndex
CREATE INDEX "MessageThread_status_lastMessageAt_idx" ON "MessageThread"("status", "lastMessageAt" DESC);

-- CreateIndex
CREATE INDEX "MessageThread_dealStatus_lastMessageAt_idx" ON "MessageThread"("dealStatus", "lastMessageAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "MessageThread_lotId_buyerId_key" ON "MessageThread"("lotId", "buyerId");

-- CreateIndex
CREATE INDEX "ThreadReadState_userId_idx" ON "ThreadReadState"("userId");

-- CreateIndex
CREATE INDEX "Message_threadId_createdAt_idx" ON "Message"("threadId", "createdAt");

-- CreateIndex
CREATE INDEX "ThreadParticipant_userId_idx" ON "ThreadParticipant"("userId");

-- CreateIndex
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_createdAt_idx" ON "Notification"("userId", "readAt", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Offer_threadId_createdAt_idx" ON "Offer"("threadId", "createdAt");

-- CreateIndex
CREATE INDEX "Offer_lotId_status_idx" ON "Offer"("lotId", "status");

-- CreateIndex
CREATE INDEX "Offer_parentOfferId_idx" ON "Offer"("parentOfferId");

-- CreateIndex
CREATE INDEX "Offer_status_acceptedAt_idx" ON "Offer"("status", "acceptedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Profile_userId_key" ON "Profile"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Profile_handle_key" ON "Profile"("handle");

-- CreateIndex
CREATE INDEX "Profile_userId_idx" ON "Profile"("userId");

-- CreateIndex
CREATE INDEX "Profile_verificationStatus_idx" ON "Profile"("verificationStatus");

-- CreateIndex
CREATE INDEX "Profile_role_idx" ON "Profile"("role");

-- CreateIndex
CREATE INDEX "VerificationRequest_status_requestedAt_idx" ON "VerificationRequest"("status", "requestedAt");

-- CreateIndex
CREATE INDEX "VerificationRequest_profileId_idx" ON "VerificationRequest"("profileId");

-- CreateIndex
CREATE INDEX "VerificationRequest_profileId_status_idx" ON "VerificationRequest"("profileId", "status");

-- CreateIndex
CREATE INDEX "Rating_rateeId_dimension_idx" ON "Rating"("rateeId", "dimension");

-- CreateIndex
CREATE INDEX "Rating_threadId_idx" ON "Rating"("threadId");

-- CreateIndex
CREATE UNIQUE INDEX "Rating_threadId_raterId_dimension_key" ON "Rating"("threadId", "raterId", "dimension");

-- CreateIndex
CREATE INDEX "SavedSearch_userId_createdAt_idx" ON "SavedSearch"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "SavedSearch_userId_name_idx" ON "SavedSearch"("userId", "name");

-- CreateIndex
CREATE INDEX "WantedResponse_threadId_createdAt_idx" ON "WantedResponse"("threadId", "createdAt");

-- CreateIndex
CREATE INDEX "WantedResponse_lotId_status_idx" ON "WantedResponse"("lotId", "status");

-- CreateIndex
CREATE INDEX "WantedResponse_parentResponseId_idx" ON "WantedResponse"("parentResponseId");

-- CreateIndex
CREATE INDEX "WantedResponse_status_acceptedAt_idx" ON "WantedResponse"("status", "acceptedAt");

-- AddForeignKey
ALTER TABLE "ThreadReadState" ADD CONSTRAINT "ThreadReadState_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "MessageThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "MessageThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ThreadParticipant" ADD CONSTRAINT "ThreadParticipant_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "MessageThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_parentOfferId_fkey" FOREIGN KEY ("parentOfferId") REFERENCES "Offer"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "WantedResponse" ADD CONSTRAINT "WantedResponse_parentResponseId_fkey" FOREIGN KEY ("parentResponseId") REFERENCES "WantedResponse"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
