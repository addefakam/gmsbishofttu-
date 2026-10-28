"use client";

import { useState, useMemo, useEffect } from "react";
import { HelpCircle, Search, X, ChevronRight, Lightbulb } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  helpArticles,
  searchHelpArticles,
  getHelpForPage,
  type HelpArticle,
} from "@/data/operator-help";
import { useAppStore } from "@/lib/store";
import { useTranslation } from "react-i18next";

/**
 * Operator Help Widget — floating "?" button bottom-right.
 *
 * Click → opens a slide-over panel showing the help article for the
 * current page (contextual). Includes a search box for finding other
 * articles. If no keyword match, shows all articles.
 *
 * v1 = pure static (no LLM). The LLM fallback (for when keyword search
 * returns 0 matches) can be added later — see the TODO in handleSearch().
 */
export function OperatorHelpWidget() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedArticle, setSelectedArticle] = useState<HelpArticle | null>(null);

  // Get current page from the app store (sidebar.tsx sets this)
  const currentPage = useAppStore((s) => s.currentPage) || "dashboard";

  // i18n — use the user's preferred language. Falls back to "en" if i18n not loaded.
  const { i18n } = useTranslation();
  const lang: "en" | "am" | "om" = (i18n.language as "en" | "am" | "om") || "en";

  // When the panel opens, show the article for the current page (contextual help)
  useEffect(() => {
    if (open && !query && !selectedArticle) {
      const article = getHelpForPage(currentPage);
      if (article) setSelectedArticle(article);
    }
  }, [open, currentPage, query, selectedArticle]);

  // Search results — recomputed when query changes
  const searchResults = useMemo(() => {
    if (!query.trim()) return null; // null = show "current page" article or all articles
    return searchHelpArticles(query);
  }, [query]);

  const localized = (s: { en: string; am: string; om: string }) => s[lang] || s.en;

  const handleSearch = (value: string) => {
    setQuery(value);
    setSelectedArticle(null); // clear selection when searching
    // TODO: Add LLM fallback here when search returns 0 matches.
    // For now, just show "no results" — the static articles cover the
    // most common questions.
  };

  const handleArticleClick = (article: HelpArticle) => {
    setSelectedArticle(article);
    setQuery(""); // clear search when an article is selected
  };

  return (
    <>
      {/* Floating "?" button — bottom-right */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-indigo-600 text-white shadow-lg shadow-indigo-600/30 transition-all hover:bg-indigo-700 hover:shadow-xl hover:shadow-indigo-600/40 active:scale-95"
        aria-label="Help"
        title="Help"
      >
        <HelpCircle className="h-6 w-6" />
      </button>

      {/* Slide-over panel */}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="w-full sm:max-w-md p-0">
          <SheetHeader className="px-6 pt-6 pb-4 border-b">
            <SheetTitle className="flex items-center gap-2">
              <HelpCircle className="h-5 w-5 text-indigo-600" />
              Operator Help
            </SheetTitle>
            <SheetDescription>
              {selectedArticle
                ? localized(selectedArticle.title)
                : query
                  ? `Search results for: "${query}"`
                  : `Help for ${currentPage} page`}
            </SheetDescription>
          </SheetHeader>

          {/* Search box */}
          <div className="px-6 py-4 border-b">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                value={query}
                onChange={(e) => handleSearch(e.target.value)}
                placeholder="Search help articles..."
                className="pl-9 pr-9"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
                  aria-label="Clear search"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>

          {/* Content */}
          <ScrollArea className="h-[calc(100vh-180px)]">
            <div className="px-6 py-4">
              {/* ─── Article detail view ─── */}
              {selectedArticle ? (
                <div className="space-y-4">
                  <button
                    type="button"
                    onClick={() => setSelectedArticle(null)}
                    className="text-sm text-indigo-600 hover:underline flex items-center gap-1"
                  >
                    <ChevronRight className="h-3 w-3 rotate-180" />
                    Back to list
                  </button>

                  <h3 className="text-lg font-semibold text-slate-900">
                    {localized(selectedArticle.title)}
                  </h3>

                  <ol className="space-y-3">
                    {selectedArticle.steps.map((step, i) => (
                      <li key={i} className="flex gap-3">
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-xs font-semibold text-indigo-700">
                          {i + 1}
                        </span>
                        <p className="text-sm text-slate-700 leading-relaxed pt-0.5">
                          {localized(step)}
                        </p>
                      </li>
                    ))}
                  </ol>

                  {selectedArticle.tips && selectedArticle.tips.length > 0 && (
                    <div className="mt-6 rounded-lg bg-amber-50 border border-amber-200 p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <Lightbulb className="h-4 w-4 text-amber-600" />
                        <span className="text-sm font-semibold text-amber-900">
                          {lang === "am" ? "ጠቃሚ ምክሮች" : lang === "om" ? "Gorsa barbaachisaa" : "Tips"}
                        </span>
                      </div>
                      <ul className="space-y-1.5">
                        {selectedArticle.tips.map((tip, i) => (
                          <li key={i} className="text-sm text-amber-800 leading-relaxed pl-4 relative">
                            <span className="absolute left-0 top-1.5">•</span>
                            {localized(tip)}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              ) : (
                /* ─── List view (search results or current-page article) ─── */
                <div className="space-y-2">
                  {searchResults === null ? (
                    /* No search — show current-page article prominently, then all articles */
                    <>
                      {(() => {
                        const currentArticle = getHelpForPage(currentPage);
                        if (!currentArticle) return null;
                        return (
                          <button
                            type="button"
                            onClick={() => handleArticleClick(currentArticle)}
                            className="w-full text-left p-3 rounded-lg border-2 border-indigo-200 bg-indigo-50 hover:bg-indigo-100 transition"
                          >
                            <div className="text-xs font-medium text-indigo-600 mb-1">
                              CURRENT PAGE
                            </div>
                            <div className="font-medium text-slate-900">
                              {localized(currentArticle.title)}
                            </div>
                            <div className="text-xs text-slate-500 mt-1">
                              {currentArticle.steps.length} steps
                            </div>
                          </button>
                        );
                      })()}
                      <div className="text-xs font-medium text-slate-400 uppercase tracking-wide mt-4 mb-2">
                        All Articles
                      </div>
                    </>
                  ) : searchResults.length === 0 ? (
                    <div className="text-center py-8">
                      <Search className="h-8 w-8 text-slate-300 mx-auto mb-2" />
                      <p className="text-sm text-slate-500">
                        No articles match &quot;{query}&quot;
                      </p>
                      <p className="text-xs text-slate-400 mt-1">
                        Try different keywords or contact support.
                      </p>
                    </div>
                  ) : null}

                  {searchResults !== null
                    ? /* Search results */
                      searchResults.map((article) => (
                        <button
                          key={article.id}
                          type="button"
                          onClick={() => handleArticleClick(article)}
                          className="w-full text-left p-3 rounded-lg border border-slate-200 hover:bg-slate-50 transition"
                        >
                          <div className="font-medium text-slate-900">
                            {localized(article.title)}
                          </div>
                          <div className="text-xs text-slate-500 mt-1">
                            {article.steps.length} steps
                          </div>
                        </button>
                      ))
                    : /* All articles list */
                      helpArticles
                        .filter((a) => a.id !== getHelpForPage(currentPage)?.id)
                        .map((article) => (
                          <button
                            key={article.id}
                            type="button"
                            onClick={() => handleArticleClick(article)}
                            className="w-full text-left p-3 rounded-lg border border-slate-200 hover:bg-slate-50 transition"
                          >
                            <div className="font-medium text-slate-900">
                              {localized(article.title)}
                            </div>
                            <div className="text-xs text-slate-500 mt-1">
                              {article.steps.length} steps
                            </div>
                          </button>
                        ))}
                </div>
              )}
            </div>
          </ScrollArea>
        </SheetContent>
      </Sheet>
    </>
  );
}
