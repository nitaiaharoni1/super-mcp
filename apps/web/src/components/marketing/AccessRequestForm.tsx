"use client";

import { useRef, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { he } from "@/content/he";
import { AnalyticsEvent, capture } from "@/lib/analytics";
import { getApiBaseUrl } from "@/lib/mcp";

type FormStatus = "idle" | "submitting" | "success" | "error" | "rate_limited";

export function AccessRequestForm() {
  const [status, setStatus] = useState<FormStatus>("idle");
  const submittingRef = useRef(false);
  const copy = he.access.form;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submittingRef.current || status === "submitting") return;

    const form = event.currentTarget;
    const data = new FormData(form);
    const email = String(data.get("email") ?? "").trim();
    const useCase = String(data.get("use_case") ?? "").trim();

    submittingRef.current = true;
    setStatus("submitting");
    try {
      const res = await fetch(`${getApiBaseUrl()}/v1/access-requests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, ...(useCase ? { use_case: useCase } : {}) }),
      });
      if (res.status === 429) {
        capture(AnalyticsEvent.AccessRequestFailed, { reason: "rate_limited" });
        setStatus("rate_limited");
        return;
      }
      if (!res.ok) throw new Error(`status ${res.status}`);
      capture(AnalyticsEvent.AccessRequestSubmitted, { has_use_case: useCase.length > 0 });
      setStatus("success");
    } catch {
      capture(AnalyticsEvent.AccessRequestFailed);
      setStatus("error");
    } finally {
      submittingRef.current = false;
    }
  }

  if (status === "success") {
    return (
      <div
        role="status"
        className="rounded-[var(--radius-card)] border-[2.5px] border-ink bg-lime-soft px-5 py-4 shadow-sticker-sm"
      >
        <p className="font-bold">{copy.successTitle}</p>
        <p className="mt-1 text-sm leading-6 text-ink-muted">{copy.successBody}</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-4">
      <div className="grid gap-2">
        <label htmlFor="access-email" className="text-sm font-bold">
          {copy.emailLabel}
        </label>
        <input
          id="access-email"
          name="email"
          type="email"
          required
          dir="ltr"
          autoComplete="email"
          placeholder={copy.emailPlaceholder}
          className="h-11 rounded-[var(--radius-card)] border-[2.5px] border-ink bg-paper-raised px-4 text-start font-[family-name:var(--font-geist-mono)] text-sm text-ink placeholder:text-ink-faint focus:shadow-sticker-sm"
        />
      </div>
      <div className="grid gap-2">
        <label htmlFor="access-use-case" className="text-sm font-bold">
          {copy.useCaseLabel}
        </label>
        <textarea
          id="access-use-case"
          name="use_case"
          rows={2}
          maxLength={2000}
          placeholder={copy.useCasePlaceholder}
          className="resize-y rounded-[var(--radius-card)] border-[2.5px] border-ink bg-paper-raised px-4 py-3 text-sm leading-6 text-ink placeholder:text-ink-faint focus:shadow-sticker-sm"
        />
      </div>
      <p className="text-xs leading-5 text-ink-muted">{copy.reassurance}</p>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="lg" disabled={status === "submitting"}>
          {status === "submitting" ? copy.submitting : copy.submit}
        </Button>
        {status === "error" && (
          <p role="alert" className="text-sm text-red-700">
            {copy.error}
          </p>
        )}
        {status === "rate_limited" && (
          <p role="alert" className="text-sm text-red-700">
            {copy.rateLimited}
          </p>
        )}
      </div>
    </form>
  );
}
