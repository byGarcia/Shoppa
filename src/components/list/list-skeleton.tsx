"use client";

export function ListSkeleton() {
  const BAR = "rounded-[14px] bg-[linear-gradient(90deg,var(--surface-2)_25%,var(--chip)_37%,var(--surface-2)_63%)] bg-[length:720px_100%]";
  return (
    <div className="space-y-3" style={{ animation: "fadeIn .3s ease" }} aria-hidden>
      <div className={`h-4 w-2/5 rounded-md ${BAR}`} style={{ animation: "shimmer 1.3s infinite linear" }} />
      <div className={`h-12 ${BAR}`} style={{ animation: "shimmer 1.3s infinite linear" }} />
      <div className={`h-12 ${BAR}`} style={{ animation: "shimmer 1.3s infinite linear" }} />
      <div className={`mt-2 h-4 w-1/3 rounded-md ${BAR}`} style={{ animation: "shimmer 1.3s infinite linear" }} />
      <div className={`h-12 ${BAR}`} style={{ animation: "shimmer 1.3s infinite linear" }} />
    </div>
  );
}
