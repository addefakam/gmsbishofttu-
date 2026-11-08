"use client";
import { useTranslation } from "react-i18next";

import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import {
  Settings,
  Globe,
  Building2,
  Shield,
  Bell,
  Save,
  RotateCcw,
  Info,
  Clock,
  Lock,
  Mail,
  MessageSquare,
  AlertTriangle,
  Loader2,
  CreditCard,
  CheckCircle2,
  Phone,
  Power,
  Siren,
  Plus,
  Trash2,
  GripVertical,
} from "lucide-react";

// ── Types ──

type TabKey = "general" | "guesthouse" | "security" | "notifications" | "payment" | "emergency";

interface GeneralSettings {
  systemName: string;
  systemDescription: string;
  defaultLanguage: string;
  defaultCurrency: string;
  timezone: string;
  maintenanceMode: boolean;
  // Support phone shown to users in error toasts.
  // Empty string = no support line shown.
  supportPhone: string;
}

interface GuesthouseSettings {
  defaultCheckInTime: string;
  defaultCheckOutTime: string;
  autoApproveGuesthouses: boolean;
  autoCheckout: boolean;
  requireLicenseUpload: boolean;
}

interface SecuritySettings {
  passwordMinLength: number;
  sessionTimeoutHours: number;
  maxLoginAttempts: number;
  allowSelfRegistration: boolean;
  requireEmailVerification: boolean;
  ipWhitelist: string;
}

interface NotificationSettings {
  emailNotifications: boolean;
  smsNotifications: boolean;
  alertEscalationDelay: number;
  criticalAlertsImmediate: boolean;
  anomalyDetectionEnabled: boolean;
  notificationEmailRecipients: string;
}

interface PaymentSettings {
  trialDays: number;
  warningDays: number;
  graceDays: number;
  defaultCycle: string;
  paymentMethod: string;
  latePaymentPenalty: number;
  enableAutoReminder: boolean;
  reminderDaysBefore: number;
  currency: string;
  currencySymbol: string;
  paymentInstructions: string;
  // Per-bed-per-day pricing model
  pricePerBedPerDay: number;
  pricingEnabled: boolean;
  // Payment overdue enforcement
  enablePaymentOverdue: boolean;
  // Global subscription system toggle — when false, no provider is required
  // to have an active subscription. Banners, lockout, and mini-status are
  // all hidden. Super-admin can flip this off during the rollout period
  // (e.g. when onboarding new guesthouses who shouldn't be billed yet).
  subscriptionEnabled: boolean;
}

interface SystemConfig {
  general: GeneralSettings;
  guesthouse: GuesthouseSettings;
  security: SecuritySettings;
  notifications: NotificationSettings;
  payment: PaymentSettings;
}

// ── Defaults ──

const SYSTEM_VERSION = "1.4.0";

const DEFAULT_GENERAL: GeneralSettings = {
  systemName: "Bishoftu GMS",
  systemDescription: "Bishoftu Guest Management System for managing guesthouses, reservations, and compliance.",
  defaultLanguage: "en",
  defaultCurrency: "ETB",
  timezone: "Africa/Addis_Ababa",
  maintenanceMode: false,
  supportPhone: "",
};

const DEFAULT_GUESTHOUSE: GuesthouseSettings = {
  defaultCheckInTime: "14:00",
  defaultCheckOutTime: "10:00",
  autoApproveGuesthouses: false,
  autoCheckout: false,
  requireLicenseUpload: true,
};

const DEFAULT_SECURITY: SecuritySettings = {
  passwordMinLength: 8,
  sessionTimeoutHours: 24,
  maxLoginAttempts: 5,
  allowSelfRegistration: true,
  requireEmailVerification: true,
  ipWhitelist: "",
};

const DEFAULT_NOTIFICATIONS: NotificationSettings = {
  emailNotifications: true,
  smsNotifications: false,
  alertEscalationDelay: 30,
  criticalAlertsImmediate: true,
  anomalyDetectionEnabled: true,
  notificationEmailRecipients: "admin@ghms.et, security@ghms.et",
};

const DEFAULT_PAYMENT: PaymentSettings = {
  trialDays: 15,
  warningDays: 7,
  graceDays: 2,
  defaultCycle: "MONTHLY",
  paymentMethod: "manual",
  latePaymentPenalty: 10,
  enableAutoReminder: true,
  reminderDaysBefore: 7,
  currency: "ETB",
  currencySymbol: "Br",
  paymentInstructions: "Contact your administrator to arrange payment. Payments can be made via bank transfer or mobile money.",
  pricePerBedPerDay: 15,
  pricingEnabled: false,
  enablePaymentOverdue: false,
  // Default: subscription system is ENABLED (current behavior preserved).
  // Super-admin can turn it off from the Payment & Billing tab.
  subscriptionEnabled: true,
};

const FULL_DEFAULTS: SystemConfig = {
  general: DEFAULT_GENERAL,
  guesthouse: DEFAULT_GUESTHOUSE,
  security: DEFAULT_SECURITY,
  notifications: DEFAULT_NOTIFICATIONS,
  payment: DEFAULT_PAYMENT,
};

// ── Tab Definitions ──

const TABS: Array<{
  key: TabKey;
  label: string;
  icon: React.ElementType;
}> = [
  { key: "general", label: "General", icon: Globe },
  { key: "guesthouse", label: "Guesthouse", icon: Building2 },
  { key: "security", label: "Security", icon: Shield },
  { key: "notifications", label: "Notifications", icon: Bell },
  { key: "payment", label: "Payment & Billing", icon: CreditCard },
  { key: "emergency", label: "Emergency Contacts", icon: Siren },
];

// ── Shared UI Components ──

const inputClass =
  "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors disabled:cursor-not-allowed disabled:opacity-50 disabled:bg-slate-50";

const textareaClass =
  "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors resize-y min-h-[80px] disabled:cursor-not-allowed disabled:opacity-50 disabled:bg-slate-50";

const selectClass =
  "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors disabled:cursor-not-allowed disabled:opacity-50 disabled:bg-slate-50 appearance-none bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2224%22%20height%3D%2224%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%2394a3b8%22%20stroke-width%3D%222%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Cpath%20d%3D%22m6%209%206%206%206-6%22%2F%3E%3C%2Fsvg%3E')] bg-[length:18px] bg-[right_10px_center] bg-no-repeat pr-9";

function FormLabel({
  htmlFor,
  children,
}: {
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <label
      htmlFor={htmlFor}
      className="block text-sm font-medium text-slate-700 mb-1.5"
    >
      {children}
    </label>
  );
}

function ToggleSwitch({
  id,
  checked,
  onChange,
  disabled = false,
}: {
  id: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={
        `relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 ` +
        (checked
          ? "bg-primary"
          : "bg-slate-300") +
        (disabled ? " opacity-50 cursor-not-allowed" : "")
      }
    >
      <span
        className={
          `pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm ring-0 transition-transform duration-200 ease-in-out ` +
          (checked ? "translate-x-6" : "translate-x-1")
        }
      />
    </button>
  );
}

function SettingRow({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 py-4">
      <div className="flex-1 min-w-0 sm:pr-4">
        <p className="text-sm font-medium text-slate-800">{label}</p>
        {description && (
          <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
            {description}
          </p>
        )}
      </div>
      <div className="sm:w-64 shrink-0">{children}</div>
    </div>
  );
}

function SectionCard({
  title,
  description,
  icon: Icon,
  children,
}: {
  title: string;
  description: string;
  icon: React.ElementType;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="flex items-start gap-3 mb-1">
        <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-slate-100 shrink-0">
          <Icon className="w-4.5 h-4.5 text-slate-600" />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
          <p className="text-xs text-slate-500 mt-0.5">{description}</p>
        </div>
      </div>
      <div className="mt-4 divide-y divide-slate-100">{children}</div>
    </div>
  );
}

function NumberInput({
  id,
  value,
  onChange,
  min,
  max,
  step = 1,
  suffix,
  prefix,
  disabled = false,
}: {
  id: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  prefix?: string;
  disabled?: boolean;
}) {
  return (
    <div className="relative">
      {prefix && (
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-slate-500 pointer-events-none font-medium">
          {prefix}
        </span>
      )}
      <input
        id={id}
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className={inputClass + (suffix ? " pr-10" : "") + (prefix ? " pl-8" : "")}
      />
      {suffix && (
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 pointer-events-none">
          {suffix}
        </span>
      )}
    </div>
  );
}

// ── Tab Panels ──

function GeneralTab({
  settings,
  onChange,
}: {
  settings: GeneralSettings;
  onChange: (partial: Partial<GeneralSettings>) => void;
}) {
  return (
    <div className="space-y-5">
      {/* Basic Information */}
      <SectionCard
        title="Basic Information"
        description="Core system identity and branding settings"
        icon={Info}
      >
        <div className="py-4 space-y-4">
          <div>
            <FormLabel htmlFor="systemName">System Name</FormLabel>
            <input
              id="systemName"
              type="text"
              value={settings.systemName}
              onChange={(e) => onChange({ systemName: e.target.value })}
              className={inputClass}
              placeholder="Enter system name"
            />
          </div>
          <div>
            <FormLabel htmlFor="systemDescription">System Description</FormLabel>
            <textarea
              id="systemDescription"
              value={settings.systemDescription}
              onChange={(e) =>
                onChange({ systemDescription: e.target.value })
              }
              className={textareaClass}
              rows={3}
              placeholder="Describe the system purpose and scope"
            />
          </div>
        </div>
      </SectionCard>

      {/* Locale & Regional */}
      <SectionCard
        title="Locale & Regional"
        description="Language, currency, and timezone preferences"
        icon={Globe}
      >
        <SettingRow
          label="Default Language"
          description="Primary language for the system interface"
        >
          <select
            id="defaultLanguage"
            value={settings.defaultLanguage}
            onChange={(e) =>
              onChange({ defaultLanguage: e.target.value })
            }
            className={selectClass}
          >
            <option value="en">English</option>
            <option value="am">Amharic</option>
          </select>
        </SettingRow>

        <SettingRow
          label="Default Currency"
          description="Default currency for financial transactions"
        >
          <select
            id="defaultCurrency"
            value={settings.defaultCurrency}
            onChange={(e) =>
              onChange({ defaultCurrency: e.target.value })
            }
            className={selectClass}
          >
            <option value="ETB">ETB — Ethiopian Birr</option>
            <option value="USD">USD — US Dollar</option>
            <option value="EUR">EUR — Euro</option>
          </select>
        </SettingRow>

        <SettingRow
          label="Timezone"
          description="System-wide timezone for scheduling and reports"
        >
          <select
            id="timezone"
            value={settings.timezone}
            onChange={(e) => onChange({ timezone: e.target.value })}
            className={selectClass}
          >
            <option value="Africa/Addis_Ababa">Africa/Addis_Ababa (EAT, UTC+3)</option>
            <option value="Africa/Nairobi">Africa/Nairobi (EAT, UTC+3)</option>
            <option value="Africa/Cairo">Africa/Cairo (EET, UTC+2)</option>
            <option value="Africa/Lagos">Africa/Lagos (WAT, UTC+1)</option>
            <option value="Africa/Johannesburg">
              Africa/Johannesburg (SAST, UTC+2)
            </option>
            <option value="UTC">UTC (Coordinated Universal Time)</option>
            <option value="Europe/London">Europe/London (GMT/BST)</option>
            <option value="America/New_York">America/New_York (EST/EDT)</option>
          </select>
        </SettingRow>
      </SectionCard>

      {/* System Operations */}
      <SectionCard
        title="System Operations"
        description="Operational modes and system information"
        icon={Settings}
      >
        <SettingRow
          label="Maintenance Mode"
          description="When enabled, the system enters read-only mode for non-admin users"
        >
          <div className="flex items-center gap-3">
            <ToggleSwitch
              id="maintenanceMode"
              checked={settings.maintenanceMode}
              onChange={(v) => onChange({ maintenanceMode: v })}
            />
            {settings.maintenanceMode && (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">
                <AlertTriangle className="w-3 h-3" />
                Active
              </span>
            )}
          </div>
        </SettingRow>

        <SettingRow
          label="System Version"
          description="Currently installed version — read-only"
        >
          <input
            type="text"
            value={SYSTEM_VERSION}
            readOnly
            className={inputClass + " bg-slate-50 text-slate-500 cursor-not-allowed"}
          />
        </SettingRow>
      </SectionCard>

      {/* Support / Help Contact */}
      <SectionCard
        title="Support & Help Contact"
        description="Phone number shown to users in error messages so they know who to call for help"
        icon={Phone}
      >
        <SettingRow
          label="Support Phone Number"
          description="Appears as 'For help, call: <phone>' on every error toast. Leave blank to hide the line."
        >
          <input
            id="supportPhone"
            type="tel"
            value={settings.supportPhone}
            onChange={(e) => onChange({ supportPhone: e.target.value })}
            className={inputClass}
            placeholder="e.g. +251 911 234 567"
            autoComplete="off"
          />
        </SettingRow>
        {settings.supportPhone && (
          <div className="mt-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
            <span className="font-medium">Preview:</span> For help, call:{" "}
            <span className="font-mono">{settings.supportPhone}</span>
          </div>
        )}
      </SectionCard>
    </div>
  );
}

function GuesthouseTab({
  settings,
  onChange,
}: {
  settings: GuesthouseSettings;
  onChange: (partial: Partial<GuesthouseSettings>) => void;
}) {
  return (
    <div className="space-y-5">
      {/* Check-in & Check-out */}
      <SectionCard
        title="Check-in & Check-out"
        description="Default scheduling for guest arrivals and departures"
        icon={Clock}
      >
        <SettingRow
          label="Default Check-in Time"
          description="Standard check-in time shown on all guesthouses"
        >
          <input
            id="defaultCheckInTime"
            type="time"
            value={settings.defaultCheckInTime}
            onChange={(e) =>
              onChange({ defaultCheckInTime: e.target.value })
            }
            className={inputClass}
          />
        </SettingRow>

        <SettingRow
          label="Default Check-out Time"
          description="Standard check-out time shown on all guesthouses"
        >
          <input
            id="defaultCheckOutTime"
            type="time"
            value={settings.defaultCheckOutTime}
            onChange={(e) =>
              onChange({ defaultCheckOutTime: e.target.value })
            }
            className={inputClass}
          />
        </SettingRow>
      </SectionCard>

      {/* Registration & Compliance */}
      <SectionCard
        title="Registration & Compliance"
        description="Policies for new guesthouse onboarding"
        icon={Building2}
      >
        <SettingRow
          label="Auto-approve Guesthouses"
          description="Automatically approve newly registered guesthouses without manual review"
        >
          <div className="flex items-center gap-3">
            <ToggleSwitch
              id="autoApproveGuesthouses"
              checked={settings.autoApproveGuesthouses}
              onChange={(v) => onChange({ autoApproveGuesthouses: v })}
            />
            {settings.autoApproveGuesthouses && (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">
                <AlertTriangle className="w-3 h-3" />
                Bypasses review
              </span>
            )}
          </div>
        </SettingRow>

        <SettingRow
          label="Auto Check-out"
          description="Automatically check out guests whose check-out date/time has passed, without staff manually clicking 'Check Out'"
        >
          <div className="flex items-center gap-3">
            <ToggleSwitch
              id="autoCheckout"
              checked={settings.autoCheckout}
              onChange={(v) => onChange({ autoCheckout: v })}
            />
            {settings.autoCheckout && (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">
                <CheckCircle2 className="w-3 h-3" />
                Active
              </span>
            )}
          </div>
        </SettingRow>

        <SettingRow
          label="Require License Upload"
          description="Require operators to upload a valid business license during registration"
        >
          <ToggleSwitch
            id="requireLicenseUpload"
            checked={settings.requireLicenseUpload}
            onChange={(v) => onChange({ requireLicenseUpload: v })}
          />
        </SettingRow>
      </SectionCard>
    </div>
  );
}

function SecurityTab({
  settings,
  onChange,
}: {
  settings: SecuritySettings;
  onChange: (partial: Partial<SecuritySettings>) => void;
}) {
  return (
    <div className="space-y-5">
      {/* Authentication */}
      <SectionCard
        title="Authentication"
        description="Password policies and login session management"
        icon={Lock}
      >
        <SettingRow
          label="Password Minimum Length"
          description="Minimum number of characters required for user passwords"
        >
          <NumberInput
            id="passwordMinLength"
            value={settings.passwordMinLength}
            onChange={(v) => onChange({ passwordMinLength: v })}
            min={6}
            max={128}
          />
        </SettingRow>

        <SettingRow
          label="Max Login Attempts"
          description="Number of failed attempts before the account is temporarily locked"
        >
          <NumberInput
            id="maxLoginAttempts"
            value={settings.maxLoginAttempts}
            onChange={(v) => onChange({ maxLoginAttempts: v })}
            min={1}
            max={20}
          />
        </SettingRow>

        <SettingRow
          label="Session Timeout"
          description="Duration in hours before an inactive session expires"
        >
          <NumberInput
            id="sessionTimeoutHours"
            value={settings.sessionTimeoutHours}
            onChange={(v) => onChange({ sessionTimeoutHours: v })}
            min={1}
            max={720}
            suffix="hrs"
          />
        </SettingRow>
      </SectionCard>

      {/* Registration Policies */}
      <SectionCard
        title="Registration Policies"
        description="Controls for user self-registration and verification"
        icon={Shield}
      >
        <SettingRow
          label="Allow Self-Registration"
          description="Permit new users to create accounts without an admin invitation"
        >
          <ToggleSwitch
            id="allowSelfRegistration"
            checked={settings.allowSelfRegistration}
            onChange={(v) => onChange({ allowSelfRegistration: v })}
          />
        </SettingRow>

        <SettingRow
          label="Require Email Verification"
          description="Users must verify their email address before accessing the system"
        >
          <ToggleSwitch
            id="requireEmailVerification"
            checked={settings.requireEmailVerification}
            onChange={(v) => onChange({ requireEmailVerification: v })}
          />
        </SettingRow>
      </SectionCard>

      {/* Network Access */}
      <SectionCard
        title="Network Access"
        description="IP-based access control for the system"
        icon={Shield}
      >
        <div className="py-4 space-y-4">
          <div>
            <FormLabel htmlFor="ipWhitelist">IP Whitelist</FormLabel>
            <p className="text-xs text-slate-500 mb-2">
              Comma-separated list of allowed IP addresses or CIDR ranges.
              Leave empty to allow all IPs.
            </p>
            <textarea
              id="ipWhitelist"
              value={settings.ipWhitelist}
              onChange={(e) => onChange({ ipWhitelist: e.target.value })}
              className={textareaClass}
              rows={3}
              placeholder="e.g. 192.168.1.0/24, 10.0.0.1"
            />
          </div>
        </div>
      </SectionCard>
    </div>
  );
}

function NotificationsTab({
  settings,
  onChange,
}: {
  settings: NotificationSettings;
  onChange: (partial: Partial<NotificationSettings>) => void;
}) {
  return (
    <div className="space-y-5">
      {/* Notification Channels */}
      <SectionCard
        title="Notification Channels"
        description="Enable or disable notification delivery methods"
        icon={MessageSquare}
      >
        <SettingRow
          label="Email Notifications"
          description="Send system alerts and updates via email"
        >
          <ToggleSwitch
            id="emailNotifications"
            checked={settings.emailNotifications}
            onChange={(v) => onChange({ emailNotifications: v })}
          />
        </SettingRow>

        <SettingRow
          label="SMS Notifications"
          description="Send urgent alerts and verification codes via SMS"
        >
          <ToggleSwitch
            id="smsNotifications"
            checked={settings.smsNotifications}
            onChange={(v) => onChange({ smsNotifications: v })}
          />
        </SettingRow>
      </SectionCard>

      {/* Alert Configuration */}
      <SectionCard
        title="Alert Configuration"
        description="Configure how and when alerts are escalated"
        icon={AlertTriangle}
      >
        <SettingRow
          label="Alert Escalation Delay"
          description="Minutes before an unacknowledged alert is escalated to the next level"
        >
          <NumberInput
            id="alertEscalationDelay"
            value={settings.alertEscalationDelay}
            onChange={(v) => onChange({ alertEscalationDelay: v })}
            min={1}
            max={1440}
            suffix="min"
          />
        </SettingRow>

        <SettingRow
          label="Critical Alerts Immediate"
          description="Bypass escalation delay and immediately send critical alerts to all channels"
        >
          <ToggleSwitch
            id="criticalAlertsImmediate"
            checked={settings.criticalAlertsImmediate}
            onChange={(v) => onChange({ criticalAlertsImmediate: v })}
          />
        </SettingRow>

        <SettingRow
          label="Anomaly Detection Enabled"
          description="Automatically detect and alert on suspicious guesthouse activity patterns"
        >
          <ToggleSwitch
            id="anomalyDetectionEnabled"
            checked={settings.anomalyDetectionEnabled}
            onChange={(v) => onChange({ anomalyDetectionEnabled: v })}
          />
        </SettingRow>
      </SectionCard>

      {/* Recipients */}
      <SectionCard
        title="Notification Recipients"
        description="Email addresses that receive system-level notifications"
        icon={Mail}
      >
        <div className="py-4 space-y-4">
          <div>
            <FormLabel htmlFor="notificationEmailRecipients">
              Email Recipients
            </FormLabel>
            <p className="text-xs text-slate-500 mb-2">
              Comma-separated list of email addresses that receive system
              notifications and alerts.
            </p>
            <textarea
              id="notificationEmailRecipients"
              value={settings.notificationEmailRecipients}
              onChange={(e) =>
                onChange({ notificationEmailRecipients: e.target.value })
              }
              className={textareaClass}
              rows={3}
              placeholder="e.g. admin@ghms.et, ops@ghms.et, security@ghms.et"
            />
          </div>
        </div>
      </SectionCard>
    </div>
  );
}

function PaymentTab({
  settings,
  onChange,
  onPricingSave,
}: {
  settings: PaymentSettings;
  onChange: (partial: Partial<PaymentSettings>) => void;
  onPricingSave: (partial: Partial<PaymentSettings>) => void;
}) {
  return (
    <div className="space-y-5">
      {/* Subscription System Master Toggle */}
      <SectionCard
        title="Subscription System"
        description="Globally enable or disable the subscription requirement for all guesthouses"
        icon={Power}
      >
        <SettingRow
          label="Require Subscriptions"
          description="When ON, operators must have an active subscription — banners, lockouts, and the sidebar status all work normally. When OFF, no subscription is required and all subscription-related UI is hidden. Useful during rollout when onboarding new guesthouses who shouldn't be billed yet."
        >
          <div className="flex items-center gap-3">
            <ToggleSwitch
              id="subscriptionEnabled"
              checked={settings.subscriptionEnabled}
              onChange={(v) => onPricingSave({ subscriptionEnabled: v })}
            />
            {settings.subscriptionEnabled ? (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full">
                <CheckCircle2 className="w-3 h-3" />
                Enabled
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 bg-slate-100 px-2 py-0.5 rounded-full">
                <Power className="w-3 h-3" />
                Disabled — no subscription required
              </span>
            )}
          </div>
        </SettingRow>
        {!settings.subscriptionEnabled && (
          <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>
              The subscription system is currently <strong>disabled globally</strong>. Operators will not see subscription banners, lockouts, or the sidebar status indicator. They can use the full system without payment. Re-enable this when you're ready to start billing.
            </span>
          </div>
        )}
      </SectionCard>

      {/* Subscription Timing */}
      <SectionCard
        title="Subscription Timing"
        description="Control trial, warning, grace, and reminder periods"
        icon={Clock}
      >
        <SettingRow
          label="Trial Period"
          description="Free trial days for newly approved guesthouses"
        >
          <NumberInput
            id="trialDays"
            value={settings.trialDays}
            onChange={(v) => onChange({ trialDays: v })}
            min={0}
            max={90}
            suffix="days"
          />
        </SettingRow>

        <SettingRow
          label="Warning Period"
          description="Days before subscription expiry to show warning banner"
        >
          <NumberInput
            id="warningDays"
            value={settings.warningDays}
            onChange={(v) => onChange({ warningDays: v })}
            min={1}
            max={30}
            suffix="days"
          />
        </SettingRow>

        <SettingRow
          label="Grace Period"
          description="Days after expiry before service is suspended"
        >
          <NumberInput
            id="graceDays"
            value={settings.graceDays}
            onChange={(v) => onChange({ graceDays: v })}
            min={0}
            max={14}
            suffix="days"
          />
        </SettingRow>

        <SettingRow
          label="Reminder Before Expiry"
          description="Send payment reminder this many days before expiry"
        >
          <NumberInput
            id="reminderDaysBefore"
            value={settings.reminderDaysBefore}
            onChange={(v) => onChange({ reminderDaysBefore: v })}
            min={1}
            max={30}
            suffix="days"
          />
        </SettingRow>

        <SettingRow
          label="Enable Auto Reminder"
          description="Automatically send payment reminders to providers"
        >
          <ToggleSwitch
            id="enableAutoReminder"
            checked={settings.enableAutoReminder}
            onChange={(v) => onChange({ enableAutoReminder: v })}
          />
        </SettingRow>
      </SectionCard>

      {/* Subscription Pricing */}
      <SectionCard
        title="Subscription Pricing"
        description="Set the daily rate per bed. Operator cost is auto-calculated based on their total beds."
        icon={CreditCard}
      >
        <SettingRow
          label="Price Adjustment"
          description="Enable or disable pricing changes. When disabled, operators see locked current rates."
        >
          <div className="flex items-center gap-3">
            <ToggleSwitch
              id="pricingEnabled"
              checked={settings.pricingEnabled}
              onChange={(v) => onPricingSave({ pricingEnabled: v })}
            />
            {settings.pricingEnabled ? (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full">
                <CheckCircle2 className="w-3 h-3" />
                Editable
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 bg-slate-100 px-2 py-0.5 rounded-full">
                <Lock className="w-3 h-3" />
                Locked
              </span>
            )}
          </div>
        </SettingRow>

        <SettingRow
          label="Price per Bed per Day"
          description="Daily subscription rate multiplied by the operator's total number of beds"
        >
          <NumberInput
            id="pricePerBedPerDay"
            value={settings.pricePerBedPerDay}
            onChange={(v) => onPricingSave({ pricePerBedPerDay: v })}
            min={1}
            step={1}
            prefix={settings.currencySymbol}
            disabled={!settings.pricingEnabled}
          />
        </SettingRow>

        {/* Per-cycle preview table based on per-bed-per-day */}
        <div className="mt-3 p-3 bg-slate-50 rounded-lg border border-slate-100">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1">
            Cycle Price Preview (per bed)
          </p>
          <p className="text-[10px] text-muted-foreground mb-2">
            Total = {settings.currencySymbol}{settings.pricePerBedPerDay} x [beds] x [days in cycle]
          </p>
          <div className="grid grid-cols-4 gap-2 text-center">
            {[
              { label: "Monthly", days: 30 },
              { label: "Quarterly", days: 90 },
              { label: "Semi-Annual", days: 180 },
              { label: "Annual", days: 365 },
            ].map((item) => {
              const total = settings.pricePerBedPerDay * item.days;
              const perMonth = item.days > 0 ? Math.round((total / (item.days / 30)) * 100) / 100 : 0;
              return (
                <div key={item.label} className="p-2 rounded-lg bg-white border border-slate-200">
                  <p className="text-[10px] text-muted-foreground">{item.label}</p>
                  <p className="text-sm font-bold text-slate-800">
                    {settings.pricePerBedPerDay} x {item.days}
                  </p>
                  <p className="text-xs font-semibold text-primary">
                    {total.toLocaleString()} {settings.currencySymbol}
                  </p>
                  <p className="text-[9px] text-muted-foreground">per bed/cycle</p>
                </div>
              );
            })}
          </div>
        </div>

        <div className="mt-4 pt-4 border-t border-slate-200">
          <SettingRow
            label="Payment Overdue Tagging"
            description="When enabled, payments made after subscription expiry are tagged PAYMENT_OVERDUE. When disabled, a 'will apply soon' notice is shown instead."
          >
            <div className="flex items-center gap-3">
              <ToggleSwitch
                id="enablePaymentOverdue"
                checked={settings.enablePaymentOverdue}
                onChange={(v) => onPricingSave({ enablePaymentOverdue: v })}
              />
              {settings.enablePaymentOverdue ? (
                <span className="inline-flex items-center gap-1 text-xs font-medium text-rose-700 bg-rose-50 px-2 py-0.5 rounded-full">
                  <AlertTriangle className="w-3 h-3" />
                  Enforced
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 bg-slate-100 px-2 py-0.5 rounded-full">
                  <Clock className="w-3 h-3" />
                  Not Active
                </span>
              )}
            </div>
          </SettingRow>
        </div>
      </SectionCard>

      {/* Default Subscription */}
      <SectionCard
        title="Default Subscription"
        description="Default billing cycle and payment settings for new subscriptions"
        icon={CreditCard}
      >
        <SettingRow
          label="Default Cycle"
          description="Default billing cycle when creating new subscriptions"
        >
          <select
            id="defaultCycle"
            value={settings.defaultCycle}
            onChange={(e) => onChange({ defaultCycle: e.target.value })}
            className={selectClass}
          >
            <option value="MONTHLY">Monthly</option>
            <option value="QUARTERLY">Quarterly</option>
            <option value="SEMI_ANNUAL">Semi-Annual</option>
            <option value="YEARLY">Yearly</option>
          </select>
        </SettingRow>

        <SettingRow
          label="Payment Method"
          description="How subscription payments are collected. Chapa enables online payment (Telebirr, CBE Birr, cards)."
        >
          <select
            id="paymentMethod"
            value={settings.paymentMethod}
            onChange={(e) => onChange({ paymentMethod: e.target.value })}
            className={selectClass}
          >
            <option value="manual">Manual (Offline)</option>
            <option value="chapa">Chapa (Online - Telebirr, CBE Birr, Cards)</option>
          </select>
        </SettingRow>

        <SettingRow
          label="Late Payment Penalty"
          description="Penalty percentage applied for late subscription renewals"
        >
          <NumberInput
            id="latePaymentPenalty"
            value={settings.latePaymentPenalty}
            onChange={(v) => onPricingSave({ latePaymentPenalty: v })}
            min={0}
            max={100}
            step={0.5}
            suffix="%"
          />
        </SettingRow>
      </SectionCard>

      {/* Currency & Payment Info */}
      <SectionCard
        title="Currency & Payment Info"
        description="Currency display and payment instructions shown to providers"
        icon={Globe}
      >
        <SettingRow
          label="Currency"
          description="Currency used for subscription pricing"
        >
          <select
            id="currency"
            value={settings.currency}
            onChange={(e) => {
              const symbolMap: Record<string, string> = {
                ETB: "Br",
                USD: "$",
                EUR: "€",
              };
              onChange({
                currency: e.target.value,
                currencySymbol: symbolMap[e.target.value] || e.target.value,
              });
            }}
            className={selectClass}
          >
            <option value="ETB">ETB — Ethiopian Birr</option>
            <option value="USD">USD — US Dollar</option>
            <option value="EUR">EUR — Euro</option>
          </select>
        </SettingRow>

        <SettingRow
          label="Currency Symbol"
          description="Symbol displayed next to amounts"
        >
          <input
            id="currencySymbol"
            type="text"
            value={settings.currencySymbol}
            onChange={(e) => onChange({ currencySymbol: e.target.value })}
            className={inputClass}
          />
        </SettingRow>

        <div className="py-4 space-y-4">
          <div>
            <FormLabel htmlFor="paymentInstructions">
              Payment Instructions
            </FormLabel>
            <p className="text-xs text-slate-500 mb-2">
              Instructions shown to providers on the subscription page.
            </p>
            <textarea
              id="paymentInstructions"
              value={settings.paymentInstructions}
              onChange={(e) =>
                onChange({ paymentInstructions: e.target.value })
              }
              className={textareaClass}
              rows={3}
              placeholder="e.g. Contact your administrator to arrange payment."
            />
          </div>
        </div>
      </SectionCard>
    </div>
  );
}

// ── Emergency Contacts Tab ──

interface EmergencyContact {
  id: string;
  type: "police" | "hospital" | "custom";
  label: string;
  labelAm?: string;
  phone: string;
  icon: string;
  color: string;
  sortOrder: number;
}

const ICON_OPTIONS = [
  { value: "shield", label: "🛡️ Shield (Police)" },
  { value: "heart-pulse", label: "❤️ Heart (Hospital)" },
  { value: "flame", label: "🔥 Flame (Fire)" },
  { value: "ambulance", label: "🚑 Ambulance" },
  { value: "siren", label: "🚨 Siren" },
  { value: "alert-triangle", label: "⚠️ Alert" },
  { value: "phone", label: "📞 Phone" },
];

const COLOR_OPTIONS = [
  { value: "red", label: "🔴 Red" },
  { value: "orange", label: "🟠 Orange" },
  { value: "amber", label: "🟡 Amber" },
  { value: "rose", label: "🌸 Rose" },
  { value: "emerald", label: "🟢 Emerald" },
  { value: "sky", label: "🔵 Sky" },
  { value: "indigo", label: "🟣 Indigo" },
];

function EmergencyTab() {
  const [contacts, setContacts] = useState<EmergencyContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Fetch contacts on mount
  useEffect(() => {
    fetch("/api/admin/emergency-contacts", { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        setContacts(Array.isArray(data.contacts) ? data.contacts : []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const save = () => {
    setSaving(true);
    fetch("/api/admin/emergency-contacts", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contacts }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.contacts) setContacts(data.contacts);
        toast.success("Emergency contacts saved — visible on all apps");
      })
      .catch(() => toast.error("Failed to save emergency contacts"))
      .finally(() => setSaving(false));
  };

  const updateContact = (id: string, partial: Partial<EmergencyContact>) => {
    setContacts((prev) => prev.map((c) => (c.id === id ? { ...c, ...partial } : c)));
  };

  const removeContact = (id: string) => {
    setContacts((prev) => prev.filter((c) => c.id !== id));
  };

  const addContact = () => {
    const newId = `custom-${Date.now()}`;
    setContacts((prev) => [
      ...prev,
      {
        id: newId,
        type: "custom",
        label: "New Contact",
        labelAm: "",
        phone: "",
        icon: "phone",
        color: "sky",
        sortOrder: prev.length + 1,
      },
    ]);
  };

  const moveContact = (id: string, direction: "up" | "down") => {
    setContacts((prev) => {
      const idx = prev.findIndex((c) => c.id === id);
      if (idx === -1) return prev;
      const newIdx = direction === "up" ? idx - 1 : idx + 1;
      if (newIdx < 0 || newIdx >= prev.length) return prev;
      const newArr = [...prev];
      [newArr[idx], newArr[newIdx]] = [newArr[newIdx], newArr[idx]];
      // Re-assign sortOrder based on new position
      return newArr.map((c, i) => ({ ...c, sortOrder: i + 1 }));
    });
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
      <SectionCard
        icon={Siren}
        title="Emergency Contacts"
        description="Configure the emergency phone numbers shown in the floating Emergency Call button across ALL apps (web admin, /find, /m, /police-app, /owner). Changes are visible immediately after saving."
      >
        {/* Contacts list */}
        <div className="space-y-3">
          {contacts.length === 0 && (
            <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800">
              No emergency contacts configured. The button will show defaults (Police 9141, Hospital 5645).
            </div>
          )}

          {contacts.map((contact, idx) => (
            <div
              key={contact.id}
              className="rounded-xl border border-slate-200 bg-slate-50/50 p-3"
            >
              {/* Top row: drag handle + delete */}
              <div className="mb-2 flex items-center justify-between">
                <div className="flex items-center gap-1">
                  <GripVertical className="h-4 w-4 text-slate-400" />
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                    Contact #{idx + 1} · {contact.type}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => moveContact(contact.id, "up")}
                    disabled={idx === 0}
                    className="rounded p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-700 disabled:opacity-30"
                    title="Move up"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="m18 15-6-6-6 6"/></svg>
                  </button>
                  <button
                    onClick={() => moveContact(contact.id, "down")}
                    disabled={idx === contacts.length - 1}
                    className="rounded p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-700 disabled:opacity-30"
                    title="Move down"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="m6 9 6 6 6-6"/></svg>
                  </button>
                  <button
                    onClick={() => removeContact(contact.id)}
                    className="rounded p-1 text-red-400 hover:bg-red-100 hover:text-red-700"
                    title="Remove"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              {/* Fields grid */}
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div>
                  <label className="mb-0.5 block text-[10px] font-medium text-slate-600">Label (English)</label>
                  <input
                    type="text"
                    value={contact.label}
                    onChange={(e) => updateContact(contact.id, { label: e.target.value })}
                    placeholder="e.g. Bishoftu Police"
                    className={inputClass + " text-xs"}
                  />
                </div>
                <div>
                  <label className="mb-0.5 block text-[10px] font-medium text-slate-600">Label (Amharic)</label>
                  <input
                    type="text"
                    value={contact.labelAm || ""}
                    onChange={(e) => updateContact(contact.id, { labelAm: e.target.value })}
                    placeholder="ለምሳሌ የቢሾፍቱ ፖሊስ"
                    className={inputClass + " text-xs"}
                    dir="auto"
                  />
                </div>
                <div>
                  <label className="mb-0.5 block text-[10px] font-medium text-slate-600">Phone number</label>
                  <input
                    type="tel"
                    value={contact.phone}
                    onChange={(e) => updateContact(contact.id, { phone: e.target.value })}
                    placeholder="e.g. 9141"
                    className={inputClass + " text-xs"}
                    dir="ltr"
                  />
                </div>
                <div>
                  <label className="mb-0.5 block text-[10px] font-medium text-slate-600">Type</label>
                  <select
                    value={contact.type}
                    onChange={(e) => updateContact(contact.id, { type: e.target.value as any })}
                    className={inputClass + " text-xs"}
                  >
                    <option value="police">Police</option>
                    <option value="hospital">Hospital</option>
                    <option value="custom">Custom</option>
                  </select>
                </div>
                <div>
                  <label className="mb-0.5 block text-[10px] font-medium text-slate-600">Icon</label>
                  <select
                    value={contact.icon}
                    onChange={(e) => updateContact(contact.id, { icon: e.target.value })}
                    className={inputClass + " text-xs"}
                  >
                    {ICON_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-0.5 block text-[10px] font-medium text-slate-600">Color</label>
                  <select
                    value={contact.color}
                    onChange={(e) => updateContact(contact.id, { color: e.target.value })}
                    className={inputClass + " text-xs"}
                  >
                    {COLOR_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Preview */}
              <div className="mt-2 flex items-center gap-2 rounded-lg bg-white px-3 py-2 ring-1 ring-slate-200">
                <span className="text-[10px] font-medium text-slate-500">Preview:</span>
                <a
                  href={`tel:${contact.phone}`}
                  className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-semibold text-sky-700 hover:bg-sky-50"
                >
                  <Phone className="h-3 w-3" />
                  {contact.label} · {contact.phone}
                </a>
              </div>
            </div>
          ))}
        </div>

        {/* Add + Save buttons */}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
          <button
            onClick={addContact}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50"
          >
            <Plus className="h-3.5 w-3.5" />
            Add new contact
          </button>

          <button
            onClick={save}
            disabled={saving}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            Save contacts
          </button>
        </div>
      </SectionCard>

      {/* Info note */}
      <div className="flex items-start gap-2 rounded-lg bg-sky-50 px-3 py-2 text-[11px] text-sky-900 ring-1 ring-sky-200">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sky-600" />
        <div>
          <p className="font-semibold">Where do these contacts appear?</p>
          <p className="mt-0.5">
            The floating red Emergency Call button (bottom-left corner) shows these contacts on every page:
            web admin, /find (Bishoftu Bed Service), /m (mobile app), /police-app, and /owner.
            The button fetches the latest contacts from the API every 5 minutes, so changes are visible
            to users within 5 minutes of saving.
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Main Page Component ──

export default function SuperSystemConfigPage() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<TabKey>("general");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const [config, setConfig] = useState<SystemConfig>(FULL_DEFAULTS);

  // ── Fetch settings on mount ──

  const fetchSettings = useCallback(async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem("ghms_token");
      const headers: HeadersInit = { "Content-Type": "application/json" };
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }

      const res = await fetch("/api/settings", { headers });

      if (!res.ok) {
        throw new Error(`Failed to fetch settings (${res.status})`);
      }

      const data = await res.json();

      // Merge fetched data with defaults to ensure all keys exist
      setConfig({
        general: { ...DEFAULT_GENERAL, ...data.general },
        guesthouse: { ...DEFAULT_GUESTHOUSE, ...data.guesthouse },
        security: { ...DEFAULT_SECURITY, ...data.security },
        notifications: { ...DEFAULT_NOTIFICATIONS, ...data.notifications },
      payment: { ...DEFAULT_PAYMENT, ...data.payment },
      });
    } catch (err) {
      // API may not support this shape yet — use defaults
      console.warn("Could not load system config, using defaults:", err);
      setConfig(FULL_DEFAULTS);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  // ── Save settings ──

  const handleSave = async () => {
    setSaving(true);
    try {
      const token = localStorage.getItem("ghms_token");
      const headers: HeadersInit = { "Content-Type": "application/json" };
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }

      const res = await fetch("/api/settings", {
        method: "PUT",
        headers,
        body: JSON.stringify(config),
      });

      if (!res.ok) {
        // Fallback to POST if PUT not supported
        const resPost = await fetch("/api/settings", {
          method: "POST",
          headers,
          body: JSON.stringify(config),
        });
        if (!resPost.ok) {
          throw new Error(`Failed to save settings (${resPost.status})`);
        }
      }

      setDirty(false);
      // ── Refresh the cached support phone immediately so the toast.error
      // wrapper picks up the new value without requiring a re-login. ──
      try {
        const { setSupportPhone } = await import("@/lib/support");
        setSupportPhone(config.general?.supportPhone || "");
      } catch {
        /* non-blocking — next page load will pick it up via /api/config/public */
      }
      toast.success("System configuration saved successfully");
    } catch (err) {
      console.error("Save failed:", err);
      toast.error("Failed to save configuration. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  // ── Reset to defaults ──

  const handleReset = () => {
    setConfig(FULL_DEFAULTS);
    setDirty(true);
    toast.info("All settings reset to defaults. Save to apply.");
  };

  // ── Updaters ──

  const updateGeneral = useCallback(
    (partial: Partial<GeneralSettings>) => {
      setConfig((prev) => ({ ...prev, general: { ...prev.general, ...partial } }));
      setDirty(true);
    },
    []
  );

  const updateGuesthouse = useCallback(
    (partial: Partial<GuesthouseSettings>) => {
      setConfig((prev) => ({
        ...prev,
        guesthouse: { ...prev.guesthouse, ...partial },
      }));
      setDirty(true);
    },
    []
  );

  const updateSecurity = useCallback(
    (partial: Partial<SecuritySettings>) => {
      setConfig((prev) => ({
        ...prev,
        security: { ...prev.security, ...partial },
      }));
      setDirty(true);
    },
    []
  );

  const updateNotifications = useCallback(
    (partial: Partial<NotificationSettings>) => {
      setConfig((prev) => ({
        ...prev,
        notifications: { ...prev.notifications, ...partial },
      }));
      setDirty(true);
    },
    []
  );

  const updatePayment = useCallback(
    (partial: Partial<PaymentSettings>) => {
      setConfig((prev) => ({
        ...prev,
        payment: { ...prev.payment, ...partial },
      }));
      setDirty(true);
    },
    []
  );

  // Auto-save pricing changes immediately (toggle + price) so they persist across reloads
  const autoSavePricing = useCallback(
    async (partial: Partial<PaymentSettings>) => {
      setConfig((prev) => {
        const updated = { ...prev, payment: { ...prev.payment, ...partial } };
        // Fire-and-forget save in background
        const token = localStorage.getItem("ghms_token");
        const headers: HeadersInit = { "Content-Type": "application/json" };
        if (token) headers["Authorization"] = `Bearer ${token}`;
        fetch("/api/settings", {
          method: "PUT",
          headers,
          body: JSON.stringify(updated),
        }).catch(() => {});
        return updated;
      });
      setDirty(false);
      toast.success("Pricing updated and saved");
    },
    []
  );

  // ── Render ──

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-6">
        <div className="flex items-start gap-3">
          <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-slate-100 shrink-0">
            <Settings className="w-5 h-5 text-slate-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">
              System Configuration
            </h1>
            <p className="text-sm text-slate-500 mt-0.5">
              Configure Bishoftu Guest Management System settings and preferences
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleReset}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <RotateCcw className="w-4 h-4" />
            Reset Defaults
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !dirty}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:ring-offset-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Save className="w-4 h-4" />
            )}
            Save Changes
          </button>
        </div>
      </div>

      {/* ── Tab Bar ── */}
      <div className="border-b border-slate-200 mb-6 overflow-x-auto scrollbar-none">
        <nav className="flex gap-0 min-w-max" role="tablist" aria-label="Configuration sections">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                role="tab"
                aria-selected={isActive}
                aria-controls={`panel-${tab.key}`}
                onClick={() => setActiveTab(tab.key)}
                className={
                  `relative inline-flex items-center gap-2 px-4 py-3 text-sm font-medium whitespace-nowrap transition-colors focus:outline-none ` +
                  (isActive
                    ? "text-primary border-b-2 border-primary"
                    : "text-slate-500 hover:text-slate-700 border-b-2 border-transparent")
                }
              >
                <Icon className="w-4 h-4" />
                {tab.label}
              </button>
            );
          })}
        </nav>
      </div>

      {/* ── Tab Content ── */}
      {loading ? (
        <div className="space-y-5">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="rounded-xl border border-slate-200 bg-white p-5 animate-pulse"
            >
              <div className="flex items-start gap-3 mb-6">
                <div className="w-9 h-9 rounded-lg bg-slate-100" />
                <div className="space-y-2 flex-1">
                  <div className="h-4 w-40 rounded bg-slate-100" />
                  <div className="h-3 w-56 rounded bg-slate-50" />
                </div>
              </div>
              <div className="space-y-4">
                <div className="flex justify-between py-3">
                  <div className="space-y-2 flex-1 pr-4">
                    <div className="h-4 w-36 rounded bg-slate-100" />
                    <div className="h-3 w-48 rounded bg-slate-50" />
                  </div>
                  <div className="h-9 w-56 rounded-lg bg-slate-100" />
                </div>
                <div className="flex justify-between py-3">
                  <div className="space-y-2 flex-1 pr-4">
                    <div className="h-4 w-32 rounded bg-slate-100" />
                    <div className="h-3 w-52 rounded bg-slate-50" />
                  </div>
                  <div className="h-9 w-56 rounded-lg bg-slate-100" />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div role="tabpanel" id={`panel-${activeTab}`}>
          {activeTab === "general" && (
            <GeneralTab settings={config.general} onChange={updateGeneral} />
          )}
          {activeTab === "guesthouse" && (
            <GuesthouseTab
              settings={config.guesthouse}
              onChange={updateGuesthouse}
            />
          )}
          {activeTab === "security" && (
            <SecurityTab
              settings={config.security}
              onChange={updateSecurity}
            />
          )}
          {activeTab === "notifications" && (
            <NotificationsTab
              settings={config.notifications}
              onChange={updateNotifications}
            />
          )}
          {activeTab === "payment" && (
            <PaymentTab
              settings={config.payment}
              onChange={updatePayment}
              onPricingSave={autoSavePricing}
            />
          )}
          {activeTab === "emergency" && <EmergencyTab />}
        </div>
      )}
    </div>
  );
}
