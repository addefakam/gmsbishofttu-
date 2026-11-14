"use client";

import { useState, useEffect } from "react";
import { toast } from "sonner";
import {
  Globe, Plus, Trash2, Copy, Eye, EyeOff, Loader2, Save,
  CheckCircle2, XCircle, RefreshCw, Webhook,
} from "lucide-react";

interface Integration {
  id: string;
  name: string;
  description: string;
  apiKeyPrefix: string;
  scopes: string[];
  permissions: string[];
  status: string;
  rateLimit: number;
  dataSharing: Record<string, any>;
  lastUsedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}

const ALL_SCOPES = ["providers", "rooms", "reservations", "guests"];

const FIELD_OPTIONS: Record<string, string[]> = {
  providers: ["name", "phone", "address", "subCity", "woreda", "type", "latitude", "longitude", "bedCount", "status", "licenseNo", "licenseFile"],
  rooms: ["number", "name", "type", "pricePerNight", "pricePerNightWeekend", "capacity", "floor", "amenities", "description", "image", "status"],
  reservations: ["checkIn", "checkOut", "nights", "status", "totalCost", "paymentStatus", "roomNumber", "guestName", "guestPhone"],
  guests: ["name", "phone", "nationality", "vip", "idNumber", "address", "email"],
};

export function ExternalApiTab() {
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [selectedIntegration, setSelectedIntegration] = useState<Integration | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetchIntegrations();
  }, []);

  const fetchIntegrations = () => {
    setLoading(true);
    fetch("/api/admin/integrations", { cache: "no-store" })
      .then((r) => r.json())
      .then((data) => {
        setIntegrations(data.data || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  const createIntegration = (name: string, description: string, scopes: string[]) => {
    fetch("/api/admin/integrations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, description, scopes, rateLimit: 1000 }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.apiKey) {
          setNewKey(data.apiKey);
          setCopied(false);
        }
        fetchIntegrations();
        setShowCreateForm(false);
        toast.success("Integration created — copy the API key now!");
      })
      .catch(() => toast.error("Failed to create integration"));
  };

  const revokeIntegration = (id: string) => {
    if (!confirm("Revoke this integration? The external system will immediately lose access.")) return;
    fetch(`/api/admin/integrations/${id}`, { method: "DELETE" })
      .then(() => {
        fetchIntegrations();
        toast.success("Integration revoked");
      })
      .catch(() => toast.error("Failed to revoke"));
  };

  const copyKey = () => {
    if (newKey) {
      navigator.clipboard.writeText(newKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Master info banner */}
      <div className="flex items-start gap-2 rounded-xl bg-gradient-to-r from-sky-50 to-cyan-50 px-4 py-3 ring-1 ring-sky-200">
        <Globe className="mt-0.5 h-5 w-5 shrink-0 text-sky-600" />
        <div>
          <h3 className="text-sm font-bold text-slate-900">External API — Data Sharing</h3>
          <p className="mt-0.5 text-xs text-slate-600">
            Register external systems (e.g., Tourist Management System) and control which accommodation data they can access.
            API Base URL: <code className="rounded bg-white px-1.5 py-0.5 text-[10px] font-mono text-sky-700">/api/v1/</code>
          </p>
        </div>
      </div>

      {/* New API key display (one-time) */}
      {newKey && (
        <div className="rounded-xl border-2 border-amber-300 bg-amber-50 p-4">
          <div className="mb-2 flex items-center gap-2">
            <span className="text-sm font-bold text-amber-900">⚠️ Copy your API key now — it won't be shown again!</span>
          </div>
          <div className="flex items-center gap-2">
            <code className="flex-1 rounded-lg bg-white px-3 py-2 text-xs font-mono text-slate-900 break-all border border-amber-200">
              {newKey}
            </code>
            <button
              onClick={copyKey}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-500 text-white hover:bg-amber-600"
              title="Copy to clipboard"
            >
              {copied ? <CheckCircle2 className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </button>
          </div>
          <button
            onClick={() => setNewKey(null)}
            className="mt-2 text-xs font-medium text-amber-700 hover:text-amber-900"
          >
            I've copied it — dismiss
          </button>
        </div>
      )}

      {/* Integrations list */}
      <div className="space-y-3">
        {integrations.length === 0 && (
          <div className="rounded-xl bg-white p-8 text-center border border-slate-200">
            <Globe className="mx-auto mb-3 h-10 w-10 text-slate-300" />
            <p className="text-sm text-slate-500">No external systems connected yet.</p>
            <p className="text-xs text-slate-400 mt-1">Click "Register Integration" to connect a system like the Tourist Management System.</p>
          </div>
        )}

        {integrations.map((integ) => (
          <div key={integ.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h4 className="text-sm font-bold text-slate-900">{integ.name}</h4>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                    integ.status === "ACTIVE" ? "bg-emerald-100 text-emerald-700" :
                    integ.status === "SUSPENDED" ? "bg-amber-100 text-amber-700" :
                    integ.status === "REVOKED" ? "bg-red-100 text-red-700" :
                    "bg-slate-100 text-slate-600"
                  }`}>
                    {integ.status}
                  </span>
                </div>
                {integ.description && (
                  <p className="mt-0.5 text-xs text-slate-500">{integ.description}</p>
                )}
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <span className="text-[10px] text-slate-400">Key:</span>
                  <code className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-mono text-slate-600">
                    {integ.apiKeyPrefix}••••••••
                  </code>
                  <span className="text-[10px] text-slate-400">·</span>
                  <span className="text-[10px] text-slate-500">Scopes: {integ.scopes.join(", ")}</span>
                  <span className="text-[10px] text-slate-400">·</span>
                  <span className="text-[10px] text-slate-500">{integ.rateLimit}/hr</span>
                  {integ.lastUsedAt && (
                    <>
                      <span className="text-[10px] text-slate-400">·</span>
                      <span className="text-[10px] text-slate-500">
                        Last used: {new Date(integ.lastUsedAt).toLocaleDateString()}
                      </span>
                    </>
                  )}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  onClick={() => setSelectedIntegration(integ)}
                  className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-sky-700 hover:bg-sky-50"
                >
                  Configure
                </button>
                {integ.status !== "REVOKED" && (
                  <button
                    onClick={() => revokeIntegration(integ.id)}
                    className="rounded-lg p-1.5 text-red-400 hover:bg-red-50 hover:text-red-600"
                    title="Revoke access"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Create new integration button */}
      {!showCreateForm && (
        <button
          onClick={() => setShowCreateForm(true)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
        >
          <Plus className="h-3.5 w-3.5" />
          Register New Integration
        </button>
      )}

      {/* Create form */}
      {showCreateForm && (
        <CreateIntegrationForm
          onSubmit={createIntegration}
          onCancel={() => setShowCreateForm(false)}
        />
      )}

      {/* Configuration modal */}
      {selectedIntegration && (
        <IntegrationConfigModal
          integration={selectedIntegration}
          onClose={() => setSelectedIntegration(null)}
          onUpdate={() => { fetchIntegrations(); setSelectedIntegration(null); }}
        />
      )}
    </div>
  );
}

// ── Create Integration Form ──────────────────────────────────────────

function CreateIntegrationForm({ onSubmit, onCancel }: {
  onSubmit: (name: string, description: string, scopes: string[]) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [scopes, setScopes] = useState<string[]>(["providers", "rooms"]);

  const toggleScope = (scope: string) => {
    setScopes((prev) => prev.includes(scope) ? prev.filter(s => s !== scope) : [...prev, scope]);
  };

  return (
    <div className="rounded-xl border border-sky-200 bg-sky-50/50 p-4">
      <h4 className="mb-3 text-sm font-bold text-slate-900">Register New Integration</h4>
      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-[11px] font-medium text-slate-600">System name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Tourist Management System"
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-sky-500"
          />
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-medium text-slate-600">Description (optional)</label>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g. National tourism platform — needs accommodation directory"
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-sky-500"
          />
        </div>
        <div>
          <label className="mb-1.5 block text-[11px] font-medium text-slate-600">Data scopes (what this system can access)</label>
          <div className="flex flex-wrap gap-2">
            {ALL_SCOPES.map((scope) => (
              <label key={scope} className="flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-xs ring-1 ring-slate-200">
                <input
                  type="checkbox"
                  checked={scopes.includes(scope)}
                  onChange={() => toggleScope(scope)}
                  className="h-3.5 w-3.5 rounded text-sky-600"
                />
                <span className="font-medium capitalize text-slate-700">{scope}</span>
              </label>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2 pt-1">
          <button
            onClick={() => name.trim() && scopes.length > 0 ? onSubmit(name.trim(), description.trim(), scopes) : null}
            disabled={!name.trim() || scopes.length === 0}
            className="rounded-lg bg-sky-600 px-4 py-2 text-xs font-semibold text-white hover:bg-sky-700 disabled:opacity-50"
          >
            Create & Generate API Key
          </button>
          <button
            onClick={onCancel}
            className="rounded-lg px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Integration Configuration Modal ──────────────────────────────────

function IntegrationConfigModal({ integration, onClose, onUpdate }: {
  integration: Integration;
  onClose: () => void;
  onUpdate: () => void;
}) {
  const [config, setConfig] = useState(integration.dataSharing || {});
  const [saving, setSaving] = useState(false);

  const toggleField = (entity: string, field: string) => {
    setConfig((prev) => ({
      ...prev,
      [entity]: {
        ...prev[entity],
        fields: {
          ...(prev[entity]?.fields || {}),
          [field]: !prev[entity]?.fields?.[field],
        },
      },
    }));
  };

  const toggleEntity = (entity: string) => {
    setConfig((prev) => ({
      ...prev,
      [entity]: {
        ...prev[entity],
        enabled: !prev[entity]?.enabled,
      },
    }));
  };

  const save = () => {
    setSaving(true);
    fetch(`/api/admin/integrations/${integration.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dataSharing: config }),
    })
      .then((r) => r.json())
      .then(() => {
        toast.success("Data sharing config saved");
        onUpdate();
      })
      .catch(() => toast.error("Failed to save config"))
      .finally(() => setSaving(false));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-slate-900">{integration.name}</h3>
            <p className="text-xs text-slate-500">Configure which data fields this system can access</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <XCircle className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4">
          {integration.scopes.map((scope) => (
            <div key={scope} className="rounded-xl border border-slate-200 p-3">
              <div className="mb-2 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={config[scope]?.enabled !== false}
                    onChange={() => toggleEntity(scope)}
                    className="h-4 w-4 rounded text-sky-600"
                  />
                  <h4 className="text-sm font-semibold capitalize text-slate-900">{scope}</h4>
                </div>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                  config[scope]?.enabled !== false ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"
                }`}>
                  {config[scope]?.enabled !== false ? "SHARING" : "HIDDEN"}
                </span>
              </div>
              {config[scope]?.enabled !== false && (
                <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                  {(FIELD_OPTIONS[scope] || []).map((field) => (
                    <label key={field} className="flex items-center gap-1.5 rounded-lg bg-slate-50 px-2 py-1 text-[11px]">
                      <input
                        type="checkbox"
                        checked={config[scope]?.fields?.[field] === true}
                        onChange={() => toggleField(scope, field)}
                        className="h-3 w-3 rounded text-sky-600"
                      />
                      <span className="font-medium text-slate-600">{field}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Police data warning */}
        <div className="mt-4 flex items-center gap-2 rounded-xl bg-red-50 px-3 py-2 ring-1 ring-red-200">
          <XCircle className="h-4 w-4 text-red-500" />
          <span className="text-[11px] text-red-700">
            <strong>Police data is NEVER shared</strong> — suspect matches, alerts, and intelligence are permanently blocked from the external API.
          </span>
        </div>

        <div className="mt-4 flex items-center justify-end gap-2">
          <button onClick={onClose} className="rounded-lg px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100">
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-4 py-2 text-xs font-semibold text-white hover:bg-sky-700 disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            Save Configuration
          </button>
        </div>
      </div>
    </div>
  );
}
