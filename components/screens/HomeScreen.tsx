"use client";

import { useState } from "react";
import { TranscriptCollapsible } from "@/components/Transcript/TranscriptCollapsible";
import { useLiveSessionWithMicrophone } from "@/hooks/useLiveSessionWithMicrophone";

const statusLabels: Record<string, string> = {
  idle: "Готов",
  connecting: "Подключение…",
  connected: "Говорите",
  error: "Ошибка",
};

export function HomeScreen() {
  const {
    startSession,
    stopSession,
    status,
    isListening,
    level,
    error,
  } = useLiveSessionWithMicrophone();
  const [isStarting, setIsStarting] = useState(false);

  const handleStart = async () => {
    setIsStarting(true);
    try {
      await startSession();
    } finally {
      setIsStarting(false);
    }
  };

  const isActive =
    status === "connected" || status === "connecting" || isListening;

  const handleToggle = () => {
    if (isActive) stopSession();
    else handleStart();
  };

  const buttonLabel = isStarting
    ? "…"
    : isActive
      ? "Стоп"
      : "Начать";

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 flex flex-col">
      <main className="flex-1 w-full max-w-2xl mx-auto flex flex-col min-h-0 px-4 py-6 sm:px-6 sm:py-8 md:px-8">
        <div className="flex-1 flex flex-col items-center justify-center gap-6 py-6">
          <div className="relative flex items-center justify-center size-48">
            {/* Кольцо уровня звука: появляется при активном микрофоне, реагирует на громкость */}
            {isActive && (
              <div
                className="absolute inset-0 m-auto size-40 rounded-full pointer-events-none border-4 border-emerald-400/70 transition-all duration-75"
                aria-hidden
                style={{
                  opacity: 0.4 + level * 0.6,
                  transform: `scale(${1 + level * 0.12})`,
                  boxShadow: level > 0.08 ? `0 0 ${16 + level * 24}px rgba(52, 211, 153, 0.35)` : "none",
                }}
              />
            )}
            <button
              type="button"
              onClick={handleToggle}
              disabled={isStarting}
              className={`relative flex cursor-pointer items-center justify-center size-40 rounded-full font-medium text-sm sm:text-base touch-manipulation active:scale-95 disabled:opacity-50 disabled:pointer-events-none disabled:active:scale-100 transition shadow-lg hover:shadow-xl disabled:shadow-lg ${
                isActive
                  ? "border-2 border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 text-zinc-800 dark:text-zinc-200"
                  : "bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900"
              }`}
              aria-label={isActive ? "Остановить" : "Начать разговор"}
            >
              {buttonLabel}
            </button>
          </div>
          <div
            className="flex items-center gap-2 min-h-[24px]"
            aria-live="polite"
          >
            <span
              className={`inline-block w-2 h-2 rounded-full shrink-0 ${
                status === "connected"
                  ? "bg-emerald-500"
                  : status === "connecting"
                    ? "bg-amber-500 animate-pulse"
                    : status === "error"
                      ? "bg-red-500"
                      : "bg-zinc-400 dark:bg-zinc-500"
              }`}
            />
            <span className="text-sm text-zinc-600 dark:text-zinc-400">
              {statusLabels[status] ?? status}
            </span>
          </div>
          {error && (
            <p
              className="text-sm text-red-600 dark:text-red-400 p-3 rounded-lg bg-red-50 dark:bg-red-950/30 text-center max-w-full"
              role="alert"
            >
              {error}
            </p>
          )}
        </div>

        <div className="shrink-0 w-full">
          <TranscriptCollapsible />
        </div>
      </main>
    </div>
  );
}
