import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatTime(seconds: number) {
  const total = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export function formatSize(bytes: number) {
  return bytes < 1_000_000
    ? `${Math.max(1, Math.round(bytes / 1000))} kB`
    : `${(bytes / 1_000_000).toLocaleString("nl-NL", { maximumFractionDigits: 1 })} MB`;
}
