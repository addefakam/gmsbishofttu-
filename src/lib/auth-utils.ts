import { createHash } from "crypto";
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
  // Backward compatibility: if password is NOT hashed (plain text), compare directly
  if (!hashed.startsWith("$2")) {
    return plainText === hashed;
  }
  return bcrypt.compare(plainText, hashed);
}

// ── JWT token management ──
function getJWTSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (secret && secret.length >= 32) {
    return new TextEncoder().encode(secret);
  }
  // Fallback: derive from DATABASE_URL — works in production without
  // explicitly setting JWT_SECRET. This is less secure but ensures
  // the system works out of the box.
  const dbUrl = process.env.DATABASE_URL || "ghms-fallback-secret-key";
  const derived = createHash("sha256").update(`ghms-jwt:${dbUrl}`).digest("hex");
  if (process.env.NODE_ENV === "production" && !secret) {
    console.warn("[auth] JWT_SECRET not set — using derived secret. Set JWT_SECRET (32+ chars) for better security.");
  }
  return new TextEncoder().encode(derived);
}

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
