"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useAppStore } from "@/lib/store";
import { apiGetOperatorFeatures, apiUpdateOperatorFeatures, apiUpdateOwnerFeatureFlags } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Save,
  RefreshCw,
  Eye,
  EyeOff,
  Shield,
  LayoutDashboard,
  DoorOpen,
  UserCog,
  BarChart3,
  Users,
  MessageSquare,
  ScrollText,
  CreditCard,
  Settings,
  Package,
  Receipt,
  AlertTriangle,
  TrendingUp,
  FileText,
  RefreshCw as RefreshCwIcon,
  Wrench,
} from "lucide-react";

interface FeaturePage {
  key: string;
  label: string;
  icon: string;
  category: string;
  enabled: boolean;
}

interface OwnerFeature {
  key: string;
  label: string;
  description: string;
  icon: string;
  category: string;
  enabled: boolean;
}

const ICON_MAP: Record<string, React.ElementType> = {
  LayoutDashboard,
  DoorOpen,
  UserCog,
  BarChart3,
  Users,
  MessageSquare,
  ScrollText,
  CreditCard,
  Settings,
  Package,
  Receipt,
  TrendingUp,
  FileText,
  RefreshCw: RefreshCwIcon,
  Wrench,
};

const CATEGORY_LABELS: Record<string, string> = {
  core: "Core",
  management: "Management",
  operations: "Operations",
  billing: "Billing",
  // Owner Visibility & Operational Control categories
  "owner-visibility": "Owner Visibility",
  "operational-control": "Operational Control",
};

export default function OperatorFeaturesPage() {
  const { t } = useTranslation("operatorFeatures");
  const { refreshKey, setOwnerFeatureFlags } = useAppStore();
  const [pages, setPages] = useState<FeaturePage[]>([]);
  const [ownerFeatures, setOwnerFeatures] = useState<OwnerFeature[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingFlags, setSavingFlags] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiGetOperatorFeatures();
      if (res?.pages && Array.isArray(res.pages)) {
        setPages(res.pages);
      } else {
        // Defensive: API returned 200 but no `pages` array — build it from
        // TOGGLABLE_PAGES defaults so the page still renders.
        setPages([
          { key: "dashboard", label: "Dashboard", icon: "LayoutDashboard", category: "core", enabled: true },
          { key: "accommodation", label: "Accommodation", icon: "DoorOpen", category: "core", enabled: true },
          { key: "reports", label: "Reports", icon: "BarChart3", category: "management", enabled: true },
          { key: "resources", label: "Stock Management", icon: "Package", category: "operations", enabled: true },
          { key: "expenses", label: "Expenses", icon: "Receipt", category: "operations", enabled: true },
          { key: "group-bookings", label: "Group Bookings", icon: "Users", category: "operations", enabled: true },
          { key: "guest-communication", label: "Messages", icon: "MessageSquare", category: "operations", enabled: true },
          { key: "staff-logs", label: "Staff Activity", icon: "ScrollText", category: "operations", enabled: true },
          { key: "my-subscription", label: "Subscription", icon: "CreditCard", category: "billing", enabled: true },
          { key: "settings", label: "Settings", icon: "Settings", category: "core", enabled: true },
        ]);
      }
      if (res?.ownerFeatures && Array.isArray(res.ownerFeatures)) {
        setOwnerFeatures(res.ownerFeatures);
      } else if (res?.ownerFeatureFlags) {
        // OPERATOR/STAFF branch only returns the flags map (no metadata) —
        // SUPERUSER should always get the full ownerFeatures array. But just
        // in case, build it from the flags + a fallback catalog.
        const FALLBACK_FLAGS = [
          { key: "ownerDashboard", label: "Owner Dashboard Enhancements", description: "", icon: "TrendingUp", category: "owner-visibility" },
          { key: "endOfDayReport", label: "End-of-Day Report", description: "", icon: "FileText", category: "owner-visibility" },
          { key: "shiftHandover", label: "Shift Handover Log", description: "", icon: "RefreshCw", category: "operational-control" },
          { key: "maintenanceTickets", label: "Maintenance Tickets", description: "", icon: "Wrench", category: "operational-control" },
        ];
        setOwnerFeatures(FALLBACK_FLAGS.map((f) => ({
          ...f,
          enabled: res.ownerFeatureFlags[f.key] !== false,
        })));
      } else {
        // No owner features returned at all — default all 4 to enabled so
        // the page renders with the toggle UI visible.
        setOwnerFeatures([
          { key: "ownerDashboard", label: "Owner Dashboard Enhancements", description: "Real-time KPIs, alerts, and revenue chart on the dashboard.", icon: "TrendingUp", category: "owner-visibility", enabled: true },
          { key: "endOfDayReport", label: "End-of-Day Report + Cash Reconciliation", description: "Daily cash reconciliation with discrepancy detection + sign-off.", icon: "FileText", category: "owner-visibility", enabled: true },
          { key: "shiftHandover", label: "Shift Handover Log", description: "Track shift openings, closings, and cash handovers.", icon: "RefreshCw", category: "operational-control", enabled: true },
          { key: "maintenanceTickets", label: "Maintenance Ticket System", description: "Maintenance workflow from Open to Resolved with aging alerts.", icon: "Wrench", category: "operational-control", enabled: true },
        ]);
      }
      // Persist to the global store so other components can read the flags
      // without an extra fetch (e.g. dashboard-page checks ownerDashboard flag).
      if (res?.ownerFeatureFlags) {
        setOwnerFeatureFlags(res.ownerFeatureFlags);
      } else {
        // Default all flags ON if API didn't return them.
        setOwnerFeatureFlags({ ownerDashboard: true, endOfDayReport: true, shiftHandover: true, maintenanceTickets: true });
      }
    } catch (err: unknown) {
      // Don't show the error toast if it's an auth redirect (the req()
      // helper already redirected to login). Only show for genuine errors.
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("Session expired") || msg.includes("Please sign in")) {
        // Auth issue — req() already redirected. Don't double-toast.
        return;
      }
      console.error("[operator-features-page] fetchData error:", msg);
      toast.error(t("errorLoad"));
    } finally {
      setLoading(false);
    }
  }, [t, setOwnerFeatureFlags]);

  useEffect(() => {
    fetchData();
  }, [fetchData, refreshKey]);

  const togglePage = (key: string) => {
    if (key === "dashboard") return;
    setPages((prev) =>
      prev.map((p) => (p.key === key ? { ...p, enabled: !p.enabled } : p))
    );
    setHasChanges(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const disabledPages = pages.filter((p) => !p.enabled).map((p) => p.key);
      await apiUpdateOperatorFeatures(disabledPages);
      setHasChanges(false);
      toast.success(t("saved"));
    } catch {
      toast.error(t("errorSave"));
    } finally {
      setSaving(false);
    }
  };

  // ── Auto-save for owner feature flags ──
  // Each flag toggle fires an immediate PUT to the API — no Save button
  // needed. This matches the pattern used by the System Config page
  // (autoSavePricing) and is more user-friendly than batching.
  const toggleOwnerFeature = async (key: string) => {
    const current = ownerFeatures.find((f) => f.key === key);
    if (!current) return;
    const newEnabled = !current.enabled;
    // Optimistic update — flip the UI immediately, revert on failure.
    setOwnerFeatures((prev) =>
      prev.map((f) => (f.key === key ? { ...f, enabled: newEnabled } : f))
    );
    // Build the full flags map from the current state with the toggled flag flipped.
    const flagsMap: Record<string, boolean> = {};
    ownerFeatures.forEach((f) => {
      flagsMap[f.key] = f.key === key ? newEnabled : f.enabled;
    });
    // Update the global store too so subscribers see the change instantly.
    setOwnerFeatureFlags(flagsMap);
    setSavingFlags(true);
    try {
      const result = await apiUpdateOwnerFeatureFlags(flagsMap);
      // The API may return 200 with success:false if the operatorFeatureFlags
      // column isn't available yet (during the deploy window). In that case
      // the flag's UI state stays updated (optimistic) but we warn the user
      // that it didn't persist — instead of reverting + showing the scary
      // 'Failed to update feature flag' toast.
      if (result && result.success === false) {
        toast.warning(
          result.warning
            || t("flagNotPersisted", { defaultValue: "Flag updated locally but not saved to the database. Please try again later." })
        );
        // Don't revert — keep the optimistic state so the user can keep
        // using the app. The flag will reset on next page load.
      } else if (result && result.flagsPersisted === false) {
        // Success but flags didn't persist — show a soft warning.
        toast.warning(
          result.warning
            || t("flagNotPersisted", { defaultValue: "Flag updated locally but not saved to the database. Please try again later." })
        );
      } else {
        toast.success(
          newEnabled
            ? t("flagEnabled", { defaultValue: "Feature enabled" })
            : t("flagDisabled", { defaultValue: "Feature disabled" })
        );
      }
    } catch (err: unknown) {
      // Revert on failure
      setOwnerFeatures((prev) =>
        prev.map((f) => (f.key === key ? { ...f, enabled: !newEnabled } : f))
      );
      const revertedMap = { ...flagsMap, [key]: !newEnabled };
      setOwnerFeatureFlags(revertedMap);
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[operator-features-page] toggleOwnerFeature error:", msg);
      // Don't double-toast if it's an auth redirect.
      if (msg.includes("Session expired") || msg.includes("Please sign in")) return;
      toast.error(t("flagSaveError", { defaultValue: "Failed to update feature flag" }));
    } finally {
      setSavingFlags(false);
    }
  };

  const enabledCount = pages.filter((p) => p.enabled).length;
  const disabledCount = pages.length - enabledCount;
  const categories = Array.from(new Set(pages.map((p) => p.category)));
  const ownerCategories = Array.from(new Set(ownerFeatures.map((f) => f.category)));
  const ownerEnabledCount = ownerFeatures.filter((f) => f.enabled).length;

  if (loading) {
    return (
      <div className="space-y-6 p-4 md:p-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-96" />
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-16 rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t("pageTitle")}</h1>
          <p className="mt-1 text-sm text-gray-500">{t("pageSubtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => { fetchData(); setHasChanges(false); }}
            className="gap-2"
          >
            <RefreshCw className="h-4 w-4" />
            {t("btnRefresh")}
          </Button>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={saving || !hasChanges}
            className="gap-2"
          >
            <Save className={`h-4 w-4 ${saving ? "animate-spin" : ""}`} />
            {t("btnSave")}
          </Button>
        </div>
      </div>

      {hasChanges && (
        <div className="flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
          <AlertTriangle className="h-5 w-5 shrink-0 text-amber-500" />
          <p className="text-sm text-amber-800">{t("unsavedWarning")}</p>
        </div>
      )}

      {/* ── Owner Visibility & Operational Control ──
          These feature flags are auto-saved on toggle (no Save button
          needed). They control which advanced features owners/operators
          see in the app: Owner Dashboard KPIs, End-of-Day Report,
          Shift Handover Log, Maintenance Tickets. */}
      {ownerFeatures.length > 0 && (
        <>
          <div className="rounded-lg border border-indigo-200 bg-gradient-to-r from-indigo-50 to-violet-50 p-4">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-indigo-100 text-indigo-700">
                <TrendingUp className="h-5 w-5" />
              </div>
              <div className="flex-1">
                <h2 className="text-base font-bold text-slate-900">
                  {t("ownerFeaturesTitle", { defaultValue: "Owner Visibility & Operational Control" })}
                </h2>
                <p className="mt-1 text-sm text-slate-600">
                  {t("ownerFeaturesSubtitle", { defaultValue: "Advanced features to help guesthouse owners monitor revenue, manage operations, and control their business in real time. Toggle a feature on/off — changes save automatically." })}
                </p>
                <div className="mt-2 flex items-center gap-3 text-xs">
                  <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100 border-0">
                    {t("ownerFeaturesEnabled", { defaultValue: "{{n}} of {{total}} enabled", n: ownerEnabledCount, total: ownerFeatures.length })}
                  </Badge>
                  {savingFlags && (
                    <span className="text-slate-500">{t("savingFlags", { defaultValue: "Saving..." })}</span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {ownerCategories.map((cat) => (
            <Card key={`owner-${cat}`} className="border-indigo-100">
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-semibold text-slate-800 flex items-center gap-2">
                  <span className="inline-block h-2 w-2 rounded-full bg-indigo-500" />
                  {CATEGORY_LABELS[cat] || cat}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {ownerFeatures
                  .filter((f) => f.category === cat)
                  .map((feature) => {
                    const Icon = ICON_MAP[feature.icon] || TrendingUp;
                    return (
                      <div
                        key={feature.key}
                        className={`flex items-start gap-3 rounded-lg border p-3 transition-colors ${
                          feature.enabled
                            ? "border-emerald-200 bg-emerald-50/30"
                            : "border-slate-200 bg-slate-50/50"
                        }`}
                      >
                        <div
                          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                            feature.enabled
                              ? "bg-emerald-100 text-emerald-700"
                              : "bg-slate-200 text-slate-400"
                          }`}
                        >
                          <Icon className="h-4 w-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm font-medium ${feature.enabled ? "text-slate-800" : "text-slate-500"}`}>
                            {feature.label}
                          </p>
                          {feature.description && (
                            <p className="mt-1 text-xs text-slate-500 leading-relaxed">
                              {feature.description}
                            </p>
                          )}
                          <p className="mt-1 text-[10px] text-slate-400 font-mono">{feature.key}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => toggleOwnerFeature(feature.key)}
                          disabled={savingFlags}
                          className={`flex h-8 items-center gap-1.5 rounded-md border px-3 text-xs font-medium transition-colors disabled:opacity-50 ${
                            feature.enabled
                              ? "border-emerald-300 bg-emerald-100 text-emerald-700 hover:bg-emerald-200"
                              : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
                          }`}
                          aria-pressed={feature.enabled}
                          title={feature.enabled ? "Click to disable" : "Click to enable"}
                        >
                          <span className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors ${feature.enabled ? "bg-emerald-500" : "bg-slate-300"}`}>
                            <span className={`inline-block h-3 w-3 transform rounded-full bg-white shadow transition-transform ${feature.enabled ? "translate-x-3.5" : "translate-x-0.5"}`} />
                          </span>
                          {feature.enabled ? (t("flagOn", { defaultValue: "ON" })) : (t("flagOff", { defaultValue: "OFF" }))}
                        </button>
                      </div>
                    );
                  })}
              </CardContent>
            </Card>
          ))}
        </>
      )}

      {/* ── Page visibility (existing) ── */}
      <div className="border-t pt-4">
        <h2 className="text-base font-semibold text-slate-800 mb-2">
          {t("pageVisibilityTitle", { defaultValue: "Page Visibility (Operator Sidebar)" })}
        </h2>
        <p className="text-xs text-slate-500 mb-3">
          {t("pageVisibilitySubtitle", { defaultValue: "Hide specific pages from the operator/staff sidebar. Changes require Save." })}
        </p>
        <div className="flex items-center gap-4 mb-3">
          <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100 border-0">
            {t("enabledCount", { count: enabledCount })}
          </Badge>
          <Badge className="bg-rose-100 text-rose-700 hover:bg-rose-100 border-0">
            {t("disabledCount", { count: disabledCount })}
          </Badge>
        </div>

        {categories.map((cat) => (
          <Card key={cat}>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold text-slate-800">
                {CATEGORY_LABELS[cat] || cat}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {pages
                .filter((p) => p.category === cat)
                .map((page) => {
                  const Icon = ICON_MAP[page.icon] || LayoutDashboard;
                  const isProtected = page.key === "dashboard";
                  return (
                    <div
                      key={page.key}
                      className={`flex items-center gap-3 rounded-lg border p-3 transition-colors ${
                        page.enabled
                          ? "border-slate-200 bg-white"
                          : "border-rose-200 bg-rose-50/50"
                      }`}
                    >
                      <div
                        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                          page.enabled
                            ? "bg-slate-100 text-slate-600"
                            : "bg-rose-100 text-rose-400"
                        }`}
                      >
                        <Icon className="h-4 w-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm font-medium ${page.enabled ? "text-slate-800" : "text-slate-400 line-through"}`}>
                          {t(`page_${page.key}`) || page.label}
                        </p>
                        <p className="text-xs text-slate-400">{page.key}</p>
                      </div>
                      {isProtected ? (
                        <Badge variant="outline" className="border-slate-200 text-slate-400 text-xs">
                          <Shield className="mr-1 h-3 w-3" />
                          {t("required")}
                        </Badge>
                      ) : page.enabled ? (
                        <button
                          onClick={() => togglePage(page.key)}
                          className="flex h-8 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-600 transition-colors hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600"
                        >
                          <Eye className="h-3.5 w-3.5" />
                          {t("visible")}
                        </button>
                      ) : (
                        <button
                          onClick={() => togglePage(page.key)}
                          className="flex h-8 items-center gap-1.5 rounded-md border border-rose-200 bg-rose-50 px-2.5 text-xs font-medium text-rose-600 transition-colors hover:bg-rose-100"
                        >
                          <EyeOff className="h-3.5 w-3.5" />
                          {t("hidden")}
                        </button>
                      )}
                    </div>
                  );
                })}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
