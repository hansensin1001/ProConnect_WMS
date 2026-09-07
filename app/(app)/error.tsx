"use client";

export default function AppError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="min-h-screen bg-paper flex items-center justify-center p-6">
      <div className="max-w-md border border-line bg-panel p-6 text-center">
        <h1 className="stencil text-2xl text-ink">Unable to load this screen</h1>
        <p className="mt-3 text-sm text-graphite">
          The page encountered an unexpected data error. Try again; if it persists,
          confirm that the latest Supabase schema has been run.
        </p>
        <button onClick={reset} className="mt-5 bg-ink px-4 py-2 text-sm font-medium text-white">
          Try again
        </button>
      </div>
    </div>
  );
}
