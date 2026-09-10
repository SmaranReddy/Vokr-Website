import type { ReactNode } from "react";

/** The `.support-page` / `.cp-body` wrapper shared by `terms.html` and `privacy-policy.html`. */
export function LegalPageShell({
  title,
  sub,
  children,
}: {
  title: string;
  sub: string;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto max-w-[680px] px-5 py-16 sm:py-20">
      <p className="mb-3 text-[11px] font-semibold tracking-[.15em] text-muted uppercase">
        Legal
      </p>
      <h1 className="mb-3 text-3xl font-bold tracking-tight sm:text-4xl">
        {title}
      </h1>
      <p className="mb-10 text-[14.5px] leading-relaxed text-muted">{sub}</p>
      <div className="space-y-[18px] text-[14.5px] leading-[1.85] text-foreground/80 [&_a]:font-semibold [&_a]:text-foreground [&_a]:underline [&_a]:underline-offset-2 [&_strong]:font-bold [&_strong]:text-foreground">
        {children}
      </div>
    </div>
  );
}
