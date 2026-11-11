import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";

// ── Password hashing ──
const SALT_ROUNDS = 12;

export async function hashPassword(plainText: string): Promise<string> {
  return bcrypt.hash(plainText, SALT_ROUNDS);
}

export async function verifyPassword(
  plainText: string,
  hashed: string
): Promise<boolean> {
  // SECURITY FIX (C-05): Removed plain-text backward compatibility.
  // All passwords MUST be bcrypt-hashed. If a password is not hashed
  // (doesn't start with $2), we reject it — no plain-text comparison.
  // This prevents timing attacks and ensures no plain-text passwords
  // are accepted.
  if (!hashed.startsWith("$2")) {
    console.error("[auth] REJECTED login — password is not bcrypt-hashed. User must reset password.");
    return false;
  }
  return bcrypt.compare(plainText, hashed);
}

// ── JWT token management ──

/**
 * SECURITY FIX (C-02): JWT_SECRET is now REQUIRED in production.
 *
 * Previously, the secret was derived from DATABASE_URL as a fallback.
 * This was insecure because:
 *   1. DATABASE_URL was committed to git history (C-03)
 *   2. Anyone with the DB URL could forge JWT tokens
 *   3. The "derived" secret was predictable
 *
 * Now: if JWT_SECRET is not set (or too short), we throw immediately.
 * In development, we generate a random ephemeral secret (per process)
 * so the app still runs locally without configuration.
 *
 * In production (NODE_ENV=production), the app WILL NOT START without
 * a proper JWT_SECRET (32+ characters).
 */
function getJWTSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;

  if (secret && secret.length >= 32) {
    return new TextEncoder().encode(secret);
  }

  // Development-only fallback: generate a random ephemeral secret.
  // This means tokens don't survive a server restart in dev mode,
  // but that's acceptable for local development.
  if (process.env.NODE_ENV !== "production") {
    if (!_devSecret) {
      _devSecret = require("crypto").randomBytes(32);
      console.warn("[auth] JWT_SECRET not set — using random dev secret (tokens won't survive restart).");
    }
    return _devSecret;
  }

  // PRODUCTION: hard fail — no fallback, no derived secret
  throw new Error(
    "FATAL: JWT_SECRET environment variable is required in production (32+ characters). " +
    "Generate one with: openssl rand -base64 48"
  );
}

// Cache for dev-mode ephemeral secret
let _devSecret: Uint8Array | null = null;

export interface JWTPayload {
  userId: string;
  username: string;
  role: string;
  providerId: string | null;
  permissions: string[];
  policeRank: string;
  name: string;
  providerName?: string;
  // ── Police jurisdiction ──
  jurisdictionType: string;  // CITY | SUBCITY | WOREDA
  subCity?: string | null;    // set when SUBCITY or WOREDA
  woreda?: string | null;     // set only when WOREDA
}

// Token expiry: 24 hours
const TOKEN_EXPIRY = "24h";

export async function createToken(payload: JWTPayload): Promise<string> {
  const secret = getJWTSecret();
  return new SignJWT(payload as unknown as Record<string, unknown>)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(TOKEN_EXPIRY)
    .setSubject(payload.userId)
    .sign(secret);
}

export async function verifyToken(
  token: string
): Promise<JWTPayload | null> {
  try {
    const secret = getJWTSecret();
    const { payload } = await jwtVerify(token, secret);
    return {
      userId: payload.sub || "",
      username: (payload.username as string) || "",
      role: (payload.role as string) || "",
      providerId: (payload.providerId as string) || null,
      permissions: (payload.permissions as string[]) || [],
      policeRank: (payload.policeRank as string) || "",
      name: (payload.name as string) || "",
      providerName: (payload.providerName as string) || undefined,
      jurisdictionType: (payload.jurisdictionType as string) || "CITY",
      subCity: (payload.subCity as string) || null,
      woreda: (payload.woreda as string) || null,
    };
  } catch {
    return null;
  }
}
