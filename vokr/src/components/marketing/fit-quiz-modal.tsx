"use client";

import Link from "next/link";
import { useState } from "react";

/** One question's option set, verbatim from `#fitModalOverlay` (`vokr-production/index.html`). */
const STEPS = [
  {
    question: "who",
    label: "Question 1 of 5",
    title: "Who are you shopping for?",
    options: [
      { value: "men", label: "Men" },
      { value: "women", label: "Women" },
      { value: "unisex", label: "No preference" },
      { value: "kids", label: "Kids" },
    ],
  },
  {
    question: "size",
    label: "Question 2 of 5",
    title: "What's your usual Indian (UK) shoe size?",
    options: [4, 5, 6, 7, 8, 9, 10, 11].map((n) => ({
      value: String(n),
      label: `IN ${n}`,
    })),
  },
  {
    question: "fitpref",
    label: "Question 3 of 5",
    title: "How do you like your shoes to fit?",
    options: [
      { value: "snug", label: "Snug — I like a close, secure fit" },
      { value: "true", label: "True to size — just right" },
      { value: "roomy", label: "Roomy — extra space up front" },
    ],
  },
  {
    question: "width",
    label: "Question 4 of 5",
    title: "How would you describe your foot width?",
    options: [
      { value: "narrow", label: "Narrow" },
      { value: "regular", label: "Regular" },
      { value: "wide", label: "Wide" },
    ],
  },
  {
    question: "use",
    label: "Question 5 of 5",
    title: "Where will you wear them most?",
    options: [
      { value: "office", label: "Office & commute" },
      { value: "travel", label: "Travel" },
      { value: "everyday", label: "Everyday errands" },
      { value: "allday", label: "On my feet all day" },
    ],
  },
];

/**
 * The legacy "Find Your Fit" quiz (`#fitModalOverlay`) — five questions,
 * reproduced with the same labels/options/order, then a size
 * recommendation (task 4's "Section order, headings and body copy
 * verbatim"). The legacy computed its "recommended size" straight from
 * the question-2 answer with no other input; kept identical rather than
 * inventing a real sizing algorithm the legacy never had.
 */
export function FitQuizModal() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});

  const isResult = step === STEPS.length;

  function reset() {
    setStep(0);
    setAnswers({});
  }

  function close() {
    setOpen(false);
    reset();
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-block bg-foreground px-7 py-3.5 text-[13px] font-semibold tracking-[.06em] text-background transition-colors hover:opacity-90"
      >
        Take the Quiz
      </button>

      {/* Always mounted, hidden via the `hidden` attribute rather than
          unmounted when closed — matching the legacy `#fitModalOverlay`,
          which is static markup shown/hidden by a CSS class, not
          JS-injected on open. Keeps every question's heading/options in
          the DOM regardless of quiz progress, for the §2A.7 fidelity
          check as much as for anyone tabbing through without opening it. */}
      <div
        hidden={!open}
        className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4"
      >
        <div className="relative w-full max-w-md rounded-2xl bg-background p-8">
          <button
            type="button"
            aria-label="Close"
            onClick={close}
            className="absolute top-4 right-4 flex h-8 w-8 items-center justify-center rounded-full bg-surface text-lg text-foreground/70 hover:bg-border-strong"
          >
            &times;
          </button>

          <div className="mb-6 flex gap-1.5" aria-hidden="true">
            {STEPS.map((s, index) => (
              <span
                key={s.question}
                className={`h-1.5 flex-1 rounded-full ${index <= step && !isResult ? "bg-foreground" : "bg-border"}`}
              />
            ))}
          </div>

          {STEPS.map((s, index) => (
            <div key={s.question} hidden={isResult || step !== index}>
              <p className="mb-1 text-xs font-semibold text-muted">
                {s.label}
              </p>
              <h3 className="mb-5 text-xl font-bold tracking-tight">
                {s.title}
              </h3>
              <div className="mb-6 grid grid-cols-2 gap-2">
                {s.options.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() =>
                      setAnswers((prev) => ({
                        ...prev,
                        [s.question]: option.value,
                      }))
                    }
                    aria-pressed={answers[s.question] === option.value}
                    className={`rounded-xl border px-3 py-3 text-left text-sm font-medium ${
                      answers[s.question] === option.value
                        ? "border-foreground bg-foreground text-background"
                        : "border-border-strong text-foreground hover:border-foreground"
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <div className="flex justify-between">
                <button
                  type="button"
                  disabled={index === 0}
                  onClick={() => setStep((current) => Math.max(0, current - 1))}
                  className="text-sm font-semibold text-muted disabled:opacity-30"
                >
                  Back
                </button>
                <button
                  type="button"
                  disabled={!answers[s.question]}
                  onClick={() => setStep((current) => current + 1)}
                  className="bg-foreground px-6 py-2.5 text-sm font-semibold text-background disabled:opacity-30"
                >
                  {index === STEPS.length - 1 ? "See My Fit" : "Next"}
                </button>
              </div>
            </div>
          ))}

          <div hidden={!isResult} className="text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-foreground text-sm font-bold text-background">
              IN
            </div>
            <h3 className="mb-1 text-xl font-bold tracking-tight">
              Your recommended size
            </h3>
            <p className="mb-3 text-sm">
              Indian / UK size <strong>{answers.size ?? "7"}</strong>
            </p>
            <p className="mb-6 text-sm text-muted">
              Based on your answers, we&apos;ve matched you to the closest
              Vokr fit. All Vokr styles run true to Indian (UK) sizing.
            </p>
            <Link
              href="/shop/model-x"
              className="mb-4 inline-block text-sm font-semibold underline underline-offset-4"
            >
              Shop Model x in this size &rarr;
            </Link>
            <button
              type="button"
              onClick={reset}
              className="block w-full text-sm font-semibold text-muted hover:text-foreground"
            >
              Retake the quiz
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
