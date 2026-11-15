# TMS ← GMS Integration Setup Guide

## Overview

This guide explains how to connect the **Tourist Management System (TMS)** to the **Guesthouse Management System (GMS)** so the TMS can display accommodation data (hotels, rooms, availability) directly from the GMS — without duplicating any data.

```
TMS (bishoftu-city-tourism-management.vercel.app)
  ↓ calls GMS API with API key
GMS (guesthousewithpolicemodule-ghjo-k4f2dpooj.vercel.app/api/v1)
  ↓ returns only authorized fields
TMS displays hotels, rooms, availability to tourists
```

## Files to Copy into the TMS Project

Copy these 2 files from this SDK into the TMS project:

1. **`gms-client.ts`** → Copy to `src/lib/gms-client.ts`
   (API client SDK — fetches data from GMS)

2. **`GmsConnectionSettings.tsx`** → Copy to `src/components/GmsConnectionSettings.tsx`
   (Admin UI — shows connection status + test button)

## Step-by-Step Setup

### Step 1: Register the TMS in the GMS

1. Open: https://guesthousewithpolicemodule-ghjo-k4f2dpooj.vercel.app
2. Login as admin
3. Go to **System Configuration** → **External API** tab
4. Click **"Register New Integration"**
5. Fill in:
   - Name: `Bishoftu City Tourism Management System`
   - Description: `Tourism office platform — needs accommodation directory`
   - Scopes: ☑ Providers, ☑ Rooms
6. Click **"Create & Generate API Key"**
7. **Copy the API key** (shown only once!): `ghms_live_xxxxxxxxxxxxxxxx`

### Step 2: Configure Data Sharing in GMS

1. In the GMS External API tab, click **"Configure"** on the TMS integration
2. For **Providers**: enable name, phone, address, GPS, type, bedCount, status
3. For **Rooms**: enable number, type, price, capacity, amenities, status
4. Click **"Save Configuration"**

### Step 3: Set Environment Variables in the TMS

In the TMS Vercel project (bishoftu-city-tourism-management):

1. Go to **Settings** → **Environment Variables**
2. Add:
   ```
   GMS_API_URL = https://guesthousewithpolicemodule-ghjo-k4f2dpooj.vercel.app
   GMS_API_KEY = ghms_live_xxxxxxxxxxxxxxxx
   ```
3. Click **Save**
4. **Redeploy** the TMS

### Step 4: Add the Connection Settings Component

In the TMS Tourism Office admin interface, add the `GmsConnectionSettings` component:

```tsx
// In the TMS admin page (e.g. src/app/admin/settings/page.tsx)
import { GmsConnectionSettings } from "@/components/GmsConnectionSettings";

export default function AdminSettings() {
  return (
    <div>
      <h1>System Settings</h1>
      <GmsConnectionSettings />
    </div>
  );
}
```

This shows:
- ✅ Connected / ❌ Not configured status
- GMS API URL + masked API key
- Authorized scopes (what data the TMS can access)
- "Test Connection" button

### Step 5: Use the GMS Data in the TMS

Replace the TMS's hardcoded hotel data with GMS API calls:

```tsx
// Before (hardcoded data):
const hotels = [
  { name: "Hotel 1", rooms: 50 },
  { name: "Hotel 2", rooms: 30 },
];

// After (live data from GMS):
import { getProviders, getRooms, checkAvailability } from "@/lib/gms-client";

// Get all approved guesthouses
const { data: hotels } = await getProviders();

// Get rooms for a specific hotel
const { data: rooms } = await getRooms({ providerId: hotel.id });

// Check availability for tourist's dates
const { data: availableRooms } = await checkAvailability({
  checkIn: "2026-12-01",
  checkOut: "2026-12-03",
});
```

### Step 6: Update the TMS Dashboard Stats

Replace hardcoded stats with live data from GMS:

```tsx
import { getProviders, getRooms } from "@/lib/gms-client";

// Get hotel count
const { pagination: { total: hotelCount } } = await getProviders({ limit: 1 });

// Get room count
const { pagination: { total: roomCount } } = await getRooms({ limit: 1 });

// Display: "10 Registered Hotels, 520 Total Rooms" (now live, not hardcoded)
```

## Available API Functions

| Function | What it does | GMS scope required |
|---|---|---|
| `testGmsConnection()` | Verify the API key works | any |
| `getProviders()` | List all approved guesthouses | `providers` |
| `getProviderById(id)` | Get one guesthouse's details | `providers` |
| `getRooms()` | List rooms (filter by provider, type, price) | `rooms` |
| `getRoomById(id)` | Get one room's details | `rooms` |
| `checkAvailability()` | Find available rooms by date range | `rooms` |
| `getReservations()` | List reservations | `reservations` |
| `getGuests()` | List guests (minimal fields) | `guests` |

## Caching (Recommended)

The GMS data doesn't change every second. Cache responses to reduce API calls:

```tsx
// Simple in-memory cache (60 second TTL)
let hotelCache: { data: any[], expiry: number } | null = null;

async function getHotelsCached() {
  if (hotelCache && Date.now() < hotelCache.expiry) {
    return hotelCache.data;
  }
  const { data } = await getProviders();
  hotelCache = { data, expiry: Date.now() + 60_000 }; // 60 seconds
  return data;
}
```

## Security Notes

- The API key is set via environment variable — NEVER commit it to git
- The GMS admin can revoke the key at any time — the TMS will immediately lose access
- Only fields the GMS admin explicitly authorized are returned
- Police data is NEVER shared (permanently blocked in the GMS)
- All API requests are logged in the GMS (audit trail)

## Troubleshooting

| Error | Cause | Fix |
|---|---|---|
| "GMS not configured" | Env vars not set | Set GMS_API_URL + GMS_API_KEY in Vercel |
| "API key is invalid or revoked" | Key was revoked or wrong | Re-register in GMS → get new key → update env var |
| "Doesn't have permission" | Scope not authorized | GMS admin → Configure → enable the scope |
| "Rate limit exceeded" | Too many requests | Reduce frequency or cache responses |
| Empty results | No approved providers | Approve guesthouses in GMS first |
