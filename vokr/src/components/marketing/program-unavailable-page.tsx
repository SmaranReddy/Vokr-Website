import Link from "next/link";

import type { UnavailableProgram } from "@/config/programs";

/**
 * The whole page for a program that does not exist (§2A.6 row L1): its
 * name, a plain statement that it isn't available and provides no
 * benefits, and a way back. Deliberately nothing else — no offer, no
 * figures, no form, no "apply" or "start" call to action.
 */
export function ProgramUnavailablePage({ program }: { program: UnavailableProgram }) {
  return (
    <section className="px-5 py-20 text-center sm:py-28">
      <div className="mx-auto max-w-2xl">
        <h1 className="mb-6 text-4xl leading-[1.08] font-bold tracking-tight sm:text-5xl">
          {program.name}
        </h1>
        <p
          role="note"
          className="mx-auto mb-8 max-w-xl border border-border-strong bg-surface-2 px-5 py-4 text-[15px] font-medium text-foreground"
        >
          {program.notice}
        </p>
        <Link href="/" className="text-sm font-semibold underline underline-offset-2">
          Back to home &rarr;
        </Link>
      </div>
    </section>
  );
}
