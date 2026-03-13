"use client";

import { useSearchParams } from "next/navigation";
import { DebugLog } from "./DebugLog";

export function DebugLogWrapper() {
  const searchParams = useSearchParams();
  if (searchParams.get("debug") !== "1") return null;
  return <DebugLog />;
}
