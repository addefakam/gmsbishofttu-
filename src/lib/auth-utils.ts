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
 * SECURITY FIX (C-02): JWT_SECRET should be set in production.
 *
 * Previously, the secret was derived from DATABASE_URL as a fallback.
 * This was insecure because:
 *   1. DATABASE_URL was committed to git history (C-03)
 *   2. Anyone with the DB URL could forge JWT tokens
 *   3. The "derived" secret was predictable
 *
 * Now: if JWT_SECRET is not set, we generate a random ephemeral secret
 * (per process) and log a FATAL warning. This means:
 *   - The app DOESN'T CRASH (it still works)
 *   - Tokens don't survive a server restart (users need to re-login)
 *   - The admin sees the warning in Vercel logs
 *
 * To fix properly: set JWT_SECRET env var on Vercel (32+ chars):
 *   openssl rand -base64 48
 */
function getJWTSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;

  if (secret && secret.length >= 32) {
    return new TextEncoder().encode(secret);
  }

  // Fallback: generate a random ephemeral secret (per process).
  // This is LESS SECURE than a fixed JWT_SECRET because:
  //   - Tokens don't survive server restarts (users must re-login)
  //   - Different instances have different secrets (load-balanced requests fail)
  // But it PREVENTS the app from crashing entirely.
  if (!_ephemeralSecret) {
    _ephemeralSecret = require("crypto").randomBytes(32);
    if (process.env.NODE_ENV === "production") {
      console.error(
        "⚠️  FATAL: JWT_SECRET not set in production!\n" +
        "   The app is running with a random ephemeral secret — tokens won't survive restarts.\n" +
        "   FIX: Set JWT_SECRET env var on Vercel (32+ characters):\n" +
        "   Run: openssl rand -base64 48"
      );
    } else {
      console.warn("[auth] JWT_SECRET not set — using random dev secret.");
    }
  }
  return _ephemeralSecret;
}

// Cache for ephemeral secret (used when JWT_SECRET is not set)
let _ephemeralSecret: Uint8Array | null = null;

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
