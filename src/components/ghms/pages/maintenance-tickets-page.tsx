"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useAppStore } from "@/lib/store";
import { apiGetHousekeeping, apiCreateHousekeeping, apiUpdateHousekeeping, apiGetRooms } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Wrench, Plus, AlertTriangle, CheckCircle2, Clock, Search } from "lucide-react";

interface HousekeepingTask {
  id: string;
  roomId: string;
  type: string;
  status: string;
  assignedTo: string | null;
  scheduledDate: string;
  notes: string;
  completedAt: string | null;
  providerId: string;
  createdAt: string;
  updatedAt: string;
  reportedBy?: string | null;
  priority?: string;
  diagnosis?: string;
  partsUsed?: string;
  resolutionNotes?: string;
  resolvedAt?: string | null;
  resolvedById?: string | null;
  room?: { id: string; number: string; name: string; type: string; status: string };
}

const PRIORITY_COLORS: Record<string, string> = {
  URGENT: "border-rose-500 bg-rose-50",
  HIGH: "border-rose-400 bg-rose-50/60",
  MEDIUM: "border-amber-400 bg-amber-50/60",
  LOW: "border-sky-400 bg-sky-50/60",
};

const PRIORITY_BADGES: Record<string, string> = {
  URGENT: "bg-rose-600 text-white",
  HIGH: "bg-rose-100 text-rose-700 border-rose-200",
  MEDIUM: "bg-amber-100 text-amber-700 border-amber-200",
  LOW: "bg-sky-100 text-sky-700 border-sky-200",
};

const STATUS_LABELS: Record<string, string> = {
  PENDING: "Open",
  IN_PROGRESS: "In Progress",
  COMPLETED: "Resolved",
};

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff / 86400000);
  if (days > 0) return `${days}d ago`;
  const hrs = Math.floor(diff / 3600000);
  if (hrs > 0) return `${hrs}h ago`;
  const mins = Math.floor(diff / 60000);
  return `${mins}m ago`;
}

function isAging(createdAt: string, status: string): boolean {
  if (status === "COMPLETED") return false;
  const ageDays = (Date.now() - new Date(createdAt).getTime()) / 86400000;
  return ageDays > 3;
}

export default function MaintenanceTicketsPage() {
  const { t } = useTranslation("dashboard");
  const { refreshKey } = useAppStore();
  const [tasks, setTasks] = useState<HousekeepingTask[]>([]);
  const [rooms, setRooms] = useState<Array<{ id: string; number: string; name: string; type: string; status: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "open" | "aging" | "resolved">("all");
  const [search, setSearch] = useState("");

  // New ticket dialog
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({
    roomId: "",
    priority: "MEDIUM",
    notes: "",
    assignedTo: "",
  });

  // Detail dialog
  const [detail, setDetail] = useState<HousekeepingTask | null>(null);
  const [diagnosis, setDiagnosis] = useState("");
  const [partsUsed, setPartsUsed] = useState("");
  const [resolutionNotes, setResolutionNotes] = useState("");
  const [updating, setUpdating] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [tasksRes, roomsRes] = await Promise.all([
        apiGetHousekeeping("type=MAINTENANCE&limit=100"),
        apiGetRooms().catch(() => []),
      ]);
      const list = Array.isArray(tasksRes?.tasks) ? tasksRes.tasks : [];
      setTasks(list);
      setRooms(Array.isArray(roomsRes) ? roomsRes : []);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : t("mtErrorLoad", { defaultValue: "Failed to load maintenance tickets" }));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    fetchData();
  }, [fetchData, refreshKey]);

  const filtered = tasks.filter((task) => {
    if (filter === "open" && task.status === "COMPLETED") return false;
    if (filter === "resolved" && task.status !== "COMPLETED") return false;
    if (filter === "aging" && !isAging(task.createdAt, task.status)) return false;
    if (search) {
      const q = search.toLowerCase();
      const roomNum = task.room?.number?.toLowerCase() || "";
      const roomName = task.room?.name?.toLowerCase() || "";
      const notes = (task.notes || "").toLowerCase();
      const reportedBy = (task.reportedBy || "").toLowerCase();
      return roomNum.includes(q) || roomName.includes(q) || notes.includes(q) || reportedBy.includes(q);
    }
    return true;
  });

  const stats = {
    open: tasks.filter((t) => t.status !== "COMPLETED").length,
    resolved: tasks.filter((t) => t.status === "COMPLETED").length,
    aging: tasks.filter((t) => isAging(t.createdAt, t.status)).length,
  };

  const handleCreate = async () => {
    if (!form.roomId) {
      toast.error(t("mtRoomRequired", { defaultValue: "Please select a room" }));
      return;
    }
    setCreating(true);
    try {
      await apiCreateHousekeeping({
        roomId: form.roomId,
        type: "MAINTENANCE",
        scheduledDate: new Date().toISOString().split("T")[0],
        notes: form.notes,
        assignedTo: form.assignedTo,
        priority: form.priority,
        reportedBy: form.assignedTo,
      } as Record<string, unknown>);
      toast.success(t("mtCreated", { defaultValue: "Ticket created" }));
      setCreateOpen(false);
      setForm({ roomId: "", priority: "MEDIUM", notes: "", assignedTo: "" });
      fetchData();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : t("mtCreateFailed", { defaultValue: "Failed to create ticket" }));
    } finally {
      setCreating(false);
    }
  };

  const handleUpdate = async (newStatus: string) => {
    if (!detail) return;
    setUpdating(true);
    try {
      const updateData: Record<string, unknown> = { status: newStatus };
      if (diagnosis) updateData.diagnosis = diagnosis;
      if (partsUsed) updateData.partsUsed = partsUsed;
      if (resolutionNotes) updateData.resolutionNotes = resolutionNotes;
      if (newStatus === "COMPLETED") {
        updateData.completedAt = new Date().toISOString();
        updateData.resolvedAt = new Date().toISOString();
      }
      await apiUpdateHousekeeping(detail.id, updateData);
      toast.success(t("mtUpdated", { defaultValue: "Ticket updated" }));
      setDetail(null);
      setDiagnosis("");
      setPartsUsed("");
      setResolutionNotes("");
      fetchData();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : t("mtUpdateFailed", { defaultValue: "Failed to update ticket" }));
    } finally {
      setUpdating(false);
    }
  };

  const openDetail = (task: HousekeepingTask) => {
    setDetail(task);
    setDiagnosis(task.diagnosis || "");
    setPartsUsed(task.partsUsed || "");
    setResolutionNotes(task.resolutionNotes || "");
  };

  if (loading) {
    return (
      <div className="space-y-6 p-4 md:p-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-96" />
        <Skeleton className="h-16 rounded-lg" />
        <Skeleton className="h-64 rounded-lg" />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Wrench className="h-6 w-6 text-indigo-600" />
            {t("mtTitle", { defaultValue: "Maintenance Tickets" })}
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            {t("mtSubtitle", { defaultValue: "Track maintenance issues from report to resolution" })}
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="gap-2">
          <Plus className="h-4 w-4" />
          {t("mtNewTicket", { defaultValue: "New Ticket" })}
        </Button>
      </div>

      {/* Filter tabs */}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant={filter === "all" ? "default" : "outline"}
          size="sm"
          onClick={() => setFilter("all")}
        >
          All ({tasks.length})
        </Button>
        <Button
          variant={filter === "open" ? "default" : "outline"}
          size="sm"
          onClick={() => setFilter("open")}
        >
          Open ({stats.open})
        </Button>
        <Button
          variant={filter === "aging" ? "destructive" : "outline"}
          size="sm"
          onClick={() => setFilter("aging")}
        >
          <AlertTriangle className="h-3.5 w-3.5 mr-1" />
          Aging &gt; 3d ({stats.aging})
        </Button>
        <Button
          variant={filter === "resolved" ? "default" : "outline"}
          size="sm"
          onClick={() => setFilter("resolved")}
        >
          Resolved ({stats.resolved})
        </Button>
        <div className="ml-auto relative">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-slate-400" />
          <Input
            placeholder="Search room, notes..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 w-[200px]"
          />
        </div>
      </div>

      {/* Ticket list */}
      {filtered.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center">
            <Wrench className="h-10 w-10 text-slate-300 mx-auto mb-2" />
            <p className="text-sm text-slate-500">
              {t("mtEmpty", { defaultValue: "No maintenance tickets. Create one when a room needs repair." })}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map((task) => {
            const aging = isAging(task.createdAt, task.status);
            const priority = task.priority || "MEDIUM";
            return (
              <Card
                key={task.id}
                className={`cursor-pointer border-l-4 transition-shadow hover:shadow-md ${
                  PRIORITY_COLORS[priority] || "border-slate-300"
                } ${aging ? "ring-2 ring-rose-200" : ""}`}
                onClick={() => openDetail(task)}
              >
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-slate-800">
                          {t("mtRoom", { defaultValue: "Room" })} {task.room?.number || "?"}
                        </span>
                        {task.room?.name && task.room.name !== `Room ${task.room.number}` && (
                          <span className="text-xs text-slate-500">· {task.room.name}</span>
                        )}
                        <Badge variant="outline" className={`text-[10px] ${PRIORITY_BADGES[priority] || ""}`}>
                          {priority}
                        </Badge>
                        {aging && (
                          <Badge className="bg-rose-600 text-white hover:bg-rose-600 text-[10px]">
                            <AlertTriangle className="h-3 w-3 mr-1" />
                            {t("mtAging", { defaultValue: "Aging" })} {timeAgo(task.createdAt)}
                          </Badge>
                        )}
                      </div>
                      <p className="mt-1 text-sm text-slate-600 line-clamp-2">
                        {task.notes || t("mtNoDescription", { defaultValue: "No description provided" })}
                      </p>
                      <div className="mt-2 flex items-center gap-3 text-xs text-slate-500">
                        <span><Clock className="h-3 w-3 inline mr-1" />{timeAgo(task.createdAt)}</span>
                        {task.assignedTo && <span>· Assigned: {task.assignedTo}</span>}
                        {task.reportedBy && <span>· Reported by: {task.reportedBy}</span>}
                      </div>
                    </div>
                    <Badge variant="outline" className={`text-xs ${
                      task.status === "COMPLETED" ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                      : task.status === "IN_PROGRESS" ? "bg-sky-50 text-sky-700 border-sky-200"
                      : "bg-amber-50 text-amber-700 border-amber-200"
                    }`}>
                      {task.status === "COMPLETED" && <CheckCircle2 className="h-3 w-3 mr-1" />}
                      {STATUS_LABELS[task.status] || task.status}
                    </Badge>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Create Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Wrench className="h-5 w-5 text-indigo-600" />
              {t("mtNewTicket", { defaultValue: "New Maintenance Ticket" })}
            </DialogTitle>
            <DialogDescription>
              {t("mtNewTicketDesc", { defaultValue: "Report a maintenance issue for a room. The ticket will be tracked until resolution." })}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Room *</Label>
              <Select value={form.roomId} onValueChange={(v) => setForm({ ...form, roomId: v })}>
                <SelectTrigger>
                  <SelectValue placeholder={t("mtRoomSelect", { defaultValue: "Select a room" })} />
                </SelectTrigger>
                <SelectContent>
                  {rooms.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.number}{r.name ? ` — ${r.name}` : ""} ({r.status})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {rooms.length === 0 && (
                <p className="text-[10px] text-amber-600 mt-1">
                  {t("mtNoRooms", { defaultValue: "No rooms found. Add rooms first via Accommodation → Rooms." })}
                </p>
              )}
            </div>
            <div>
              <Label className="text-xs">Priority</Label>
              <Select value={form.priority} onValueChange={(v) => setForm({ ...form, priority: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="LOW">Low</SelectItem>
                  <SelectItem value="MEDIUM">Medium</SelectItem>
                  <SelectItem value="HIGH">High</SelectItem>
                  <SelectItem value="URGENT">Urgent</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Issue description *</Label>
              <Textarea
                placeholder={t("mtNotesPlaceholder", { defaultValue: "e.g. AC not cooling, leaking tap, broken door lock" })}
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                rows={3}
              />
            </div>
            <div>
              <Label className="text-xs">Assigned to (optional)</Label>
              <Input
                placeholder={t("mtAssignedTo", { defaultValue: "Staff name" })}
                value={form.assignedTo}
                onChange={(e) => setForm({ ...form, assignedTo: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              {t("mtCancel", { defaultValue: "Cancel" })}
            </Button>
            <Button onClick={handleCreate} disabled={creating || !form.roomId || !form.notes}>
              {creating ? t("mtCreating", { defaultValue: "Creating..." }) : t("mtCreate", { defaultValue: "Create ticket" })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Detail Dialog */}
      <Dialog open={!!detail} onOpenChange={(open) => { if (!open) setDetail(null); }}>
        <DialogContent className="sm:max-w-[560px]">
          {detail && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Wrench className="h-5 w-5 text-indigo-600" />
                  {t("mtRoom", { defaultValue: "Room" })} {detail.room?.number || "?"} · {detail.room?.name || ""}
                </DialogTitle>
                <DialogDescription>
                  Opened {timeAgo(detail.createdAt)} · Priority: {detail.priority || "MEDIUM"}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <div className="rounded-lg bg-slate-50 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">Reported issue</p>
                  <p className="text-sm text-slate-700">{detail.notes || "—"}</p>
                  {detail.reportedBy && <p className="text-xs text-slate-500 mt-1">Reported by: {detail.reportedBy}</p>}
                </div>

                <div>
                  <Label className="text-xs">Diagnosis</Label>
                  <Textarea
                    placeholder={t("mtDiagnosisPlaceholder", { defaultValue: "What's the root cause?" })}
                    value={diagnosis}
                    onChange={(e) => setDiagnosis(e.target.value)}
                    rows={2}
                    disabled={detail.status === "COMPLETED"}
                  />
                </div>
                <div>
                  <Label className="text-xs">Parts used</Label>
                  <Input
                    placeholder={t("mtPartsPlaceholder", { defaultValue: "e.g. Compressor x1, capacitor x1" })}
                    value={partsUsed}
                    onChange={(e) => setPartsUsed(e.target.value)}
                    disabled={detail.status === "COMPLETED"}
                  />
                </div>
                <div>
                  <Label className="text-xs">Resolution notes</Label>
                  <Textarea
                    placeholder={t("mtResolutionPlaceholder", { defaultValue: "What was done to fix the issue?" })}
                    value={resolutionNotes}
                    onChange={(e) => setResolutionNotes(e.target.value)}
                    rows={2}
                    disabled={detail.status === "COMPLETED"}
                  />
                </div>

                {detail.status !== "COMPLETED" && (
                  <div className="flex gap-2 pt-2">
                    {detail.status === "PENDING" && (
                      <Button variant="outline" onClick={() => handleUpdate("IN_PROGRESS")} disabled={updating}>
                        Mark In Progress
                      </Button>
                    )}
                    <Button
                      className="bg-emerald-600 hover:bg-emerald-700 ml-auto"
                      onClick={() => handleUpdate("COMPLETED")}
                      disabled={updating}
                    >
                      <CheckCircle2 className="h-4 w-4 mr-1" />
                      Mark Resolved
                    </Button>
                  </div>
                )}
                {detail.status === "COMPLETED" && detail.resolvedAt && (
                  <div className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">
                    <CheckCircle2 className="h-4 w-4 inline mr-1" />
                    Resolved on {new Date(detail.resolvedAt).toLocaleString()}
                  </div>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
