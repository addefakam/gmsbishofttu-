"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore, type CurrentUser } from "@/lib/store";
import { apiAuth } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TrendingUp, AlertCircle } from "lucide-react";

export function OwnerLogin() {
  const { t } = useTranslation();
  const setCurrentUser = useAppStore((s) => s.setCurrentUser);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) {
      setError(t("ownerLogin.fieldsRequired", { defaultValue: "Username + password are required" }));
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await apiAuth({ username, password });
      if (!res || !res.user) {
        throw new Error("Invalid response from server");
      }
      setCurrentUser(res.user as CurrentUser);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Login failed";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4 py-8">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-500 shadow-lg shadow-indigo-500/25">
            <TrendingUp className="h-6 w-6 text-white" />
          </div>
          <h1 className="text-xl font-bold text-slate-900">Bishoftu GMS</h1>
          <p className="text-sm text-slate-500">Owner Companion</p>
        </div>

        <form onSubmit={handleLogin} className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="space-y-1.5">
            <Label htmlFor="username" className="text-xs uppercase tracking-wide text-slate-500">
              {t("ownerLogin.username", { defaultValue: "Username" })}
            </Label>
            <Input
              id="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              disabled={loading}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password" className="text-xs uppercase tracking-wide text-slate-500">
              {t("ownerLogin.password", { defaultValue: "Password" })}
            </Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              disabled={loading}
              required
            />
          </div>
          {error && (
            <div className="rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</div>
          )}
          <Button type="submit" disabled={loading} className="w-full bg-indigo-600 hover:bg-indigo-700">
            {loading ? t("ownerLogin.signingIn", { defaultValue: "Signing in..." }) : t("ownerLogin.signIn", { defaultValue: "Sign In" })}
          </Button>
        </form>

        <p className="mt-4 text-center text-xs text-slate-400">
          {t("ownerLogin.hint", { defaultValue: "Use your guesthouse owner/operator credentials" })}
        </p>
      </div>
    </div>
  );
}

export function OwnerRoleError() {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4 py-8">
      <div className="w-full max-w-sm text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-100">
          <AlertCircle className="h-6 w-6 text-rose-600" />
        </div>
        <h1 className="text-xl font-bold text-slate-900">
          {t("ownerRoleError.title", { defaultValue: "Access Denied" })}
        </h1>
        <p className="mt-2 text-sm text-slate-500">
          {t("ownerRoleError.message", { defaultValue: "This app is for owners, operators, and system admins. Your account (STAFF or POLICE) doesn't have access." })}
        </p>
        <a href="/" className="mt-4 inline-block text-sm font-medium text-indigo-600 hover:text-indigo-700">
          {t("ownerRoleError.backToMain", { defaultValue: "← Back to main app" })}
        </a>
      </div>
    </div>
  );
}
