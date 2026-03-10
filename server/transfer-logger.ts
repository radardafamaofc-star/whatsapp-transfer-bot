import fs from "fs";
import path from "path";

const LOG_DIR = "logs";
const LOG_FILE = path.join(LOG_DIR, "transfer.log");

if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

export interface TransferLogEntry {
  timestamp: string;
  sessionId: string;
  memberId: string;
  effectiveId?: string;
  result: "success" | "failed" | "skipped";
  method: "add" | "invite" | "fallback_invite";
  error?: string;
  responseCode?: number;
}

export function logTransfer(entry: TransferLogEntry): void {
  const line = JSON.stringify(entry) + "\n";
  try {
    fs.appendFileSync(LOG_FILE, line);
  } catch {
  }
}

export function getRecentLogs(limit = 100): TransferLogEntry[] {
  try {
    if (!fs.existsSync(LOG_FILE)) return [];
    const content = fs.readFileSync(LOG_FILE, "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);
    const entries = lines.slice(-limit).map((l) => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(Boolean);
    return entries;
  } catch {
    return [];
  }
}
