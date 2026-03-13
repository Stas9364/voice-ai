"use client";

import { useLiveAPI } from "@/contexts/LiveAPIContext";

export function Transcript() {
  const { transcript } = useLiveAPI();

  if (transcript.length === 0) {
    return (
      <p className="text-zinc-500 dark:text-zinc-400 text-sm">
        Ответы модели появятся здесь…
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2 w-full">
      <ul className="list-none p-0 m-0 space-y-2" role="log" aria-live="polite">
        {transcript.map((text, i) => (
          <li
            key={i}
            className="text-foreground dark:text-zinc-100 text-base leading-relaxed"
          >
            {text}
          </li>
        ))}
      </ul>
    </div>
  );
}
