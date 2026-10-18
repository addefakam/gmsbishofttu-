"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "@/lib/store";
import { apiGetProviderConversations, apiGetProviderThread, apiSendProviderMessage } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  MessageSquare, Send, ArrowLeft, Search, Building2, Users,
} from "lucide-react";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

interface Conversation {
  providerId: string;
  providerName: string;
  ownerName: string;
  phone: string;
  lastMessage: string;
  lastMessageAt: string;
  lastMessageFromMe: boolean;
  unreadCount: number;
}

interface ProviderInfo {
  id: string;
  name: string;
  ownerName: string;
  phone: string;
}

interface Message {
  id: string;
  fromProviderId: string;
  toProviderId: string;
  message: string;
  isRead: boolean;
  createdAt: string;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export default function ProviderMessagesPage() {
  const { t } = useTranslation();
  const { refreshKey, setCurrentPage } = useAppStore();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [allProviders, setAllProviders] = useState<ProviderInfo[]>([]);
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [otherProvider, setOtherProvider] = useState<ProviderInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [newMessage, setNewMessage] = useState("");
  const [showNewChat, setShowNewChat] = useState(false);
  const [newChatProvider, setNewChatProvider] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const fetchConversations = useCallback(async () => {
    try {
      const res = await apiGetProviderConversations();
      if (res?.conversations) setConversations(res.conversations);
      if (res?.allProviders) setAllProviders(res.allProviders);
    } catch {
      /* silent */
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchThread = useCallback(async (providerId: string) => {
    try {
      const res = await apiGetProviderThread(providerId);
      if (res?.messages) setMessages(res.messages);
      if (res?.otherProvider) setOtherProvider(res.otherProvider);
      // Refresh conversation list to update unread counts
      fetchConversations();
    } catch {
      /* silent */
    }
  }, [fetchConversations]);

  useEffect(() => {
    fetchConversations();
  }, [fetchConversations, refreshKey]);

  // Auto-refresh thread every 15 seconds when viewing a conversation
  useEffect(() => {
    if (!selectedProviderId) return;
    const interval = setInterval(() => fetchThread(selectedProviderId), 15000);
    return () => clearInterval(interval);
  }, [selectedProviderId, fetchThread]);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = async () => {
    if (!newMessage.trim() || !selectedProviderId) return;
    setSending(true);
    try {
      await apiSendProviderMessage(selectedProviderId, newMessage.trim());
      setNewMessage("");
      await fetchThread(selectedProviderId);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to send";
      // Check if it's a navigation request (from ?with=...) — if so, use that
      const urlParams = new URLSearchParams(window.location.search);
      const fromParam = urlParams.get("from");
      if (fromParam) {
        setSelectedProviderId(fromParam);
        fetchThread(fromParam);
      }
    } finally {
      setSending(false);
    }
  };

  // Check for ?from=<providerId> query param (from "Contact" button on All Guesthouses)
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const fromParam = urlParams.get("from");
    if (fromParam && !selectedProviderId) {
      setSelectedProviderId(fromParam);
      fetchThread(fromParam);
    }
  }, []);

  const handleStartNewChat = () => {
    if (!newChatProvider) return;
    setSelectedProviderId(newChatProvider);
    fetchThread(newChatProvider);
    setShowNewChat(false);
    setNewChatProvider("");
  };

  if (loading) {
    return (
      <div className="space-y-6 p-4 md:p-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 rounded-lg" />
      </div>
    );
  }

  // ── Thread view (full conversation with one provider) ──
  if (selectedProviderId && otherProvider) {
    return (
      <div className="flex flex-col h-[calc(100vh-80px)] p-4 md:p-6">
        {/* Thread header */}
        <div className="flex items-center gap-3 mb-3 pb-3 border-b">
          <Button variant="ghost" size="sm" onClick={() => { setSelectedProviderId(null); setMessages([]); fetchConversations(); }}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-100 text-indigo-700">
            <Building2 className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-slate-900">{otherProvider.name}</h2>
            {otherProvider.ownerName && <p className="text-xs text-slate-500">{otherProvider.ownerName}</p>}
          </div>
        </div>

        {/* Messages */}
        <ScrollArea className="flex-1 rounded-lg border bg-slate-50 p-3">
          <div className="space-y-2">
            {messages.length === 0 ? (
              <div className="text-center py-8">
                <MessageSquare className="h-8 w-8 text-slate-300 mx-auto mb-2" />
                <p className="text-sm text-slate-400">
                  {t("noMessagesYet", { defaultValue: "No messages yet. Say hello!" })}
                </p>
              </div>
            ) : (
              messages.map((msg) => {
                const isFromMe = msg.fromProviderId === otherProvider.id ? false : true;
                return (
                  <div key={msg.id} className={`flex ${isFromMe ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[75%] rounded-lg px-3 py-2 text-sm ${
                      isFromMe
                        ? "bg-indigo-600 text-white rounded-br-none"
                        : "bg-white border border-slate-200 text-slate-800 rounded-bl-none"
                    }`}>
                      <p className="break-words">{msg.message}</p>
                      <p className={`text-[10px] mt-1 ${isFromMe ? "text-indigo-200" : "text-slate-400"}`}>
                        {formatTime(msg.createdAt)}
                      </p>
                    </div>
                  </div>
                );
              })
            )}
            <div ref={messagesEndRef} />
          </div>
        </ScrollArea>

        {/* Message input */}
        <div className="mt-3 flex gap-2">
          <Input
            placeholder={t("typeMessage", { defaultValue: "Type your message..." })}
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
            disabled={sending}
            maxLength={1000}
          />
          <Button onClick={handleSend} disabled={sending || !newMessage.trim()} className="bg-indigo-600 hover:bg-indigo-700">
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
    );
  }

  // ── Conversation list view ──
  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <MessageSquare className="h-6 w-6 text-indigo-600" />
            {t("providerMessages", { defaultValue: "Provider Messages" })}
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            {t("providerMessagesSubtitle", { defaultValue: "Contact other guesthouse operators when your rooms are full" })}
          </p>
        </div>
        <Button onClick={() => setShowNewChat(!showNewChat)} className="gap-2">
          <Users className="h-4 w-4" />
          {t("newChat", { defaultValue: "New Chat" })}
        </Button>
      </div>

      {/* New chat picker */}
      {showNewChat && (
        <Card className="border-indigo-200 bg-indigo-50/50">
          <CardContent className="p-4">
            <p className="text-sm font-medium text-slate-700 mb-2">
              {t("selectProvider", { defaultValue: "Select a guesthouse to message:" })}
            </p>
            <Select value={newChatProvider} onValueChange={setNewChatProvider}>
              <SelectTrigger><SelectValue placeholder={t("selectGuesthouse", { defaultValue: "Select a guesthouse..." })} /></SelectTrigger>
              <SelectContent>
                {allProviders.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}{p.ownerName ? ` — ${p.ownerName}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button onClick={handleStartNewChat} disabled={!newChatProvider} className="mt-2 bg-indigo-600 hover:bg-indigo-700">
              {t("startChat", { defaultValue: "Start Chat" })}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Conversation list */}
      {conversations.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <MessageSquare className="h-12 w-12 text-slate-300 mx-auto mb-3" />
            <p className="text-sm text-slate-500 mb-2">
              {t("noConversations", { defaultValue: "No conversations yet." })}
            </p>
            <p className="text-xs text-slate-400">
              {t("noConversationsHint", { defaultValue: "Click 'New Chat' to contact another guesthouse, or use the 'Contact' button on the All Guesthouses page." })}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {conversations.map((conv) => (
            <Card
              key={conv.providerId}
              className="cursor-pointer hover:shadow-md transition-shadow"
              onClick={() => { setSelectedProviderId(conv.providerId); fetchThread(conv.providerId); }}
            >
              <CardContent className="p-3 flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-indigo-100 text-indigo-700">
                  <Building2 className="h-5 w-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-slate-800 truncate">{conv.providerName}</p>
                    <span className="text-[10px] text-slate-400 shrink-0">{timeAgo(conv.lastMessageAt)}</span>
                  </div>
                  <p className="text-xs text-slate-500 truncate">
                    {conv.lastMessageFromMe ? "You: " : ""}
                    {conv.lastMessage}
                  </p>
                </div>
                {conv.unreadCount > 0 && (
                  <Badge className="bg-indigo-600 text-white hover:bg-indigo-600 text-[10px] px-1.5 py-0">
                    {conv.unreadCount}
                  </Badge>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
