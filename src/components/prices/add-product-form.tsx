"use client";

import { useState } from "react";
import { Link2, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { useLocale, useTranslations } from "next-intl";

import { usePreviewProduct, useAddProduct, type PreviewDTO } from "@/hooks/use-prices";
import { formatMoney, sourceKey } from "@/lib/price-format";
import type { PriceSource } from "@/types";

/**
 * Two-step add: paste the URL, see what the server understood, confirm.
 *
 * The confirmation step is not ceremony — the price it captures becomes the
 * reference every future alert is measured against, so a wrong read must be
 * caught here rather than turned into months of silence or false alarms.
 */
export function AddProductForm() {
  const t = useTranslations("prices");
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const [url, setUrl] = useState("");
  const [preview, setPreview] = useState<PreviewDTO | null>(null);
  const [title, setTitle] = useState("");
  const [price, setPrice] = useState("");
  // Which detected source the shown price came from. Null once the user types a
  // number that matches no detected price → the cron re-guesses generically.
  const [hintSource, setHintSource] = useState<PriceSource | null>(null);

  const previewProduct = usePreviewProduct();
  const addProduct = useAddProduct();

  function reset(): void {
    setPreview(null);
    setUrl("");
    setTitle("");
    setPrice("");
    setHintSource(null);
  }

  function handleRead(): void {
    const trimmed = url.trim();
    if (trimmed.length === 0) return;
    previewProduct.mutate(trimmed, {
      onSuccess: ({ preview: result }) => {
        if (result.existingId) {
          toast.info(t("alreadyTracked"));
          reset();
          return;
        }
        setPreview(result);
        setTitle((result.title ?? result.domain).slice(0, 200));
        setPrice(result.price === null ? "" : String(result.price));
        setHintSource(result.options[0]?.source ?? null);
      },
    });
  }

  /** Pick a detected price: sets the value AND remembers where it came from. */
  function chooseOption(optPrice: number, source: PriceSource): void {
    setPrice(String(optPrice));
    setHintSource(source);
  }

  /** Hand-typed price: keep the hint only if it still matches a detected one. */
  function handleTypePrice(value: string): void {
    setPrice(value);
    const parsed = Number.parseFloat(value.replace(",", "."));
    const match = preview?.options.find((o) => Math.abs(o.price - parsed) < 0.005);
    setHintSource(match?.source ?? null);
  }

  function handleSave(): void {
    if (!preview) return;
    // Accept both "239,00" and "239.00": the user types what the shop showed.
    const parsed = Number.parseFloat(price.replace(",", "."));
    if (!Number.isFinite(parsed) || parsed <= 0) {
      toast.error(t("invalidPrice"));
      return;
    }
    if (title.trim().length === 0) {
      toast.error(t("nameRequired"));
      return;
    }
    addProduct.mutate(
      {
        url: preview.url,
        basePrice: parsed,
        title: title.trim(),
        imageUrl: preview.imageUrl,
        currency: preview.currency,
        hintSource,
      },
      { onSuccess: reset },
    );
  }

  if (!preview) {
    return (
      <div className="flex items-center gap-2 rounded-[16px] border border-line bg-surface p-2 shadow-[var(--e1)]">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] bg-chip text-muted">
          <Link2 size={17} />
        </span>
        <input
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") handleRead();
          }}
          inputMode="url"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          placeholder={t("urlPlaceholder")}
          aria-label={t("urlLabel")}
          className="min-w-0 flex-1 bg-transparent text-[15px] font-medium text-ink outline-none placeholder:text-muted"
        />
        <button
          onClick={handleRead}
          disabled={previewProduct.isPending || url.trim().length === 0}
          className="tap-press flex h-9 shrink-0 items-center gap-1.5 rounded-[11px] bg-brand px-3.5 text-[13px] font-bold text-on-brand disabled:opacity-40"
        >
          {previewProduct.isPending && <Loader2 size={14} className="animate-spin" />}
          {t("read")}
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-[16px] border border-line bg-surface p-4 shadow-[var(--e1)]">
      <div className="flex items-start gap-3">
        {preview.imageUrl ? (
          // Remote shop images: <img> on purpose, next/image would need every
          // shop's host in next.config remotePatterns.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={preview.imageUrl}
            alt=""
            className="h-14 w-14 shrink-0 rounded-[12px] border border-line object-contain"
          />
        ) : (
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-[12px] bg-chip text-xl">
            🏷️
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-bold uppercase tracking-wide text-muted">{preview.domain}</div>
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={200}
            aria-label={t("nameLabel")}
            className="mt-1 w-full bg-transparent text-[15px] font-bold text-ink outline-none"
          />
        </div>
        <button
          onClick={reset}
          aria-label={tCommon("cancel")}
          className="tap-press flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-chip text-muted"
        >
          <X size={16} />
        </button>
      </div>

      {preview.error && (
        <p className="mt-3 rounded-[12px] bg-chip px-3 py-2 text-[12px] font-medium leading-relaxed text-ink-2">
          {t("readFailed", { reason: preview.error })}
        </p>
      )}

      {preview.options.length > 1 && (
        <div className="mt-3">
          <span className="text-[11px] font-bold uppercase tracking-wide text-muted">
            {t("candidates")}
          </span>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {preview.options.map((opt) => {
              const active =
                hintSource === opt.source &&
                Math.abs(Number.parseFloat(price.replace(",", ".")) - opt.price) < 0.005;
              return (
                <button
                  key={`${opt.source}:${opt.price}`}
                  onClick={() => chooseOption(opt.price, opt.source)}
                  className="tap-press rounded-full border px-3 py-1.5 text-[13px] font-bold"
                  style={{
                    borderColor: active ? "var(--brand)" : "var(--line)",
                    background: active ? "var(--brand-tint)" : "var(--surface)",
                    color: active ? "var(--brand-strong)" : "var(--ink)",
                  }}
                >
                  {formatMoney(opt.price, opt.currency, locale)}
                  <span className="ml-1 text-[10px] font-semibold text-muted">
                    {t(`source.${sourceKey(opt.source)}`)}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <label className="mt-3 block">
        <span className="text-[11px] font-bold uppercase tracking-wide text-muted">
          {t("referenceLabel")}
        </span>
        <div className="mt-1 flex items-center gap-2">
          <input
            value={price}
            onChange={(event) => handleTypePrice(event.target.value)}
            inputMode="decimal"
            placeholder="0,00"
            aria-label={t("referenceLabel")}
            className="min-w-0 flex-1 rounded-[12px] border border-line bg-surface-2 px-3 py-2.5 text-[15px] font-bold text-ink outline-none"
          />
          <span className="text-[13px] font-bold text-muted">{preview.currency}</span>
        </div>
        <span className="mt-1.5 block text-[11px] font-medium leading-relaxed text-muted">
          {hintSource
            ? t("willTrack", { name: t(`source.${sourceKey(hintSource)}`) })
            : t("willTrackManual")}
        </span>
      </label>

      <div className="mt-3 flex gap-2">
        <button
          onClick={handleSave}
          disabled={addProduct.isPending}
          className="tap-press flex h-11 flex-1 items-center justify-center gap-2 rounded-[13px] bg-brand text-[14px] font-bold text-on-brand disabled:opacity-40"
        >
          {addProduct.isPending && <Loader2 size={15} className="animate-spin" />}
          {t("track")}
        </button>
      </div>

      {preview.price !== null && (
        <p className="mt-2 text-center text-[11px] font-medium text-muted">
          {t("readInStore", { price: formatMoney(preview.price, preview.currency, locale) })}
        </p>
      )}
    </div>
  );
}
