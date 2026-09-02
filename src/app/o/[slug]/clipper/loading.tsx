export default function ClipperLoading() {
  return (
    <div className="mx-auto grid max-w-4xl gap-6 animate-pulse">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="h-6 w-32 rounded bg-raised" />
          <div className="mt-1 h-4 w-80 rounded bg-raised" />
        </div>
        <div className="h-6 w-20 rounded-full bg-raised" />
      </header>

      <div className="rounded-lg border border-line bg-panel p-4">
        <div className="grid gap-4 sm:grid-cols-[1fr_240px]">
          <div className="h-10 rounded bg-raised" />
          <div className="h-10 rounded bg-raised" />
        </div>
        <div className="mt-4 flex gap-1.5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-12 flex-1 rounded-md bg-raised" />
          ))}
        </div>
      </div>

      <div className="grid gap-3">
        <div className="h-3 w-24 rounded bg-raised" />
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="rounded-lg border border-line bg-panel p-4">
            <div className="flex gap-3">
              <div className="h-4 w-40 rounded bg-raised" />
              <div className="h-4 w-16 rounded-full bg-raised" />
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 3 }).map((_, j) => (
                <div key={j} className="aspect-[9/16] rounded-lg bg-raised" />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
