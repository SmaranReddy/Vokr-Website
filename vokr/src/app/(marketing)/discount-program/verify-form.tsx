"use client";

/** `discount-program.html`'s "Verify and get your code" form — inert, no ID-verification backend exists yet. */
export function VerifyForm() {
  return (
    <form
      onSubmit={(event) => event.preventDefault()}
      className="max-w-md space-y-3"
    >
      <div className="flex flex-col gap-3 sm:flex-row">
        <label htmlFor="dp-name" className="sr-only">
          Full name
        </label>
        <input
          id="dp-name"
          type="text"
          placeholder="Full name"
          className="flex-1 border border-border-strong px-4 py-3 text-sm outline-none focus:border-foreground"
        />
        <label htmlFor="dp-email" className="sr-only">
          Email address
        </label>
        <input
          id="dp-email"
          type="email"
          placeholder="Email address"
          className="flex-1 border border-border-strong px-4 py-3 text-sm outline-none focus:border-foreground"
        />
      </div>
      <label htmlFor="dp-role" className="sr-only">
        I am a...
      </label>
      <select
        id="dp-role"
        defaultValue="I am a..."
        className="w-full border border-border-strong px-4 py-3 text-sm outline-none focus:border-foreground"
      >
        <option>I am a...</option>
        <option>Student</option>
        <option>Healthcare worker</option>
        <option>First responder</option>
        <option>Educator</option>
      </select>
      <button
        type="submit"
        aria-disabled="true"
        title="Identity verification requires a partner verification service integration (not yet built)"
        className="cursor-default bg-foreground px-6 py-3 text-sm font-semibold text-background opacity-60"
      >
        Verify &amp; Get Code
      </button>
    </form>
  );
}
