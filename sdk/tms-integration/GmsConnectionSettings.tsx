"use client";

import { useState, useEffect } from "react";
import { testGmsConnection, isGmsConfigured, getGmsApiUrl, getApiKeyPrefix } from "./gms-client";

/**
 * GMS Connection Settings Component
 * =================================
 *
 * Copy this file into the TMS project (e.g. src/components/GmsConnectionSettings.tsx).
 * Place it in the Tourism Office admin interface.
 *
 * It shows:
 *   - Connection status (connected/disconnected)
 *   - GMS API URL + API key (masked)
 *   - Test connection button
 *   - Integration name + authorized scopes
 *
 * The actual API URL + key are set via environment variables:
 *   GMS_API_URL=https://guesthousewithpolicemodule-ghjo-k4f2dpooj.vercel.app
 *   GMS_API_KEY=ghms_live_xxxxxxxxxxxxxxxx
 *
 * Set these in Vercel → Project Settings → Environment Variables.
 */

export function GmsConnectionSettings() {
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{
    connected: boolean;
    integrationName?: string;
    scopes?: string[];
    error?: string;
  } | null>(null);

  const configured = isGmsConfigured();

  useEffect(() => {
    // Auto-test on mount if configured
    if (configured) {
      handleTest();
    }
  }, [configured]);

  const handleTest = async () => {
    setTesting(true);
    setResult(null);
    try {
      const res = await testGmsConnection();
      setResult(res);
    } catch (err) {
      setResult({
        connected: false,
        error: err instanceof Error ? err.message : "Test failed",
      });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="mb-4 flex items-center gap-3">
        <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${
          result?.connected ? "bg-emerald-100" : configured ? "bg-amber-100" : "bg-slate-100"
        }`}>
          {result?.connected ? "✅" : configured ? "⚠️" : "🔌"}
        </div>
        <div>
          <h3 className="text-base font-bold text-slate-900">GMS Integration</h3>
          <p className="text-xs text-slate-500">
            Accommodation Management System — data source for hotels & rooms
          </p>
        </div>
      </div>

      {/* Status badge */}
      <div className="mb-4">
        {result?.connected ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-700">
            <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
            Connected
          </span>
        ) : configured ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-700">
            <span className="h-2 w-2 rounded-full bg-amber-500" />
            Configured — testing...
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-red-100 px-3 py-1 text-xs font-bold text-red-700">
            <span className="h-2 w-2 rounded-full bg-red-500" />
            Not configured
          </span>
        )}
      </div>

      {/* Configuration details */}
      <div className="space-y-2 rounded-xl bg-slate-50 p-3">
        <div className="flex items-center justify-between text-xs">
          <span className="text-slate-500">GMS API URL:</span>
          <code className="rounded bg-white px-2 py-0.5 font-mono text-slate-700">
            {configured ? getGmsApiUrl() : "Not set"}
          </code>
        </div>
        <div className="flex items-center justify-between text-xs">
          <span className="text-slate-500">API Key:</span>
          <code className="rounded bg-white px-2 py-0.5 font-mono text-slate-700">
            {configured ? getApiKeyPrefix() : "Not set"}
          </code>
        </div>
        {result?.integrationName && (
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-500">Integration:</span>
            <span className="font-medium text-slate-700">{result.integrationName}</span>
          </div>
        )}
        {result?.scopes && (
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-500">Authorized data:</span>
            <span className="font-medium text-slate-700">{result.scopes.join(", ")}</span>
          </div>
        )}
      </div>

      {/* Error message */}
      {result?.error && (
        <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 border border-red-200">
          <strong>Connection error:</strong> {result.error}
        </div>
      )}

      {/* Setup instructions if not configured */}
      {!configured && (
        <div className="mt-3 rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-800 border border-sky-200">
          <p className="font-semibold mb-1">Setup instructions:</p>
          <ol className="list-decimal ml-4 space-y-0.5">
            <li>Log into the GMS admin dashboard</li>
            <li>Go to System Configuration → External API</li>
            <li>Register this TMS as a new integration</li>
            <li>Copy the generated API key</li>
            <li>Set these env vars in Vercel (TMS project settings):
              <pre className="mt-1 rounded bg-white p-2 font-mono text-[10px]">
GMS_API_URL=https://guesthousewithpolicemodule-ghjo-k4f2dpooj.vercel.app{"\n"}
GMS_API_KEY=ghms_live_xxxxxxxxxxxxxxxx
              </pre>
            </li>
            <li>Redeploy the TMS</li>
          </ol>
        </div>
      )}

      {/* Test button */}
      {configured && (
        <button
          onClick={handleTest}
          disabled={testing}
          className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-4 py-2 text-xs font-semibold text-white hover:bg-sky-700 disabled:opacity-50"
        >
          {testing ? "Testing..." : "Test Connection"}
        </button>
      )}
    </div>
  );
}
