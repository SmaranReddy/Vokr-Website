import type { ReactNode } from "react";

/** The `.support-page` wrapper shared by all five standalone support pages — eyebrow, h1, sub, then page-specific content. */
export function SupportPageShell({
  title,
  sub,
  children,
}: {
  title: string;
  sub: string;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto max-w-3xl px-5 py-16 sm:py-20">
      <p className="mb-3 text-[11px] font-semibold tracking-[.15em] text-muted uppercase">
        Support
      </p>
      <h1 className="mb-3 text-3xl font-bold tracking-tight sm:text-4xl">
        {title}
      </h1>
      <p className="mb-10 text-[15px] text-muted">{sub}</p>
      {children}
    </div>
  );
}
