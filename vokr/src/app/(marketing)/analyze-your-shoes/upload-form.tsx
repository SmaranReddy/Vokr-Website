"use client";

/**
 * `analyze-your-shoes.html`'s "Upload your shoes" form — no real
 * image-analysis backend exists yet, so the submit is inert. The file
 * picker and size input stay fully usable; only the final action is
 * disabled.
 */
export function UploadForm() {
  return (
    <form
      onSubmit={(event) => event.preventDefault()}
      className="max-w-lg space-y-3"
    >
      <div className="mb-1 rounded-2xl border-[1.5px] border-dashed border-border-strong px-5 py-10 text-center">
        <p className="mb-3 text-[13px] text-muted-2">Drag a photo here, or</p>
        <label htmlFor="ays-file" className="sr-only">
          Choose a photo
        </label>
        <input id="ays-file" type="file" accept="image/*" className="mx-auto text-sm" />
      </div>
      <label htmlFor="ays-size" className="sr-only">
        Size printed on your current shoe (e.g. UK 8, US 9)
      </label>
      <input
        id="ays-size"
        type="text"
        placeholder="Size printed on your current shoe (e.g. UK 8, US 9)"
        className="w-full border border-border-strong px-4 py-3 text-sm outline-none focus:border-foreground"
      />
      <button
        type="submit"
        aria-disabled="true"
        title="Shoe photo analysis requires an image-recognition backend (not yet built)"
        className="cursor-default bg-foreground px-6 py-3 text-sm font-semibold text-background opacity-60"
      >
        Analyze My Shoes
      </button>
    </form>
  );
}
