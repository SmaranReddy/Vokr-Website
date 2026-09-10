"use client";

import { useState, type ReactNode } from "react";

export interface AccordionItemData {
  id: string;
  label: ReactNode;
  icon?: ReactNode;
  content: ReactNode;
}

/**
 * Generic accessible disclosure list backing the legacy `.acc-item` /
 * `.support-faq-item` patterns. Each item toggles independently — the
 * legacy JS does `item.classList.toggle('open')` on the clicked item
 * alone, so more than one can be open at once; this is *not* an
 * exclusive accordion (that behaviour belongs to `.support-toggle-item`,
 * implemented separately in `support-group.tsx`, which does close the
 * others). `defaultOpenId` reproduces the legacy's "first item open"
 * state.
 */
export function Accordion({
  items,
  defaultOpenId,
  variant = "default",
}: {
  items: AccordionItemData[];
  defaultOpenId?: string;
  variant?: "default" | "support" | "faq";
}) {
  const [openIds, setOpenIds] = useState<Set<string>>(
    () => new Set(defaultOpenId ? [defaultOpenId] : []),
  );

  function toggle(id: string) {
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  return (
    <div className={variant === "default" ? "grid gap-3 sm:grid-cols-2" : ""}>
      {items.map((item) => {
        const isOpen = openIds.has(item.id);
        return (
          <div
            key={item.id}
            id={item.id}
            className={
              variant === "faq"
                ? "border-b border-border py-1"
                : "border border-border-strong rounded-2xl"
            }
          >
            <button
              type="button"
              aria-expanded={isOpen}
              aria-controls={`${item.id}-panel`}
              onClick={() => toggle(item.id)}
              className="flex w-full items-center gap-3 px-5 py-4 text-left"
            >
              {item.icon && (
                <span className="h-6 w-6 shrink-0" aria-hidden="true">
                  {item.icon}
                </span>
              )}
              <span className="flex-1 text-[15px] font-semibold">
                {item.label}
              </span>
              <span
                aria-hidden="true"
                className={`text-lg text-muted transition-transform ${isOpen ? "rotate-45" : ""}`}
              >
                +
              </span>
            </button>
            {/* Always mounted, hidden via CSS — matching the legacy's own
                technique (a CSS class toggle over static markup, not a
                mount/unmount), so collapsed content stays in the DOM for
                assistive tech and the §2A.7 fidelity check alike. */}
            <div
              id={`${item.id}-panel`}
              hidden={!isOpen}
              className="px-5 pb-5 text-sm leading-relaxed text-foreground/75"
            >
              {item.content}
            </div>
          </div>
        );
      })}
    </div>
  );
}
