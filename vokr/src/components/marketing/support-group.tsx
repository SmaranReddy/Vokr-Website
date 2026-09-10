"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ORDER_STATUS_STEPS,
  EXCHANGE_RETURNS_INTRO,
  EXCHANGE_RETURNS_STEPS,
  HOMEPAGE_EXCHANGE_STEP_2,
  HOMEPAGE_FAQ_ITEMS,
  HELP_CARDS,
  CONTACT_DETAILS,
} from "@/config/support-content";
import { OrderStatusForm } from "@/components/marketing/order-status-form";
import { ContactForm } from "@/components/marketing/contact-form";

type ToggleId =
  | "order-status"
  | "exchange-returns"
  | "faq"
  | "help"
  | "contact-us";

/**
 * The homepage's condensed `.support-group` ("Need help?") — five
 * collapsed topics, linked from the hamburger menu's Support group.
 * Reproduces `vokr-production/index.html`'s section 1:1; step/FAQ copy
 * lives in `@/config/support-content` so it stays identical to the
 * standalone `support-*.html` pages.
 */
export function SupportGroup() {
  const [openId, setOpenId] = useState<ToggleId | null>(null);

  function toggle(id: ToggleId) {
    setOpenId((current) => (current === id ? null : id));
  }

  return (
    <section className="border-t border-border px-5 py-16 sm:py-20">
      <div className="mx-auto max-w-3xl">
        <h2 className="mb-2 text-3xl font-bold tracking-tight sm:text-4xl">
          Need help?
        </h2>
        <p className="mb-8 text-[15px] text-muted">
          Tap a topic to expand it — everything you need, without the
          scroll.
        </p>

        <div className="space-y-3">
          <ToggleItem
            id="order-status"
            label="Order Status"
            open={openId === "order-status"}
            onToggle={toggle}
          >
            <p className="mb-4 text-sm text-muted">
              Enter your order number and email to check where your Vokr
              shoes are.
            </p>
            <OrderStatusForm />
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
              {ORDER_STATUS_STEPS.map((step) => (
                <div key={step.title}>
                  <h4 className="mb-1 text-sm font-bold">{step.title}</h4>
                  <p className="text-sm text-muted">{step.body}</p>
                </div>
              ))}
            </div>
          </ToggleItem>

          <ToggleItem
            id="exchange-returns"
            label="Exchange / Returns"
            open={openId === "exchange-returns"}
            onToggle={toggle}
          >
            <p className="mb-4 text-sm text-muted">
              {EXCHANGE_RETURNS_INTRO}
            </p>
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
              {EXCHANGE_RETURNS_STEPS.map((step, index) => (
                <div key={step.title}>
                  <h4 className="mb-1 text-sm font-bold">{step.title}</h4>
                  <p className="text-sm text-muted">
                    {index === 1 ? HOMEPAGE_EXCHANGE_STEP_2 : step.body}
                  </p>
                </div>
              ))}
            </div>
          </ToggleItem>

          <ToggleItem
            id="faq"
            label="FAQs"
            open={openId === "faq"}
            onToggle={toggle}
          >
            <p className="mb-4 text-sm text-muted">
              Quick answers to the things people ask us most.
            </p>
            <FaqList />
          </ToggleItem>

          <ToggleItem
            id="help"
            label="Help Center"
            open={openId === "help"}
            onToggle={toggle}
          >
            <p className="mb-4 text-sm text-muted">
              Browse by topic, or reach out to a real person if you can&apos;t
              find what you need.
            </p>
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
              {HELP_CARDS.map((card) => (
                <div key={card.title}>
                  <h4 className="mb-1 text-sm font-bold">{card.title}</h4>
                  <p className="mb-1.5 text-sm text-muted">{card.body}</p>
                  <Link
                    href={card.href}
                    className="text-sm font-semibold underline underline-offset-2"
                  >
                    {card.linkLabel} &rarr;
                  </Link>
                </div>
              ))}
            </div>
          </ToggleItem>

          <ToggleItem
            id="contact-us"
            label="Contact Us"
            open={openId === "contact-us"}
            onToggle={toggle}
          >
            <p className="mb-6 text-sm text-muted">
              Our team typically replies within one business day.
            </p>
            <div className="mb-10 grid grid-cols-2 gap-6 sm:grid-cols-4">
              {CONTACT_DETAILS.map((detail) => (
                <div key={detail.title}>
                  <h4 className="mb-1 text-sm font-bold">{detail.title}</h4>
                  <p className="text-sm text-muted">
                    {detail.href ? (
                      <a href={detail.href} className="underline underline-offset-2">
                        {detail.value}
                      </a>
                    ) : (
                      detail.value
                    )}
                  </p>
                </div>
              ))}
            </div>
            <ContactForm />
          </ToggleItem>
        </div>
      </div>
    </section>
  );
}

function ToggleItem({
  id,
  label,
  open,
  onToggle,
  children,
}: {
  id: ToggleId;
  label: string;
  open: boolean;
  onToggle: (id: ToggleId) => void;
  children: React.ReactNode;
}) {
  return (
    <div id={id} className="scroll-mt-16 border border-border-strong rounded-2xl">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={`${id}-panel`}
        onClick={() => onToggle(id)}
        className="flex w-full items-center justify-between px-5 py-4 text-left"
      >
        <span className="text-[15px] font-semibold">{label}</span>
        <span
          aria-hidden="true"
          className={`text-lg text-muted transition-transform ${open ? "rotate-45" : ""}`}
        >
          +
        </span>
      </button>
      <div id={`${id}-panel`} hidden={!open} className="px-5 pb-6">
        {children}
      </div>
    </div>
  );
}

function FaqList() {
  // Independent toggle, matching legacy `.support-faq-item`'s
  // `classList.toggle('open')` on the clicked item alone — more than one
  // answer can be open at once, unlike the exclusive ToggleItem group above.
  const [openIds, setOpenIds] = useState<Set<string>>(
    () => new Set(HOMEPAGE_FAQ_ITEMS[0] ? [HOMEPAGE_FAQ_ITEMS[0].id] : []),
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
    <div className="divide-y divide-border">
      {HOMEPAGE_FAQ_ITEMS.map((item) => {
        const isOpen = openIds.has(item.id);
        return (
          <div key={item.id} className="py-1">
            <button
              type="button"
              aria-expanded={isOpen}
              aria-controls={`${item.id}-answer`}
              onClick={() => toggle(item.id)}
              className="flex w-full items-center justify-between py-3 text-left text-sm font-semibold"
            >
              <span>{item.question}</span>
              <span
                aria-hidden="true"
                className={`text-muted transition-transform ${isOpen ? "rotate-45" : ""}`}
              >
                +
              </span>
            </button>
            <p
              id={`${item.id}-answer`}
              hidden={!isOpen}
              className="pb-3 text-sm text-muted"
            >
              {item.answer}
            </p>
          </div>
        );
      })}
    </div>
  );
}
