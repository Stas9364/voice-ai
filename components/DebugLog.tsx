"use client";

import { useEffect, useState } from "react";

const MAX_LINES = 30;

export function DebugLog() {
  const [logs, setLogs] = useState<string[]>([]);

  useEffect(() => {
    const origLog = console.log;
    const origError = console.error;
    const push = (prefix: string, args: unknown[]) => {
      const line = `${new Date().toISOString().slice(11, 23)} ${prefix} ${args.map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" ")}`;
      setLogs((prev) => [...prev.slice(-(MAX_LINES - 1)), line]);
    };
    console.log = (...args: unknown[]) => {
      origLog.apply(console, args);
      push("[log]", args);
    };
    console.error = (...args: unknown[]) => {
      origError.apply(console, args);
      push("[err]", args);
    };
    return () => {
      console.log = origLog;
      console.error = origError;
    };
  }, []);

  return (
    <pre
      className="fixed bottom-0 left-0 right-0 z-9999 max-h-[40vh] overflow-auto bg-black/95 text-lime-400 text-[10px] p-2 font-mono whitespace-pre-wrap break-all border-t border-zinc-600"
      style={{ touchAction: "pan-y" }}
    >
      {logs.length === 0 ? "?debug=1 — логи появятся здесь" : logs.join("\n")}
    </pre>
  );
}
