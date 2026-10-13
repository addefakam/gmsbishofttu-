import pg from "pg";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const { Client } = pg;

// ─── Enum types ────────────────────────────────────────────────────────────
const ENUMS_SQL = `
DO $$ BEGIN CREATE TYPE "UserRole" AS ENUM ('POLICE','SUPERUSER','OPERATOR','STAFF'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "ProviderStatus" AS ENUM ('PENDING','APPROVED','REJECTED','SUSPENDED'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "RoomType" AS ENUM ('SINGLE','DOUBLE','TWIN','SUITE','DELUXE','KING','STANDARD','STANDARD_SUITE','JUNIOR_SUITE','EXECUTIVE_SUITE','PRESIDENTIAL_SUITE'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "RoomStatus" AS ENUM ('AVAILABLE','OCCUPIED','MAINTENANCE','RESERVED'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "PaymentStatusType" AS ENUM ('PAID','PARTIAL','PENDING'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "PaymentMethodType" AS ENUM ('CASH','TRANSFER','CARD','MOBILE'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "ReservationStatus" AS ENUM ('UPCOMING','ACTIVE','COMPLETED','CANCELLED','DELETED'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TYPE "ReservationStatus" ADD VALUE IF NOT EXISTS 'DELETED'; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "NotificationType" AS ENUM ('INFO','WARNING','SUCCESS','ERROR'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "HousekeepingTaskType" AS ENUM ('CLEANING','MAINTENANCE','INSPECTION'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "HousekeepingTaskStatus" AS ENUM ('PENDING','IN_PROGRESS','COMPLETED'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "TaskStatus" AS ENUM ('PENDING','IN_PROGRESS','COMPLETED','CANCELLED'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "TaskPriority" AS ENUM ('LOW','MEDIUM','HIGH','URGENT'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "SuspectSeverity" AS ENUM ('LOW','MEDIUM','HIGH','CRITICAL'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "SubscriptionCycle" AS ENUM ('MONTHLY','QUARTERLY','SEMI_ANNUAL','YEARLY'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "GroupBookingStatus" AS ENUM ('PENDING','CONFIRMED','IN_PROGRESS','COMPLETED','CANCELLED'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "MessageChannel" AS ENUM ('SMS','WHATSAPP'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "MessageStatus" AS ENUM ('PENDING','SENT','FAILED','DELIVERED'); EXCEPTION WHEN duplicate_object THEN null; END $$;
`;

// ─── Table creation ────────────────────────────────────────────────────────
const TABLES_SQL = `
CREATE TABLE IF NOT EXISTS "Provider" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "ownerName" TEXT NOT NULL,
  "phone" TEXT NOT NULL,
  "email" TEXT NOT NULL DEFAULT '',
  "address" TEXT NOT NULL DEFAULT '',
  "type" TEXT NOT NULL DEFAULT 'GUEST_HOUSE',
  "licenseNo" TEXT NOT NULL DEFAULT '',
  "licenseFile" TEXT NOT NULL DEFAULT '',
  "status" "ProviderStatus" NOT NULL DEFAULT 'PENDING',
  "latitude" DOUBLE PRECISION NOT NULL DEFAULT 9.02,
  "longitude" DOUBLE PRECISION NOT NULL DEFAULT 38.75,
  "approvedBy" TEXT,
  "approvedAt" TIMESTAMP(3),
  "rejectionReason" TEXT NOT NULL DEFAULT '',
  "suspensionReason" TEXT NOT NULL DEFAULT '',
  "suspendedAt" TIMESTAMP(3),
  "suspendedBy" TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS "User" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "username" TEXT NOT NULL,
  "password" TEXT NOT NULL,
  "role" "UserRole" NOT NULL DEFAULT 'STAFF',
  "name" TEXT NOT NULL,
  "email" TEXT DEFAULT '',
  "phone" TEXT DEFAULT '',
  "permissions" TEXT NOT NULL DEFAULT '["reservations","guests"]',
  "policeRank" TEXT NOT NULL DEFAULT '',
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "lastLogin" TIMESTAMP(3),
  "providerId" TEXT,
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "User_username_key" UNIQUE ("username")
);
DO $$ BEGIN CREATE INDEX "User_createdBy_idx" ON "User"("createdBy"); EXCEPTION WHEN duplicate_object THEN null; END $$;
CREATE TABLE IF NOT EXISTS "Room" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "number" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "type" "RoomType" NOT NULL,
  "pricePerNight" DOUBLE PRECISION NOT NULL,
  "pricePerNightWeekend" DOUBLE PRECISION,
  "floor" INTEGER NOT NULL,
  "capacity" INTEGER NOT NULL,
  "status" "RoomStatus" NOT NULL DEFAULT 'AVAILABLE',
  "amenities" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "image" TEXT,
  "providerId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Room_number_providerId_key" UNIQUE ("number", "providerId")
);
CREATE TABLE IF NOT EXISTS "Guest" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "phone" TEXT NOT NULL,
  "email" TEXT NOT NULL DEFAULT '',
  "idNumber" TEXT NOT NULL DEFAULT '',
  "idType" TEXT NOT NULL DEFAULT '',
  "nationality" TEXT NOT NULL DEFAULT '',
  "region" TEXT NOT NULL DEFAULT '',
  "zone" TEXT NOT NULL DEFAULT '',
  "woreda" TEXT NOT NULL DEFAULT '',
  "kebele" TEXT NOT NULL DEFAULT '',
  "houseNumber" TEXT NOT NULL DEFAULT '',
  "streetName" TEXT NOT NULL DEFAULT '',
  "plateNumber" TEXT NOT NULL DEFAULT '',
  "weapon" TEXT NOT NULL DEFAULT '',
  "address" TEXT NOT NULL DEFAULT '',
  "notes" TEXT NOT NULL DEFAULT '',
  "vip" BOOLEAN NOT NULL DEFAULT false,
  "totalSpent" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "totalStays" INTEGER NOT NULL DEFAULT 0,
  "providerId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS "Reservation" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "guestId" TEXT NOT NULL,
  "roomId" TEXT NOT NULL,
  "checkIn" TEXT NOT NULL,
  "checkOut" TEXT NOT NULL,
  "nights" INTEGER NOT NULL,
  "roomRate" DOUBLE PRECISION NOT NULL,
  "totalCost" DOUBLE PRECISION NOT NULL,
  "paidAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "balance" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "paymentStatus" "PaymentStatusType" NOT NULL DEFAULT 'PENDING',
  "paymentMethod" "PaymentMethodType",
  "status" "ReservationStatus" NOT NULL DEFAULT 'UPCOMING',
  "notes" TEXT NOT NULL DEFAULT '',
  "actualCheckIn" TIMESTAMP(3),
  "actualCheckOut" TIMESTAMP(3),
  "taxAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "discountAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "secondGuestName" TEXT NOT NULL DEFAULT '',
  "secondGuestPhone" TEXT NOT NULL DEFAULT '',
  "secondGuestIdNumber" TEXT NOT NULL DEFAULT '',
  "exceptionallyReserved" BOOLEAN NOT NULL DEFAULT false,
  "exceptionReason" TEXT NOT NULL DEFAULT '',
  "providerId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS "DaytimeService" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "price" DOUBLE PRECISION NOT NULL,
  "category" TEXT NOT NULL,
  "duration" TEXT NOT NULL DEFAULT '',
  "description" TEXT NOT NULL DEFAULT '',
  "active" BOOLEAN NOT NULL DEFAULT true,
  "providerId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS "DaytimeBooking" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "serviceId" TEXT NOT NULL,
  "guestName" TEXT NOT NULL,
  "guestPhone" TEXT NOT NULL,
  "date" TEXT NOT NULL,
  "time" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL DEFAULT 1,
  "unitPrice" DOUBLE PRECISION NOT NULL,
  "totalCost" DOUBLE PRECISION NOT NULL,
  "paidAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "paymentStatus" "PaymentStatusType" NOT NULL DEFAULT 'PENDING',
  "paymentMethod" "PaymentMethodType",
  "notes" TEXT NOT NULL DEFAULT '',
  "providerId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS "Expense" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "date" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "amount" DOUBLE PRECISION NOT NULL,
  "vendor" TEXT NOT NULL DEFAULT '',
  "paymentMethod" "PaymentMethodType" NOT NULL,
  "receiptNo" TEXT NOT NULL DEFAULT '',
  "taxAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "providerId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS "ExpenseCategory" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "nameAm" TEXT NOT NULL,
  "color" TEXT NOT NULL,
  "icon" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS "Resource" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "quantity" DOUBLE PRECISION NOT NULL,
  "unit" TEXT NOT NULL,
  "minLevel" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "costPerUnit" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "supplier" TEXT NOT NULL DEFAULT '',
  "lastRestocked" TIMESTAMP(3),
  "providerId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS "Payment" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "reservationId" TEXT,
  "daytimeBookingId" TEXT,
  "amount" DOUBLE PRECISION NOT NULL,
  "method" "PaymentMethodType" NOT NULL,
  "referenceNo" TEXT NOT NULL DEFAULT '',
  "notes" TEXT NOT NULL DEFAULT '',
  "providerId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS "Notification" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "title" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "type" "NotificationType" NOT NULL DEFAULT 'INFO',
  "isRead" BOOLEAN NOT NULL DEFAULT false,
  "link" TEXT,
  "providerId" TEXT,
  "userId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS "HousekeepingTask" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "roomId" TEXT NOT NULL,
  "type" "HousekeepingTaskType" NOT NULL,
  "status" "HousekeepingTaskStatus" NOT NULL DEFAULT 'PENDING',
  "assignedTo" TEXT,
  "scheduledDate" TEXT NOT NULL,
  "notes" TEXT NOT NULL DEFAULT '',
  "completedAt" TIMESTAMP(3),
  "providerId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS "Review" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "guestId" TEXT NOT NULL,
  "reservationId" TEXT NOT NULL,
  "rating" INTEGER NOT NULL,
  "comment" TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS "ActivityLog" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "message" TEXT NOT NULL,
  "type" TEXT NOT NULL DEFAULT 'INFO',
  "providerId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS "Settings" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "guestHouseName" TEXT NOT NULL DEFAULT 'Guest House',
  "ownerName" TEXT NOT NULL DEFAULT '',
  "address" TEXT NOT NULL DEFAULT '',
  "phone" TEXT NOT NULL DEFAULT '',
  "email" TEXT NOT NULL DEFAULT '',
  "currency" TEXT NOT NULL DEFAULT 'ETB',
  "taxRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "language" TEXT NOT NULL DEFAULT 'en',
  "logo" TEXT,
  "checkInTime" TEXT NOT NULL DEFAULT '14:00',
  "checkOutTime" TEXT NOT NULL DEFAULT '12:00',
  "configJson" JSONB,
  "providerId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS "SuspectedPerson" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "phone" TEXT NOT NULL DEFAULT '',
  "idNumber" TEXT NOT NULL DEFAULT '',
  "idType" TEXT NOT NULL DEFAULT '',
  "nationality" TEXT NOT NULL DEFAULT '',
  "address" TEXT NOT NULL DEFAULT '',
  "description" TEXT NOT NULL DEFAULT '',
  "severity" "SuspectSeverity" NOT NULL DEFAULT 'MEDIUM',
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "registeredBy" TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS "SuspectMatch" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "suspectedPersonId" TEXT NOT NULL,
  "matchType" TEXT NOT NULL,
  "guestName" TEXT NOT NULL,
  "guestPhone" TEXT NOT NULL DEFAULT '',
  "guestIdNumber" TEXT NOT NULL DEFAULT '',
  "providerName" TEXT NOT NULL DEFAULT '',
  "providerId" TEXT NOT NULL DEFAULT '',
  "reservationId" TEXT,
  "daytimeBookingId" TEXT,
  "details" TEXT NOT NULL DEFAULT '',
  "isRead" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS "AuditLog" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "officerName" TEXT NOT NULL DEFAULT '',
  "action" TEXT NOT NULL,
  "targetId" TEXT,
  "targetType" TEXT DEFAULT '',
  "details" TEXT,
  "ipAddress" TEXT DEFAULT '',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS "Geofence" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "address" TEXT NOT NULL DEFAULT '',
  "latitude" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "longitude" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "radius" DOUBLE PRECISION NOT NULL DEFAULT 1000,
  "severity" TEXT NOT NULL DEFAULT 'HIGH',
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS "FrequentStayAlert" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "guestName" TEXT NOT NULL,
  "guestPhone" TEXT NOT NULL DEFAULT '',
  "guestIdNumber" TEXT NOT NULL DEFAULT '',
  "providerNames" TEXT NOT NULL DEFAULT '[]',
  "stayCount" INTEGER NOT NULL DEFAULT 0,
  "avgDaysBetween" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "riskLevel" TEXT NOT NULL DEFAULT 'MEDIUM',
  "isReviewed" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS "Subscription" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "providerId" TEXT NOT NULL,
  "startDate" TIMESTAMP(3) NOT NULL,
  "endDate" TIMESTAMP(3) NOT NULL,
  "cycle" "SubscriptionCycle" NOT NULL DEFAULT 'MONTHLY',
  "price" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Subscription_providerId_key" UNIQUE ("providerId")
);
CREATE TABLE IF NOT EXISTS "SubscriptionPayment" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "subscriptionId" TEXT NOT NULL,
  "amount" DOUBLE PRECISION NOT NULL,
  "cycle" "SubscriptionCycle" NOT NULL,
  "periodStart" TIMESTAMP(3) NOT NULL,
  "periodEnd" TIMESTAMP(3) NOT NULL,
  "markedBy" TEXT NOT NULL,
  "notes" TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS "SubscriptionPlan" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "cycle" "SubscriptionCycle" NOT NULL,
  "price" DOUBLE PRECISION NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS "PoliceAlertConfig" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "emailEnabled" BOOLEAN NOT NULL DEFAULT false,
  "emailRecipients" TEXT NOT NULL DEFAULT '[]',
  "smsEnabled" BOOLEAN NOT NULL DEFAULT false,
  "smsRecipients" TEXT NOT NULL DEFAULT '[]',
  "escalationDelayMins" INTEGER NOT NULL DEFAULT 60,
  "criticalImmediate" BOOLEAN NOT NULL DEFAULT true,
  "anomalyDetectionEnabled" BOOLEAN NOT NULL DEFAULT false,
  "disabledOperatorPages" TEXT NOT NULL DEFAULT '[]',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS "NotificationBroadcast" (
  "id"            TEXT NOT NULL PRIMARY KEY,
  "title"         TEXT NOT NULL,
  "message"       TEXT NOT NULL,
  "channel"       TEXT NOT NULL DEFAULT 'IN_APP',
  "priority"      TEXT NOT NULL DEFAULT 'NORMAL',
  "targetType"    TEXT NOT NULL DEFAULT 'ALL_PROVIDERS',
  "targetIds"     TEXT NOT NULL DEFAULT '[]',
  "sentBy"        TEXT NOT NULL DEFAULT '',
  "sentByName"    TEXT NOT NULL DEFAULT '',
  "totalSent"     INTEGER NOT NULL DEFAULT 0,
  "totalFailed"   INTEGER NOT NULL DEFAULT 0,
  "status"        TEXT NOT NULL DEFAULT 'COMPLETED',
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`;

// ─── Foreign Keys ──────────────────────────────────────────────────────────
const FKS_SQL = `
DO $$ BEGIN ALTER TABLE "User" ADD CONSTRAINT "User_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "Room" ADD CONSTRAINT "Room_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "Guest" ADD CONSTRAINT "Guest_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "Guest"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "DaytimeService" ADD CONSTRAINT "DaytimeService_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "DaytimeBooking" ADD CONSTRAINT "DaytimeBooking_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "DaytimeBooking" ADD CONSTRAINT "DaytimeBooking_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "DaytimeService"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "Expense" ADD CONSTRAINT "Expense_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "Resource" ADD CONSTRAINT "Resource_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "Payment" ADD CONSTRAINT "Payment_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "Payment" ADD CONSTRAINT "Payment_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "Payment" ADD CONSTRAINT "Payment_daytimeBookingId_fkey" FOREIGN KEY ("daytimeBookingId") REFERENCES "DaytimeBooking"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "Notification" ADD CONSTRAINT "Notification_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "HousekeepingTask" ADD CONSTRAINT "HousekeepingTask_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "HousekeepingTask" ADD CONSTRAINT "HousekeepingTask_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "Review" ADD CONSTRAINT "Review_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "Guest"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "Review" ADD CONSTRAINT "Review_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "Settings" ADD COLUMN "configJson" JSONB; EXCEPTION WHEN duplicate_column THEN null; END $$;
DO $$ BEGIN ALTER TABLE "Settings" ADD CONSTRAINT "Settings_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "SuspectMatch" ADD CONSTRAINT "SuspectMatch_suspectedPersonId_fkey" FOREIGN KEY ("suspectedPersonId") REFERENCES "SuspectedPerson"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "SubscriptionPayment" ADD CONSTRAINT "SubscriptionPayment_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES "SubscriptionPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "GroupBooking" ADD CONSTRAINT "GroupBooking_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "StaffLog" ADD CONSTRAINT "StaffLog_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "MessageTemplate" ADD CONSTRAINT "MessageTemplate_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "MessageLog" ADD CONSTRAINT "MessageLog_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "MessageLog" ADD CONSTRAINT "MessageLog_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "MessageTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_groupBookingId_fkey" FOREIGN KEY ("groupBookingId") REFERENCES "GroupBooking"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;
`;

// ─── Migrations: Add new columns to existing tables ────────────────
const MIGRATIONS_SQL = `
-- Add email, phone, isActive, lastLogin, permissions, policeRank to User table if missing
DO $$ BEGIN
  ALTER TABLE "User" ADD COLUMN "email" TEXT DEFAULT '';
EXCEPTION WHEN duplicate_column THEN null;
END $$;
DO $$ BEGIN
  ALTER TABLE "User" ADD COLUMN "phone" TEXT DEFAULT '';
EXCEPTION WHEN duplicate_column THEN null;
END $$;
DO $$ BEGIN
  ALTER TABLE "User" ADD COLUMN "permissions" TEXT NOT NULL DEFAULT '["reservations","guests"]';
EXCEPTION WHEN duplicate_column THEN null;
END $$;
DO $$ BEGIN
  ALTER TABLE "User" ADD COLUMN "policeRank" TEXT NOT NULL DEFAULT '';
EXCEPTION WHEN duplicate_column THEN null;
END $$;
DO $$ BEGIN
  ALTER TABLE "User" ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true;
EXCEPTION WHEN duplicate_column THEN null;
END $$;
DO $$ BEGIN
  ALTER TABLE "User" ADD COLUMN "lastLogin" TIMESTAMP(3);
EXCEPTION WHEN duplicate_column THEN null;
END $$;
DO $$ BEGIN
  ALTER TABLE "User" ADD COLUMN "createdBy" TEXT;
EXCEPTION WHEN duplicate_column THEN null;
END $$;
DO $$ BEGIN
  ALTER TABLE "Guest" ADD COLUMN "region" TEXT NOT NULL DEFAULT '';
EXCEPTION WHEN duplicate_column THEN null;
END $$;
DO $$ BEGIN
  ALTER TABLE "Guest" ADD COLUMN "zone" TEXT NOT NULL DEFAULT '';
EXCEPTION WHEN duplicate_column THEN null;
END $$;
DO $$ BEGIN
  ALTER TABLE "Guest" ADD COLUMN "woreda" TEXT NOT NULL DEFAULT '';
EXCEPTION WHEN duplicate_column THEN null;
END $$;
DO $$ BEGIN
  ALTER TABLE "Guest" ADD COLUMN "kebele" TEXT NOT NULL DEFAULT '';
EXCEPTION WHEN duplicate_column THEN null;
END $$;
DO $$ BEGIN
  ALTER TABLE "Guest" ADD COLUMN "houseNumber" TEXT NOT NULL DEFAULT '';
EXCEPTION WHEN duplicate_column THEN null;
END $$;
DO $$ BEGIN
  ALTER TABLE "Guest" ADD COLUMN "streetName" TEXT NOT NULL DEFAULT '';
EXCEPTION WHEN duplicate_column THEN null;
END $$;
DO $$ BEGIN
  ALTER TABLE "Guest" ADD COLUMN "plateNumber" TEXT NOT NULL DEFAULT '';
EXCEPTION WHEN duplicate_column THEN null;
END $$;
DO $$ BEGIN
  ALTER TABLE "Guest" ADD COLUMN "weapon" TEXT NOT NULL DEFAULT '';
EXCEPTION WHEN duplicate_column THEN null;
END $$;
DO $$ BEGIN
  ALTER TABLE "Subscription" ADD COLUMN "planId" TEXT;
EXCEPTION WHEN duplicate_column THEN null;
END $$;
DO $$ BEGIN
  ALTER TABLE "Provider" ADD COLUMN "suspensionReason" TEXT NOT NULL DEFAULT '';
EXCEPTION WHEN duplicate_column THEN null;
END $$;
DO $$ BEGIN
  ALTER TABLE "Provider" ADD COLUMN "suspendedAt" TIMESTAMP(3);
EXCEPTION WHEN duplicate_column THEN null;
END $$;
DO $$ BEGIN
  ALTER TABLE "Provider" ADD COLUMN "suspendedBy" TEXT NOT NULL DEFAULT '';
EXCEPTION WHEN duplicate_column THEN null;
END $$;
DO $$ BEGIN
  ALTER TABLE "Reservation" ADD COLUMN "groupBookingId" TEXT;
EXCEPTION WHEN duplicate_column THEN null;
END $$;
DO $$ BEGIN
  ALTER TABLE "Reservation" ADD COLUMN "secondGuestName" TEXT NOT NULL DEFAULT '';
EXCEPTION WHEN duplicate_column THEN null;
END $$;
DO $$ BEGIN
  ALTER TABLE "Reservation" ADD COLUMN "secondGuestPhone" TEXT NOT NULL DEFAULT '';
EXCEPTION WHEN duplicate_column THEN null;
END $$;
DO $$ BEGIN
  ALTER TABLE "Reservation" ADD COLUMN "secondGuestIdNumber" TEXT NOT NULL DEFAULT '';
EXCEPTION WHEN duplicate_column THEN null;
END $$;
DO $$ BEGIN
  ALTER TABLE "Reservation" ADD COLUMN "exceptionallyReserved" BOOLEAN NOT NULL DEFAULT false;
EXCEPTION WHEN duplicate_column THEN null;
END $$;
DO $$ BEGIN
  ALTER TABLE "Reservation" ADD COLUMN "exceptionReason" TEXT NOT NULL DEFAULT '';
EXCEPTION WHEN duplicate_column THEN null;
END $$;
DO $$ BEGIN
  ALTER TABLE "Provider" ADD COLUMN "telegramChatId" TEXT;
EXCEPTION WHEN duplicate_column THEN null;
END $$;
DO $$ BEGIN
  ALTER TABLE "PoliceAlertConfig" ADD COLUMN "disabledOperatorPages" TEXT NOT NULL DEFAULT '[]';
EXCEPTION WHEN duplicate_column THEN null;
END $$;
CREATE TABLE IF NOT EXISTS "GroupBooking" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "contactName" TEXT NOT NULL DEFAULT '',
  "contactPhone" TEXT NOT NULL DEFAULT '',
  "contactEmail" TEXT NOT NULL DEFAULT '',
  "startDate" TEXT NOT NULL,
  "endDate" TEXT NOT NULL,
  "notes" TEXT NOT NULL DEFAULT '',
  "status" "GroupBookingStatus" NOT NULL DEFAULT 'PENDING',
  "totalRooms" INTEGER NOT NULL DEFAULT 0,
  "totalGuests" INTEGER NOT NULL DEFAULT 0,
  "totalCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "discountType" TEXT NOT NULL DEFAULT 'AMOUNT',
  "discountAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "providerId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS "StaffLog" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "userName" TEXT NOT NULL DEFAULT '',
  "action" TEXT NOT NULL,
  "targetType" TEXT NOT NULL DEFAULT '',
  "targetId" TEXT NOT NULL DEFAULT '',
  "details" TEXT NOT NULL DEFAULT '',
  "ipAddress" TEXT NOT NULL DEFAULT '',
  "providerId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ─── Tasks table — formal staff work assignments ──────────────────────────
-- Created in init-db.ts so the table is always available even on databases
-- that were provisioned before the Task model was added to the Prisma schema.
CREATE TABLE IF NOT EXISTS "Task" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "title" TEXT NOT NULL,
  "description" TEXT NOT NULL DEFAULT '',
  "status" "TaskStatus" NOT NULL DEFAULT 'PENDING',
  "priority" "TaskPriority" NOT NULL DEFAULT 'MEDIUM',
  "category" TEXT NOT NULL DEFAULT 'General',
  "dueDate" TEXT NOT NULL DEFAULT '',
  "assignedToUserId" TEXT,
  "assignedByUserId" TEXT,
  "completedByUserId" TEXT,
  "completedAt" TIMESTAMP(3),
  "providerId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Task_provider_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE RESTRICT,
  CONSTRAINT "Task_assignedTo_fkey" FOREIGN KEY ("assignedToUserId") REFERENCES "User"("id") ON DELETE SET NULL,
  CONSTRAINT "Task_assignedBy_fkey" FOREIGN KEY ("assignedByUserId") REFERENCES "User"("id") ON DELETE SET NULL,
  CONSTRAINT "Task_completedBy_fkey" FOREIGN KEY ("completedByUserId") REFERENCES "User"("id") ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS "Task_providerId_idx" ON "Task" ("providerId");
CREATE INDEX IF NOT EXISTS "Task_assignedToUserId_idx" ON "Task" ("assignedToUserId");
CREATE INDEX IF NOT EXISTS "Task_status_idx" ON "Task" ("status");
CREATE INDEX IF NOT EXISTS "Task_priority_idx" ON "Task" ("priority");
CREATE INDEX IF NOT EXISTS "Task_dueDate_idx" ON "Task" ("dueDate");
CREATE INDEX IF NOT EXISTS "Task_provider_status_idx" ON "Task" ("providerId", "status");
CREATE INDEX IF NOT EXISTS "Task_provider_assignee_status_idx" ON "Task" ("providerId", "assignedToUserId", "status");

CREATE TABLE IF NOT EXISTS "MessageTemplate" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "channel" "MessageChannel" NOT NULL DEFAULT 'SMS',
  "subject" TEXT NOT NULL DEFAULT '',
  "body" TEXT NOT NULL,
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "providerId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS "MessageLog" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "templateId" TEXT,
  "recipient" TEXT NOT NULL,
  "channel" "MessageChannel" NOT NULL DEFAULT 'SMS',
  "message" TEXT NOT NULL,
  "status" "MessageStatus" NOT NULL DEFAULT 'PENDING',
  "errorMessage" TEXT NOT NULL DEFAULT '',
  "reservationId" TEXT,
  "guestId" TEXT,
  "providerId" TEXT NOT NULL,
  "sentAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ─── Certificate of Registration columns on Provider ───────────────
DO $$ BEGIN ALTER TABLE "Provider" ADD COLUMN "certNumber" TEXT; EXCEPTION WHEN duplicate_column THEN null; END $$;
DO $$ BEGIN ALTER TABLE "Provider" ADD COLUMN "certIssuedAt" TIMESTAMP(3); EXCEPTION WHEN duplicate_column THEN null; END $$;
DO $$ BEGIN ALTER TABLE "Provider" ADD COLUMN "certIssuedBy" TEXT; EXCEPTION WHEN duplicate_column THEN null; END $$;
DO $$ BEGIN ALTER TABLE "Provider" ADD COLUMN "certIssuedByName" TEXT; EXCEPTION WHEN duplicate_column THEN null; END $$;

-- ─── PasswordResetToken table ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS "PasswordResetToken" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "token" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "PasswordResetToken_token_key" ON "PasswordResetToken" ("token");
CREATE INDEX IF NOT EXISTS "PasswordResetToken_userId_idx" ON "PasswordResetToken" ("userId");

-- ─── RoomType enum — add new values for existing databases ──────────
-- The CREATE TYPE in ENUMS_SQL only runs on fresh databases. For existing
-- databases, we ALTER TYPE ADD VALUE to add the new room types.
-- IF NOT EXISTS prevents errors on re-run (PostgreSQL 9.3+).
DO $$ BEGIN ALTER TYPE "RoomType" ADD VALUE IF NOT EXISTS 'KING'; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TYPE "RoomType" ADD VALUE IF NOT EXISTS 'STANDARD'; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TYPE "RoomType" ADD VALUE IF NOT EXISTS 'STANDARD_SUITE'; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TYPE "RoomType" ADD VALUE IF NOT EXISTS 'JUNIOR_SUITE'; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TYPE "RoomType" ADD VALUE IF NOT EXISTS 'EXECUTIVE_SUITE'; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TYPE "RoomType" ADD VALUE IF NOT EXISTS 'PRESIDENTIAL_SUITE'; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "Room" ADD COLUMN "pricePerNightWeekend" DOUBLE PRECISION; EXCEPTION WHEN duplicate_column THEN null; END $$;
DO $$ BEGIN ALTER TABLE "GroupBooking" ADD COLUMN "discountType" TEXT NOT NULL DEFAULT 'AMOUNT'; EXCEPTION WHEN duplicate_column THEN null; END $$;
DO $$ BEGIN ALTER TABLE "GroupBooking" ADD COLUMN "discountAmount" DOUBLE PRECISION NOT NULL DEFAULT 0; EXCEPTION WHEN duplicate_column THEN null; END $$;
DO $$ BEGIN ALTER TABLE "Expense" ADD COLUMN "stockMovementId" TEXT; EXCEPTION WHEN duplicate_column THEN null; END $$;
CREATE INDEX IF NOT EXISTS "Expense_stockMovementId_idx" ON "Expense" ("stockMovementId");
DO $$ BEGIN ALTER TABLE "Provider" ADD COLUMN "bedCount" INTEGER; EXCEPTION WHEN duplicate_column THEN null; END $$;
DO $$ BEGIN ALTER TABLE "Provider" ADD COLUMN "subCity" TEXT NOT NULL DEFAULT ''; EXCEPTION WHEN duplicate_column THEN null; END $$;
DO $$ BEGIN ALTER TABLE "Provider" ADD COLUMN "woreda" TEXT NOT NULL DEFAULT ''; EXCEPTION WHEN duplicate_column THEN null; END $$;
DO $$ BEGIN ALTER TABLE "User" ADD COLUMN "jurisdictionType" TEXT NOT NULL DEFAULT 'CITY'; EXCEPTION WHEN duplicate_column THEN null; END $$;
DO $$ BEGIN ALTER TABLE "User" ADD COLUMN "subCity" TEXT; EXCEPTION WHEN duplicate_column THEN null; END $$;
DO $$ BEGIN ALTER TABLE "User" ADD COLUMN "woreda" TEXT; EXCEPTION WHEN duplicate_column THEN null; END $$;
CREATE INDEX IF NOT EXISTS "User_jurisdictionType_idx" ON "User" ("jurisdictionType");
CREATE INDEX IF NOT EXISTS "User_subCity_idx" ON "User" ("subCity");
CREATE INDEX IF NOT EXISTS "User_woreda_idx" ON "User" ("woreda");


`;

// ─── Indexes ───────────────────────────────────────────────────────────────
const INDEXES_SQL = `
CREATE INDEX IF NOT EXISTS "Provider_status_idx" ON "Provider" ("status");
CREATE INDEX IF NOT EXISTS "Provider_createdAt_idx" ON "Provider" ("createdAt");
CREATE INDEX IF NOT EXISTS "User_providerId_idx" ON "User" ("providerId");
CREATE INDEX IF NOT EXISTS "User_role_idx" ON "User" ("role");
CREATE INDEX IF NOT EXISTS "User_isActive_idx" ON "User" ("isActive");
CREATE INDEX IF NOT EXISTS "Room_providerId_idx" ON "Room" ("providerId");
CREATE INDEX IF NOT EXISTS "Room_status_idx" ON "Room" ("status");
CREATE INDEX IF NOT EXISTS "Guest_providerId_idx" ON "Guest" ("providerId");
CREATE INDEX IF NOT EXISTS "Guest_phone_idx" ON "Guest" ("phone");
CREATE INDEX IF NOT EXISTS "Guest_idNumber_idx" ON "Guest" ("idNumber");
CREATE INDEX IF NOT EXISTS "Guest_email_idx" ON "Guest" ("email");
CREATE INDEX IF NOT EXISTS "Guest_createdAt_idx" ON "Guest" ("createdAt");
CREATE INDEX IF NOT EXISTS "Guest_name_idx" ON "Guest" ("name");
CREATE INDEX IF NOT EXISTS "Guest_region_idx" ON "Guest" ("region");
CREATE INDEX IF NOT EXISTS "Guest_zone_idx" ON "Guest" ("zone");
CREATE INDEX IF NOT EXISTS "Guest_woreda_idx" ON "Guest" ("woreda");
CREATE INDEX IF NOT EXISTS "Reservation_providerId_idx" ON "Reservation" ("providerId");
CREATE INDEX IF NOT EXISTS "Reservation_guestId_idx" ON "Reservation" ("guestId");
CREATE INDEX IF NOT EXISTS "Reservation_roomId_idx" ON "Reservation" ("roomId");
CREATE INDEX IF NOT EXISTS "Reservation_status_idx" ON "Reservation" ("status");
CREATE INDEX IF NOT EXISTS "Reservation_createdAt_idx" ON "Reservation" ("createdAt");
CREATE INDEX IF NOT EXISTS "Reservation_checkIn_idx" ON "Reservation" ("checkIn");
CREATE INDEX IF NOT EXISTS "DaytimeService_providerId_idx" ON "DaytimeService" ("providerId");
CREATE INDEX IF NOT EXISTS "DaytimeBooking_providerId_idx" ON "DaytimeBooking" ("providerId");
CREATE INDEX IF NOT EXISTS "DaytimeBooking_serviceId_idx" ON "DaytimeBooking" ("serviceId");
CREATE INDEX IF NOT EXISTS "DaytimeBooking_guestPhone_idx" ON "DaytimeBooking" ("guestPhone");
CREATE INDEX IF NOT EXISTS "DaytimeBooking_date_idx" ON "DaytimeBooking" ("date");
CREATE INDEX IF NOT EXISTS "DaytimeBooking_createdAt_idx" ON "DaytimeBooking" ("createdAt");
CREATE INDEX IF NOT EXISTS "Expense_providerId_idx" ON "Expense" ("providerId");
CREATE INDEX IF NOT EXISTS "Expense_date_idx" ON "Expense" ("date");
CREATE INDEX IF NOT EXISTS "Expense_category_idx" ON "Expense" ("category");
CREATE INDEX IF NOT EXISTS "Resource_providerId_idx" ON "Resource" ("providerId");
CREATE INDEX IF NOT EXISTS "Resource_category_idx" ON "Resource" ("category");
CREATE INDEX IF NOT EXISTS "Payment_providerId_idx" ON "Payment" ("providerId");
CREATE INDEX IF NOT EXISTS "Payment_reservationId_idx" ON "Payment" ("reservationId");
CREATE INDEX IF NOT EXISTS "Payment_daytimeBookingId_idx" ON "Payment" ("daytimeBookingId");
CREATE INDEX IF NOT EXISTS "Payment_createdAt_idx" ON "Payment" ("createdAt");
CREATE INDEX IF NOT EXISTS "Notification_providerId_idx" ON "Notification" ("providerId");
CREATE INDEX IF NOT EXISTS "Notification_userId_idx" ON "Notification" ("userId");
CREATE INDEX IF NOT EXISTS "Notification_isRead_idx" ON "Notification" ("isRead");
CREATE INDEX IF NOT EXISTS "Notification_createdAt_idx" ON "Notification" ("createdAt");
CREATE INDEX IF NOT EXISTS "HousekeepingTask_providerId_idx" ON "HousekeepingTask" ("providerId");
CREATE INDEX IF NOT EXISTS "HousekeepingTask_roomId_idx" ON "HousekeepingTask" ("roomId");
CREATE INDEX IF NOT EXISTS "HousekeepingTask_status_idx" ON "HousekeepingTask" ("status");
CREATE INDEX IF NOT EXISTS "HousekeepingTask_scheduledDate_idx" ON "HousekeepingTask" ("scheduledDate");
CREATE INDEX IF NOT EXISTS "Review_guestId_idx" ON "Review" ("guestId");
CREATE INDEX IF NOT EXISTS "Review_reservationId_idx" ON "Review" ("reservationId");
CREATE INDEX IF NOT EXISTS "Review_createdAt_idx" ON "Review" ("createdAt");
CREATE INDEX IF NOT EXISTS "ActivityLog_providerId_idx" ON "ActivityLog" ("providerId");
CREATE INDEX IF NOT EXISTS "ActivityLog_createdAt_idx" ON "ActivityLog" ("createdAt");
CREATE INDEX IF NOT EXISTS "Settings_providerId_idx" ON "Settings" ("providerId");
CREATE INDEX IF NOT EXISTS "SuspectedPerson_name_idx" ON "SuspectedPerson" ("name");
CREATE INDEX IF NOT EXISTS "SuspectedPerson_phone_idx" ON "SuspectedPerson" ("phone");
CREATE INDEX IF NOT EXISTS "SuspectedPerson_idNumber_idx" ON "SuspectedPerson" ("idNumber");
CREATE INDEX IF NOT EXISTS "SuspectedPerson_severity_idx" ON "SuspectedPerson" ("severity");
CREATE INDEX IF NOT EXISTS "SuspectedPerson_is_active_idx" ON "SuspectedPerson" ("is_active");
CREATE INDEX IF NOT EXISTS "SuspectMatch_suspectedPersonId_idx" ON "SuspectMatch" ("suspectedPersonId");
CREATE INDEX IF NOT EXISTS "SuspectMatch_isRead_idx" ON "SuspectMatch" ("isRead");
CREATE INDEX IF NOT EXISTS "SuspectMatch_createdAt_idx" ON "SuspectMatch" ("createdAt");
CREATE INDEX IF NOT EXISTS "SuspectMatch_guestPhone_idx" ON "SuspectMatch" ("guestPhone");
CREATE INDEX IF NOT EXISTS "SuspectMatch_guestIdNumber_idx" ON "SuspectMatch" ("guestIdNumber");
CREATE INDEX IF NOT EXISTS "SuspectMatch_providerId_idx" ON "SuspectMatch" ("providerId");
CREATE INDEX IF NOT EXISTS "AuditLog_action_idx" ON "AuditLog" ("action");
CREATE INDEX IF NOT EXISTS "AuditLog_createdAt_idx" ON "AuditLog" ("createdAt");
CREATE INDEX IF NOT EXISTS "AuditLog_officerName_idx" ON "AuditLog" ("officerName");
CREATE INDEX IF NOT EXISTS "Geofence_isActive_idx" ON "Geofence" ("isActive");
CREATE INDEX IF NOT EXISTS "Geofence_severity_idx" ON "Geofence" ("severity");
CREATE INDEX IF NOT EXISTS "FrequentStayAlert_createdAt_idx" ON "FrequentStayAlert" ("createdAt");
CREATE INDEX IF NOT EXISTS "FrequentStayAlert_isReviewed_idx" ON "FrequentStayAlert" ("isReviewed");
CREATE INDEX IF NOT EXISTS "FrequentStayAlert_riskLevel_idx" ON "FrequentStayAlert" ("riskLevel");
CREATE INDEX IF NOT EXISTS "FrequentStayAlert_guestPhone_idx" ON "FrequentStayAlert" ("guestPhone");
CREATE INDEX IF NOT EXISTS "FrequentStayAlert_guestIdNumber_idx" ON "FrequentStayAlert" ("guestIdNumber");
CREATE INDEX IF NOT EXISTS "Subscription_endDate_idx" ON "Subscription" ("endDate");
CREATE INDEX IF NOT EXISTS "Subscription_planId_idx" ON "Subscription" ("planId");
CREATE INDEX IF NOT EXISTS "SubscriptionPayment_subscriptionId_idx" ON "SubscriptionPayment" ("subscriptionId");
CREATE INDEX IF NOT EXISTS "SubscriptionPayment_createdAt_idx" ON "SubscriptionPayment" ("createdAt");
CREATE INDEX IF NOT EXISTS "SubscriptionPlan_cycle_idx" ON "SubscriptionPlan" ("cycle");
CREATE INDEX IF NOT EXISTS "SubscriptionPlan_isActive_idx" ON "SubscriptionPlan" ("isActive");
-- Composite indexes for common query patterns
CREATE INDEX IF NOT EXISTS "Reservation_providerId_status_idx" ON "Reservation" ("providerId", "status");
CREATE INDEX IF NOT EXISTS "Reservation_providerId_createdAt_idx" ON "Reservation" ("providerId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "GroupBooking_providerId_status_idx" ON "GroupBooking" ("providerId", "status");
CREATE INDEX IF NOT EXISTS "Guest_providerId_createdAt_idx" ON "Guest" ("providerId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "AuditLog_createdAt_desc_idx" ON "AuditLog" ("createdAt" DESC);
CREATE INDEX IF NOT EXISTS "Payment_providerId_createdAt_idx" ON "Payment" ("providerId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "Notification_providerId_isRead_idx" ON "Notification" ("providerId", "isRead");
CREATE INDEX IF NOT EXISTS "GroupBooking_providerId_idx" ON "GroupBooking" ("providerId");
CREATE INDEX IF NOT EXISTS "GroupBooking_status_idx" ON "GroupBooking" ("status");
CREATE INDEX IF NOT EXISTS "GroupBooking_startDate_idx" ON "GroupBooking" ("startDate");
CREATE INDEX IF NOT EXISTS "StaffLog_providerId_idx" ON "StaffLog" ("providerId");
CREATE INDEX IF NOT EXISTS "StaffLog_userId_idx" ON "StaffLog" ("userId");
CREATE INDEX IF NOT EXISTS "StaffLog_action_idx" ON "StaffLog" ("action");
CREATE INDEX IF NOT EXISTS "StaffLog_targetType_idx" ON "StaffLog" ("targetType");
CREATE INDEX IF NOT EXISTS "StaffLog_createdAt_idx" ON "StaffLog" ("createdAt");
CREATE INDEX IF NOT EXISTS "MessageTemplate_providerId_idx" ON "MessageTemplate" ("providerId");
CREATE INDEX IF NOT EXISTS "MessageTemplate_type_idx" ON "MessageTemplate" ("type");
CREATE INDEX IF NOT EXISTS "MessageLog_providerId_idx" ON "MessageLog" ("providerId");
CREATE INDEX IF NOT EXISTS "MessageLog_recipient_idx" ON "MessageLog" ("recipient");
CREATE INDEX IF NOT EXISTS "MessageLog_status_idx" ON "MessageLog" ("status");
CREATE INDEX IF NOT EXISTS "MessageLog_createdAt_idx" ON "MessageLog" ("createdAt");
CREATE INDEX IF NOT EXISTS "Reservation_groupBookingId_idx" ON "Reservation" ("groupBookingId");
CREATE INDEX IF NOT EXISTS "StaffLog_providerId_createdAt_idx" ON "StaffLog" ("providerId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "MessageLog_providerId_createdAt_idx" ON "MessageLog" ("providerId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "NotificationBroadcast_createdAt_idx" ON "NotificationBroadcast" ("createdAt");
CREATE INDEX IF NOT EXISTS "NotificationBroadcast_sentBy_idx" ON "NotificationBroadcast" ("sentBy");

-- StockMovement audit log (for Resource stock changes)
CREATE TABLE IF NOT EXISTS "StockMovement" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "resourceId" TEXT NOT NULL,
  "delta" DOUBLE PRECISION NOT NULL,
  "reason" TEXT NOT NULL DEFAULT '',
  "previousQty" DOUBLE PRECISION NOT NULL,
  "newQty" DOUBLE PRECISION NOT NULL,
  "userId" TEXT NOT NULL DEFAULT '',
  "userName" TEXT NOT NULL DEFAULT '',
  "providerId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "StockMovement_resourceId_idx" ON "StockMovement" ("resourceId");
CREATE INDEX IF NOT EXISTS "StockMovement_providerId_idx" ON "StockMovement" ("providerId");
CREATE INDEX IF NOT EXISTS "StockMovement_createdAt_idx" ON "StockMovement" ("createdAt");
CREATE INDEX IF NOT EXISTS "StockMovement_resourceId_createdAt_idx" ON "StockMovement" ("resourceId", "createdAt" DESC);
DO $$ BEGIN ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "Resource"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;
`;

let _initDone = false;
let _migrationsRan = false;
let _initPromise: Promise<void> | null = null;

/** Reset the init flag so ensureDatabase() will re-run on next call.
 *  Called by db.ts when a schema error is detected at runtime. */
export function resetInitFlag(): void {
  _initDone = false;
  _initPromise = null;
  console.log("[init-db] Init flag reset — migrations will re-run.");
}

/** Execute SQL via raw pg Client */
async function execViaPg(sql: string, params?: unknown[]): Promise<void> {
  const client = new Client({ connectionString: process.env.DATABASE_URL! });
  try {
    await client.connect();
    await client.query(sql, params);
  } finally {
    await client.end().catch(() => {});
  }
}

/** Execute DDL via Prisma $executeRawUnsafe — splits multi-statement SQL
 *  because Prisma's driver does NOT support multiple statements per call. */
async function execViaPrisma(sql: string): Promise<void> {
  const prisma = new PrismaClient({ log: ["warn", "error"] });
  try {
    // Extract individual executable statements.
    // Prisma $executeRawUnsafe cannot run DO $$ ... END $$ blocks,
    // so we unwrap them and run the inner SQL, catching duplicate errors in JS.
    const stmts = extractStatements(sql);

    for (const stmt of stmts) {
      const s = stmt.endsWith(';') ? stmt : stmt + ';';
      try {
        await prisma.$executeRawUnsafe(s);
      } catch (err) {
        // Ignore duplicate column / duplicate object / relation already exists errors
        const msg = err instanceof Error ? err.message : String(err);
        const ignorable =
          /duplicate_column/i.test(msg) ||
          /duplicate_object/i.test(msg) ||
          /already exists/i.test(msg) ||
          /relation .* already exists/i.test(msg);
        if (!ignorable) {
          console.error("[execViaPrisma] Statement failed (continuing):", s.slice(0, 100), msg);
        }
      }
    }
  } finally {
    await prisma.$disconnect().catch(() => {});
  }
}

/**
 * Parse a SQL blob into individual executable statements.
 * Handles:
 *  - DO $$ BEGIN <stmt> EXCEPTION WHEN ... THEN null; END $$;  →  <stmt>
 *  - Plain statements separated by ;
 */
function extractStatements(sql: string): string[] {
  const results: string[] = [];

  // 1. Extract inner statements from DO $$ blocks
  //    Pattern: DO $$ BEGIN ... EXCEPTION WHEN <type> THEN null; END $$;
  const doBlockRe = /DO\s+\$\$\s*BEGIN\s*([\s\S]*?)\s*EXCEPTION\s+WHEN\s+\w+\s+THEN\s+null;\s*END\s+\$\$/gi;
  let remaining = sql;
  let match: RegExpExecArray | null;

  while ((match = doBlockRe.exec(remaining)) !== null) {
    const inner = match[1].trim();
    if (inner) {
      // Inner content may have multiple statements separated by ;
      const innerStmts = inner
        .split(';')
        .map(s => s.trim())
        .filter(s => s.length > 0);
      results.push(...innerStmts);
    }
  }

  // 2. Remove DO blocks from remaining SQL
  remaining = remaining.replace(doBlockRe, '');

  // 3. Extract remaining plain statements (CREATE INDEX, CREATE TABLE, INSERT, etc.)
  if (remaining.trim()) {
    const plain = remaining
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--'));
    results.push(...plain);
  }

  return results;
}

/**
 * Run only MIGRATIONS_SQL + INDEXES_SQL without full init.
 * Used as a background check when _initDone is already true.
 */
async function runMigrationsOnly(): Promise<void> {
  console.log("[init-db] Running idempotent migrations on existing DB...");
  try {
    await execViaPrisma(MIGRATIONS_SQL);
    console.log("[init-db] Background migrations applied.");
  } catch (err) {
    throw err;
  }
  try {
    const { PrismaClient } = await import("@prisma/client");
    const p = new PrismaClient();
    await p.$disconnect();
  } catch (enumErr) {
  }
  try {
    await execViaPrisma(INDEXES_SQL);
  } catch {
    // Indexes are best-effort
  }
}

export async function ensureDatabase(): Promise<void> {
  if (_initDone) {
    // Migrations already ran successfully in this process — skip.
    // Previously this re-ran ~200 DDL statements (ALTER TABLE + CREATE INDEX)
    // on EVERY API request, adding 4-20 seconds of latency on hosted Postgres.
    // The migrations are idempotent (IF NOT EXISTS / EXCEPTION WHEN duplicate),
    // so running them once per cold start is sufficient. New ALTER TABLE
    // statements added in a new deploy will run on the NEXT cold start.
    return;
  }
  if (_initPromise) return _initPromise;

  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL environment variable is not set.");
  }

  _initPromise = (async () => {
    console.log("[init-db] Starting database initialization...");

    let usePg = true;
    let pgError: unknown = null;

    // Strategy 1: Try using pg Client directly
    try {
      const client = new Client({ connectionString: process.env.DATABASE_URL });
      await client.connect();
      console.log("[init-db] pg Client connected successfully.");

      // Check if User table already exists
      const res = await client.query(
        `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='User') as ok`
      );
      const tableExists = res.rows[0]?.ok === true;
      console.log("[init-db] User table exists:", tableExists);

      if (tableExists) {
        console.log("[init-db] Tables already exist, ensuring all tables & columns are up to date...");
        try {
          // Run TABLES_SQL first — it uses CREATE TABLE IF NOT EXISTS so it's safe.
          // This ensures any newly-added tables (e.g. Subscription, SubscriptionPayment, SubscriptionPlan)
          // get created on existing databases.
          await client.query(TABLES_SQL);
          console.log("[init-db] Table existence verified.");
          await client.query(FKS_SQL);
          console.log("[init-db] Foreign keys verified.");
          await client.query(MIGRATIONS_SQL);
          console.log("[init-db] Migrations applied to existing tables.");

          // so ALTER TYPE ADD VALUE works here — unlike Prisma's $executeRaw).
          try {
          } catch (enumErr) {
            // Ignore if it already exists
          }

          await client.query(INDEXES_SQL);
          console.log("[init-db] Indexes verified.");
        } catch (migrateErr) {
          console.error("[init-db] Migration on existing tables failed:", migrateErr instanceof Error ? migrateErr.message : String(migrateErr));
          // Don't throw — the tables exist, migrations are best-effort
        }
        // Seed SubscriptionPlans on existing DB (idempotent)
        try {
          await client.query(`
            INSERT INTO "SubscriptionPlan" ("id","name","cycle","price","isActive","createdAt","updatedAt")
            SELECT 'plan-monthly-001','Monthly','MONTHLY',500,true,NOW(),NOW()
            WHERE NOT EXISTS (SELECT 1 FROM "SubscriptionPlan" WHERE "id"='plan-monthly-001');
            INSERT INTO "SubscriptionPlan" ("id","name","cycle","price","isActive","createdAt","updatedAt")
            SELECT 'plan-quarterly-001','Quarterly','QUARTERLY',1400,true,NOW(),NOW()
            WHERE NOT EXISTS (SELECT 1 FROM "SubscriptionPlan" WHERE "id"='plan-quarterly-001');
            INSERT INTO "SubscriptionPlan" ("id","name","cycle","price","isActive","createdAt","updatedAt")
            SELECT 'plan-semi-annual-001','Semi-Annual','SEMI_ANNUAL',2600,true,NOW(),NOW()
            WHERE NOT EXISTS (SELECT 1 FROM "SubscriptionPlan" WHERE "id"='plan-semi-annual-001');
            INSERT INTO "SubscriptionPlan" ("id","name","cycle","price","isActive","createdAt","updatedAt")
            SELECT 'plan-yearly-001','Annual','YEARLY',4800,true,NOW(),NOW()
            WHERE NOT EXISTS (SELECT 1 FROM "SubscriptionPlan" WHERE "id"='plan-yearly-001');
          `);
          console.log("[init-db] SubscriptionPlans seeded.");
        } catch (seedErr) {
          console.error("[init-db] SubscriptionPlan seeding failed:", seedErr instanceof Error ? seedErr.message : String(seedErr));
        }
        await client.end().catch(() => {});
        _initDone = true;
        return;
      }

      // Create enums
      console.log("[init-db] Creating enum types...");
      await client.query(ENUMS_SQL);

      // Create tables
      console.log("[init-db] Creating tables...");
      await client.query(TABLES_SQL);

      // Verify User table was created
      const verify = await client.query(
        `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='User') as ok`
      );
      if (!verify.rows[0]?.ok) {
        throw new Error("DDL executed but User table still not found!");
      }
      console.log("[init-db] Tables verified.");

      // Create foreign keys
      console.log("[init-db] Creating foreign keys...");
      await client.query(FKS_SQL);

      // Run migrations (add new columns to existing tables)
      console.log("[init-db] Running migrations...");
      await client.query(MIGRATIONS_SQL);

      try {
      } catch (enumErr) {
      }

      // Create indexes
      console.log("[init-db] Creating indexes...");
      await client.query(INDEXES_SQL);

      // Seed SUPERUSER
      console.log("[init-db] Seeding SUPERUSER...");
      const hashed = await bcrypt.hash("Admin@2024", 12);
      await client.query(
        `INSERT INTO "User" ("id","username","password","name","role","permissions","policeRank","createdAt","updatedAt")
         SELECT 'su-admin-001','admin',$1,'System Administrator','SUPERUSER','[]','',NOW(),NOW()
         WHERE NOT EXISTS (SELECT 1 FROM "User" WHERE "username"='admin')`,
        [hashed]
      );

      // Seed PoliceAlertConfig
      await client.query(
        `INSERT INTO "PoliceAlertConfig" ("id","createdAt","updatedAt")
         SELECT 'default-alert-config',NOW(),NOW()
         WHERE NOT EXISTS (SELECT 1 FROM "PoliceAlertConfig" WHERE "id"='default-alert-config')`
      );

      // Seed default SubscriptionPlans
      await client.query(`
        INSERT INTO "SubscriptionPlan" ("id","name","cycle","price","isActive","createdAt","updatedAt")
        SELECT 'plan-monthly-001','Monthly','MONTHLY',500,true,NOW(),NOW()
        WHERE NOT EXISTS (SELECT 1 FROM "SubscriptionPlan" WHERE "id"='plan-monthly-001');
        INSERT INTO "SubscriptionPlan" ("id","name","cycle","price","isActive","createdAt","updatedAt")
        SELECT 'plan-quarterly-001','Quarterly','QUARTERLY',1400,true,NOW(),NOW()
        WHERE NOT EXISTS (SELECT 1 FROM "SubscriptionPlan" WHERE "id"='plan-quarterly-001');
        INSERT INTO "SubscriptionPlan" ("id","name","cycle","price","isActive","createdAt","updatedAt")
        SELECT 'plan-semi-annual-001','Semi-Annual','SEMI_ANNUAL',2600,true,NOW(),NOW()
        WHERE NOT EXISTS (SELECT 1 FROM "SubscriptionPlan" WHERE "id"='plan-semi-annual-001');
        INSERT INTO "SubscriptionPlan" ("id","name","cycle","price","isActive","createdAt","updatedAt")
        SELECT 'plan-yearly-001','Annual','YEARLY',4800,true,NOW(),NOW()
        WHERE NOT EXISTS (SELECT 1 FROM "SubscriptionPlan" WHERE "id"='plan-yearly-001');
      `);

      console.log("[init-db] Database initialization complete via pg.");
      await client.end().catch(() => {});
      _initDone = true;
      return;
    } catch (err) {
      pgError = err;
      console.error("[init-db] pg approach failed:", err instanceof Error ? err.message : String(err));
      usePg = false;
    }

    // Strategy 2: Fallback — use Prisma $executeRawUnsafe
    console.log("[init-db] Falling back to Prisma $executeRawUnsafe...");
    try {
      // First check if tables exist using Prisma raw query
      const prisma = new PrismaClient({ log: ["warn", "error"] });
      try {
        const res: Array<{ ok: boolean }> = await prisma.$queryRawUnsafe(
          `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='User') as ok`
        );
        if (res[0]?.ok) {
          console.log("[init-db] Tables already exist (verified via Prisma), ensuring all tables & columns are up to date...");
          try {
            // Run TABLES_SQL — uses CREATE TABLE IF NOT EXISTS, safe on existing DB.
            // This creates any newly-added tables (e.g. Subscription, SubscriptionPlan).
            await execViaPrisma(TABLES_SQL);
            console.log("[init-db] Table existence verified via Prisma.");
            await execViaPrisma(FKS_SQL);
            console.log("[init-db] Foreign keys verified via Prisma.");
            await execViaPrisma(MIGRATIONS_SQL);
            console.log("[init-db] Migrations applied via Prisma.");
            await execViaPrisma(INDEXES_SQL);
            console.log("[init-db] Indexes verified via Prisma.");
          } catch (migrateErr) {
            console.error("[init-db] Prisma migration on existing tables failed:", migrateErr instanceof Error ? migrateErr.message : String(migrateErr));
          }
          _initDone = true;
          return;
        }
      } catch {
        // Table might not exist, which is expected
        console.log("[init-db] Tables do not exist yet, creating via Prisma...");
      } finally {
        await prisma.$disconnect().catch(() => {});
      }

      // Execute DDL via Prisma (split into parts to avoid query size issues)
      await execViaPrisma(ENUMS_SQL);
      console.log("[init-db] Enums created via Prisma.");

      await execViaPrisma(TABLES_SQL);
      console.log("[init-db] Tables created via Prisma.");

      await execViaPrisma(FKS_SQL);
      console.log("[init-db] Foreign keys created via Prisma.");

      await execViaPrisma(MIGRATIONS_SQL);
      console.log("[init-db] Migrations ran via Prisma.");

      await execViaPrisma(INDEXES_SQL);
      console.log("[init-db] Indexes created via Prisma.");

      // Seed SUPERUSER via Prisma
      const prisma2 = new PrismaClient({ log: ["warn", "error"] });
      try {
        const hashed = await bcrypt.hash("Admin@2024", 12);
        await prisma2.$executeRawUnsafe(
          `INSERT INTO "User" ("id","username","password","name","role","permissions","policeRank","createdAt","updatedAt")
           SELECT 'su-admin-001','admin',$1,'System Administrator','SUPERUSER','[]','',NOW(),NOW()
           WHERE NOT EXISTS (SELECT 1 FROM "User" WHERE "username"='admin')`,
          hashed
        );
        await prisma2.$executeRawUnsafe(
          `INSERT INTO "PoliceAlertConfig" ("id","createdAt","updatedAt")
           SELECT 'default-alert-config',NOW(),NOW()
           WHERE NOT EXISTS (SELECT 1 FROM "PoliceAlertConfig" WHERE "id"='default-alert-config')`
        );
        // Seed default SubscriptionPlans
        await prisma2.$executeRawUnsafe(
          `INSERT INTO "SubscriptionPlan" ("id","name","cycle","price","isActive","createdAt","updatedAt")
           SELECT 'plan-monthly-001','Monthly','MONTHLY',500,true,NOW(),NOW()
           WHERE NOT EXISTS (SELECT 1 FROM "SubscriptionPlan" WHERE "id"='plan-monthly-001')`
        );
        await prisma2.$executeRawUnsafe(
          `INSERT INTO "SubscriptionPlan" ("id","name","cycle","price","isActive","createdAt","updatedAt")
           SELECT 'plan-quarterly-001','Quarterly','QUARTERLY',1400,true,NOW(),NOW()
           WHERE NOT EXISTS (SELECT 1 FROM "SubscriptionPlan" WHERE "id"='plan-quarterly-001')`
        );
        await prisma2.$executeRawUnsafe(
          `INSERT INTO "SubscriptionPlan" ("id","name","cycle","price","isActive","createdAt","updatedAt")
           SELECT 'plan-semi-annual-001','Semi-Annual','SEMI_ANNUAL',2600,true,NOW(),NOW()
           WHERE NOT EXISTS (SELECT 1 FROM "SubscriptionPlan" WHERE "id"='plan-semi-annual-001')`
        );
        await prisma2.$executeRawUnsafe(
          `INSERT INTO "SubscriptionPlan" ("id","name","cycle","price","isActive","createdAt","updatedAt")
           SELECT 'plan-yearly-001','Annual','YEARLY',4800,true,NOW(),NOW()
           WHERE NOT EXISTS (SELECT 1 FROM "SubscriptionPlan" WHERE "id"='plan-yearly-001')`
        );
        console.log("[init-db] SUPERUSER and plans seeded via Prisma.");
      } finally {
        await prisma2.$disconnect().catch(() => {});
      }

      console.log("[init-db] Database initialization complete via Prisma fallback.");
      _initDone = true;
    } catch (prismaErr) {
      console.error("[init-db] Prisma fallback also failed:", prismaErr instanceof Error ? prismaErr.message : String(prismaErr));
      _initDone = false;
      _initPromise = null; // Allow retry
      throw new Error(
        `Database initialization failed. pg error: ${pgError instanceof Error ? pgError.message : String(pgError)} | Prisma error: ${prismaErr instanceof Error ? prismaErr.message : String(prismaErr)}`
      );
    }
  })();

  return _initPromise;
}

/**
 * Force-run just the migrations + indexes on the live database.
 * Useful after deploying schema changes to add new columns without full re-init.
 * All migrations use EXCEPTION WHEN duplicate_column so they are safe to re-run.
 */
export async function forceMigrate(): Promise<void> {
  console.log("[forceMigrate] Running migrations on existing database...");
  try {
    await execViaPrisma(MIGRATIONS_SQL);
    console.log("[forceMigrate] Migrations applied.");
  } catch (err) {
    console.error("[forceMigrate] Migration failed:", err instanceof Error ? err.message : String(err));
    throw err;
  }
  try {
    await execViaPrisma(INDEXES_SQL);
    console.log("[forceMigrate] Indexes verified.");
  } catch (err) {
    console.error("[forceMigrate] Index creation failed:", err instanceof Error ? err.message : String(err));
    // Don't throw — indexes are best-effort
  }
  // Reset init flag so next ensureDatabase() will do a full check
  _initDone = false;
  _initPromise = null;
}
