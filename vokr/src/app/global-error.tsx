"use client";

export default function GlobalError({
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <html lang="en">
      <body className="flex min-h-screen flex-col items-center justify-center gap-4 font-sans">
        <h1 className="text-2xl font-semibold">Something went wrong</h1>
        <button
          onClick={() => retry()}
          className="rounded-full bg-black px-5 py-2.5 text-sm font-medium text-white"
        >
          Try again
        </button>
      </body>
    </html>
  );
}
