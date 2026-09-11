"use client";

/**
 * `vokr-ambassadors.html`'s `#ambassador-apply` form
 * (`<form onsubmit="return false;">`). There is no ambassador-application
 * backend yet, so — same treatment as `order-status-form.tsx` — this stays
 * visually present but inert: a disabled-look submit button with
 * `aria-disabled` and an honest `title`, rather than a fake endpoint or a
 * silent `onsubmit="return false;"`.
 */
export function AmbassadorApplyForm() {
  return (
    <form
      onSubmit={(event) => event.preventDefault()}
      className="max-w-xl space-y-3"
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="sr-only" htmlFor="amb-name">
          Full name
        </label>
        <input
          id="amb-name"
          type="text"
          placeholder="Full name"
          className="border border-border-strong px-4 py-3 text-sm outline-none focus:border-foreground"
        />
        <label className="sr-only" htmlFor="amb-email">
          Email address
        </label>
        <input
          id="amb-email"
          type="email"
          placeholder="Email address"
          className="border border-border-strong px-4 py-3 text-sm outline-none focus:border-foreground"
        />
      </div>
      <label className="sr-only" htmlFor="amb-social">
        Instagram / social handle
      </label>
      <input
        id="amb-social"
        type="text"
        placeholder="Instagram / social handle"
        className="w-full border border-border-strong px-4 py-3 text-sm outline-none focus:border-foreground"
      />
      <label className="sr-only" htmlFor="amb-city">
        City
      </label>
      <input
        id="amb-city"
        type="text"
        placeholder="City"
        className="w-full border border-border-strong px-4 py-3 text-sm outline-none focus:border-foreground"
      />
      <label className="sr-only" htmlFor="amb-why">
        Why do you want to be a Vokr Ambassador?
      </label>
      <textarea
        id="amb-why"
        rows={4}
        placeholder="Why do you want to be a Vokr Ambassador?"
        className="w-full border border-border-strong px-4 py-3 text-sm outline-none focus:border-foreground"
      />
      <button
        type="submit"
        aria-disabled="true"
        title="Ambassador applications aren't wired to a backend yet — there is no application pipeline to submit to."
        className="cursor-default bg-foreground px-6 py-3 text-sm font-semibold text-background opacity-60"
      >
        Submit Application
      </button>
    </form>
  );
}
