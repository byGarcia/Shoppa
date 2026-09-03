import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { useTranslations } from "next-intl";

type Props = {
  title: string;
  subtitle?: string;
  back?: string;
};

/** Back-chevron + Fraunces title used across the Ajustes sub-pages. */
export function PageHeader({ title, subtitle, back = "/ajustes" }: Props) {
  const t = useTranslations("common");

  return (
    <header className="flex items-center gap-3 py-3">
      <Link
        href={back}
        aria-label={t("back")}
        className="tap-press flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-full bg-surface text-ink shadow-[var(--e1)]"
      >
        <ChevronLeft size={20} />
      </Link>
      <div>
        <h1 className="font-display text-[22px] font-semibold leading-none text-ink">{title}</h1>
        {subtitle && <p className="mt-1 text-xs font-medium text-muted">{subtitle}</p>}
      </div>
    </header>
  );
}
