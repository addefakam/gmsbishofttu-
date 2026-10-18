"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "@/lib/store";
import { apiOperatorRoomAvailability } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronDown, ChevronUp, Search, Building2, BedDouble, RefreshCw, MapPin, Phone } from "lucide-react";

interface Summary {
  totalProviders: number;
  approvedProviders: number;
  totalRooms: number;
  totalCapacity: number;
  availableRooms: number;
  occupiedRooms: number;
  reservedRooms: number;
  maintenanceRooms: number;
  utilizationRate: number;
}

interface Room {
  id: string;
  number: string;
  name: string;
  type: string;
  status: string;
  floor: number;
  capacity: number;
  pricePerNight: number;
}

interface ProviderStat {
  id: string;
  name: string;
  ownerName: string;
  phone: string;
  address: string;
  total: number;
  available: number;
  occupied: number;
  reserved: number;
  maintenance: number;
  utilizationRate: number;
  totalCapacity: number;
  avgPrice: number;
  rooms: Room[];
}

interface Data {
  summary: Summary;
  roomTypes: { type: string; count: number }[];
  providers: ProviderStat[];
}

const STATUS_COLORS: Record<string, string> = {
  AVAILABLE: "bg-emerald-100 text-emerald-700 border-emerald-200",
  OCCUPIED: "bg-slate-100 text-slate-700 border-slate-200",
  RESERVED: "bg-sky-100 text-sky-700 border-sky-200",
  MAINTENANCE: "bg-amber-100 text-amber-700 border-amber-200",
};

const ROOM_TYPE_LABELS: Record<string, string> = {
  SINGLE: "Single",
  DOUBLE: "Double",
  TWIN: "Twin",
  SUITE: "Suite",
  DELUXE: "Deluxe",
  KING: "King",
  STANDARD: "Standard",
};

export default function OperatorRoomsCitywidePage() {
  const { t } = useTranslation();
  const { refreshKey } = useAppStore();
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [expandedProvider, setExpandedProvider] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await apiOperatorRoomAvailability();
      if (res?.summary && Array.isArray(res.providers)) {
        setData(res as Data);
      } else {
        setData(null);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to load";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData, refreshKey]);

  const filteredProviders = useMemo(() => {
    if (!data?.providers) return [];
    const q = search.toLowerCase();
    return data.providers
      .map((p) => {
        // Always show only AVAILABLE rooms — operators use this page to
        // find available rooms across guesthouses, not to inspect occupied/
        // reserved/maintenance ones.
        let rooms = p.rooms.filter((r) => r.status === "AVAILABLE");
        // Filter by search term (if any)
        if (q) {
          // If the guesthouse name matches the search, keep ALL available rooms
          const matchesName = p.name.toLowerCase().includes(q);
          if (matchesName) {
            rooms = p.rooms.filter((r) => r.status === "AVAILABLE");
          } else {
            rooms = rooms.filter((r) =>
              r.number.toLowerCase().includes(q) ||
              r.name.toLowerCase().includes(q) ||
              r.type.toLowerCase().includes(q)
            );
          }
        }
        return { ...p, rooms };
      })
      // Drop providers with zero available rooms
      .filter((p) => p.rooms.length > 0);
  }, [data, search]);

  if (loading) {
    return (
      <div className="space-y-6 p-4 md:p-6">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-lg" />)}
        </div>
        <Skeleton className="h-64 rounded-lg" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6 p-4 md:p-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Building2 className="h-6 w-6 text-indigo-600" />
            {t("citywideTitle", { defaultValue: "All Guesthouses" })}
          </h1>
        </div>
        <Card className="border-rose-200 bg-rose-50/50">
          <CardContent className="py-8 text-center">
            <p className="text-sm text-rose-700 mb-2">{error}</p>
            <p className="text-xs text-rose-500 mb-4">
              {t("citywideErrorHint", { defaultValue: "If the admin hasn't enabled 'Multi-Provider Room Breakdown' from Operator Features, this page won't load." })}
            </p>
            <Button variant="outline" onClick={fetchData}>{t("retry", { defaultValue: "Retry" })}</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!data) return null;

  const s = data.summary;

  return (
    <div className="space-y-6 p-4 md:p-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Building2 className="h-6 w-6 text-indigo-600" />
            {t("citywideTitle", { defaultValue: "All Guesthouses" })}
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            {t("citywideSubtitle", { defaultValue: "Room availability across all approved guesthouses (city-wide)" })}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={fetchData} className="gap-2">
          <RefreshCw className="h-4 w-4" />
          {t("refresh", { defaultValue: "Refresh" })}
        </Button>
      </div>

      {/* Summary KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t("guesthouses", { defaultValue: "Guesthouses" })}</p>
                <p className="mt-1 text-2xl font-bold text-slate-900">{s.approvedProviders}</p>
                <p className="text-[10px] text-slate-400">of {s.totalProviders} total</p>
              </div>
              <Building2 className="h-5 w-5 text-indigo-500" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t("totalRooms", { defaultValue: "Total Rooms" })}</p>
                <p className="mt-1 text-2xl font-bold text-slate-900">{s.totalRooms}</p>
                <p className="text-[10px] text-slate-400">capacity: {s.totalCapacity}</p>
              </div>
              <BedDouble className="h-5 w-5 text-violet-500" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t("utilization", { defaultValue: "Utilization" })}</p>
                <p className="mt-1 text-2xl font-bold text-emerald-700">{s.utilizationRate}%</p>
                <p className="text-[10px] text-slate-400">{s.occupiedRooms + s.reservedRooms} of {s.totalRooms}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t("availableNow", { defaultValue: "Available Now" })}</p>
                <p className="mt-1 text-2xl font-bold text-emerald-700">{s.availableRooms}</p>
                <p className="text-[10px] text-slate-400">{s.maintenanceRooms} in maintenance</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Status legend */}
      <div className="flex flex-wrap gap-2">
        <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200">Available: {s.availableRooms}</Badge>
        <Badge variant="outline" className="bg-slate-50 text-slate-700 border-slate-200">Occupied: {s.occupiedRooms}</Badge>
        <Badge variant="outline" className="bg-sky-50 text-sky-700 border-sky-200">Reserved: {s.reservedRooms}</Badge>
        <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">Maintenance: {s.maintenanceRooms}</Badge>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
        <Input
          placeholder={t("searchGuesthouse", { defaultValue: "Search by guesthouse name or room number..." })}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Provider list */}
      <div className="space-y-3">
        {filteredProviders.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center">
              <Building2 className="h-10 w-10 text-slate-300 mx-auto mb-2" />
              <p className="text-sm text-slate-500">
                {t("noAvailableRooms", { defaultValue: "No available rooms found. All rooms may be occupied or under maintenance." })}
              </p>
            </CardContent>
          </Card>
        ) : (
          filteredProviders.map((p) => {
            const isExpanded = expandedProvider === p.id;
            return (
              <Card key={p.id} className="overflow-hidden">
                <CardHeader
                  className="cursor-pointer pb-3"
                  onClick={() => setExpandedProvider(isExpanded ? null : p.id)}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-indigo-100 text-indigo-700">
                        <Building2 className="h-5 w-5" />
                      </div>
                      <div>
                        <CardTitle className="text-base">{p.name}</CardTitle>
                        <CardDescription className="flex items-center gap-3 text-xs">
                          {p.address && <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{p.address}</span>}
                          {p.phone && <span className="flex items-center gap-1"><Phone className="h-3 w-3" />{p.phone}</span>}
                        </CardDescription>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-[10px]">
                        {p.total} rooms · {p.utilizationRate}%
                      </Badge>
                      {isExpanded ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
                    </div>
                  </div>
                </CardHeader>
                {isExpanded && (
                  <CardContent className="pt-0">
                    <div className="mb-3 flex flex-wrap gap-2">
                      <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 text-[10px]">{p.available} available</Badge>
                      <Badge variant="outline" className="bg-slate-50 text-slate-700 border-slate-200 text-[10px]">{p.occupied} occupied</Badge>
                      <Badge variant="outline" className="bg-sky-50 text-sky-700 border-sky-200 text-[10px]">{p.reserved} reserved</Badge>
                      <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 text-[10px]">{p.maintenance} maintenance</Badge>
                      <Badge variant="outline" className="text-[10px]">Avg: {p.avgPrice.toLocaleString()} ETB</Badge>
                    </div>
                    {p.rooms.length === 0 ? (
                      <p className="text-xs text-slate-400 text-center py-3">No rooms in this guesthouse.</p>
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                        {p.rooms.map((r) => (
                          <div
                            key={r.id}
                            className={`flex items-center justify-between rounded-lg border p-2.5 ${STATUS_COLORS[r.status] || "bg-slate-50 border-slate-200"}`}
                          >
                            <div>
                              <p className="text-sm font-semibold">{r.number}</p>
                              <p className="text-[10px] opacity-70">
                                {ROOM_TYPE_LABELS[r.type] || r.type} · Floor {r.floor} · {r.pricePerNight.toLocaleString()} ETB
                              </p>
                            </div>
                            <Badge variant="outline" className="text-[9px] bg-white/60">
                              {r.status}
                            </Badge>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                )}
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
}
