"use client";

import { Transcript } from "@/components/Transcript/Transcript";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

export function TranscriptCollapsible() {
  return (
    <Collapsible defaultOpen={false} className="flex-1 flex flex-col min-h-0">
      <CollapsibleTrigger
        className="flex w-full items-center justify-between gap-2 p-4 sm:p-5 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-left font-medium text-zinc-900 dark:text-zinc-100 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors [&[data-state=open]>svg]:rotate-180"
        aria-label="Транскрипт ответов"
      >
        <span>Транскрипт</span>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="shrink-0 transition-transform duration-200"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <section
          className="min-h-[200px] p-4 sm:p-5 pt-0 rounded-b-xl bg-white dark:bg-zinc-900 border border-t-0 border-zinc-200 dark:border-zinc-800 overflow-y-auto"
          aria-label="Содержимое транскрипта"
        >
          <Transcript />
        </section>
      </CollapsibleContent>
    </Collapsible>
  );
}
