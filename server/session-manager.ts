import pkg from "whatsapp-web.js";
const { Client } = pkg;
import type {
  WhatsAppStatus,
  WhatsAppGroup,
  GroupParticipant,
  SessionInfo,
} from "@shared/schema";
import { log } from "./index";
import QRCode from "qrcode";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";

class DirectAuth {
  private dataDir: string;
  private client: any;

  constructor(dataDir: string) {
    this.dataDir = dataDir;
  }

  setup(client: any) {
    this.client = client;
  }

  async beforeBrowserInitialized() {
    fs.mkdirSync(this.dataDir, { recursive: true });
    this.client.options.puppeteer.userDataDir = this.dataDir;
  }

  async afterBrowserInitialized() {}
  async afterAuthReady() {}
  async disconnect() {}
  async destroy() {}
  async logout() {}
}

function randomDelay(minMs: number, maxMs: number): number {
  return Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
}

export interface SessionCallbacks {
  onStatusChange: (sessionId: string, status: WhatsAppStatus) => void;
  onQRCode: (sessionId: string, qrDataUrl: string) => void;
}

interface Session {
  id: string;
  userId: number;
  client: any;
  status: WhatsAppStatus;
  qrDataUrl: string | null;
  phoneNumber?: string;
  addsThisHour: number;
  hourStart: number;
  cooldownUntil: number;
  isBusy: boolean;
  totalAdds: number;
  totalInvites: number;
  dataDir: string;
}

interface CachedData<T> {
  data: T;
  timestamp: number;
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} expirou após ${ms / 1000}s`)), ms);
    promise.then(
      (val) => { clearTimeout(timer); resolve(val); },
      (err) => { clearTimeout(timer); reject(err); }
    );
  });
}

const MAX_ADDS_PER_HOUR = 80;
const CHROMIUM_PATH = process.env.CHROMIUM_PATH || "/nix/store/zi4f80l169xlmivz8vja8wlphq74qqk0-chromium-125.0.6422.141/bin/chromium";
const CACHE_TTL = 60000;
const INIT_DELAY_MS = 3000;

const PUPPETEER_ARGS = [
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-dev-shm-usage",
  "--disable-gpu",
  "--no-first-run",
  "--no-zygote",
  "--single-process",
  "--disable-extensions",
  "--disable-accelerated-2d-canvas",
  "--disable-software-rasterizer",
  "--disable-background-networking",
  "--disable-default-apps",
  "--disable-translate",
  "--disable-sync",
  "--metrics-recording-only",
  "--no-default-browser-check",
  "--js-flags=--max-old-space-size=256",
];

class SessionProcessRegistry {
  private activeDirs = new Set<string>();
  private activePids = new Map<string, number>();

  reserve(sessionId: string, dataDir: string): boolean {
    const absDir = path.resolve(dataDir);
    if (this.activeDirs.has(absDir)) {
      log(`Registry: dir ${absDir} already in use, denying`, "session");
      return false;
    }
    this.activeDirs.add(absDir);
    log(`Registry: reserved ${absDir} for ${sessionId}`, "session");
    return true;
  }

  registerPid(sessionId: string, pid: number) {
    this.activePids.set(sessionId, pid);
  }

  release(sessionId: string, dataDir: string) {
    this.activeDirs.delete(path.resolve(dataDir));
    this.activePids.delete(sessionId);
    log(`Registry: released ${sessionId}`, "session");
  }

  getActivePids(): number[] {
    return Array.from(this.activePids.values());
  }

  isReserved(dataDir: string): boolean {
    return this.activeDirs.has(path.resolve(dataDir));
  }

  clear() {
    this.activeDirs.clear();
    this.activePids.clear();
  }
}

export class SessionManager {
  private sessions = new Map<string, Session>();
  private callbacks: SessionCallbacks | null = null;
  private sessionCounter = 0;
  private groupsCache = new Map<number, CachedData<WhatsAppGroup[]>>();
  private contactsCache = new Map<number, CachedData<{ id: string; name: string; number: string; isLid?: boolean }[]>>();
  private registry = new SessionProcessRegistry();
  private initQueue: Array<() => Promise<void>> = [];
  private initRunning = false;

  constructor() {
    this.killAllChromium();
    this.cleanupAllLocks();
    this.setupGracefulShutdown();
    log("SessionManager initialized", "session");
  }

  private setupGracefulShutdown() {
    const shutdown = async (signal: string) => {
      log(`Received ${signal}, destroying all sessions...`, "session");
      const promises: Promise<void>[] = [];
      for (const session of this.sessions.values()) {
        promises.push(this.destroyClient(session));
      }
      await Promise.allSettled(promises);
      this.killAllChromium();
      log("All sessions destroyed, exiting", "session");
      process.exit(0);
    };
    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("SIGTERM", () => shutdown("SIGTERM"));
  }

  setCallbacks(cb: SessionCallbacks) {
    this.callbacks = cb;
  }

  private resetHourlyCountIfNeeded(session: Session) {
    const now = Date.now();
    if (now - session.hourStart >= 3600000) {
      session.addsThisHour = 0;
      session.hourStart = now;
    }
  }

  getSessionsForUser(userId: number): Session[] {
    return Array.from(this.sessions.values()).filter((s) => s.userId === userId);
  }

  hasConnectedSessionForUser(userId: number): boolean {
    return this.getSessionsForUser(userId).some((s) => s.status === "connected");
  }

  getFirstConnectedSessionForUser(userId: number): Session | null {
    return this.getSessionsForUser(userId).find((s) => s.status === "connected") || null;
  }

  private killAllChromium(): void {
    try {
      const activePids = new Set(this.registry.getActivePids().map(String));
      const output = execSync(
        "ps -eo pid,args 2>/dev/null | grep -i '[c]hromium\\|[c]hrome' | grep -v playwright | awk '{print $1}'",
        { encoding: "utf-8" }
      ).trim();
      if (output) {
        let killed = 0;
        for (const pid of output.split("\n")) {
          const p = pid.trim();
          if (p && !activePids.has(p)) {
            try { execSync(`kill -9 ${p} 2>/dev/null`); killed++; } catch {}
          }
        }
        if (killed > 0) log(`Killed ${killed} orphan Chromium processes`, "session");
      }
    } catch {}
  }

  private cleanupAllLocks(): void {
    const basePath = ".wwebjs_auth";
    try {
      if (!fs.existsSync(basePath)) return;
      execSync(`find "${basePath}" \\( -name "SingletonLock" -o -name "SingletonSocket" -o -name "SingletonCookie" -o -name "lockfile" -o -name "*.lock" \\) -exec rm -f {} + 2>/dev/null; find "${basePath}" -type l -name "Singleton*" -exec rm -f {} + 2>/dev/null`);
      log("Cleaned all locks in .wwebjs_auth", "session");
    } catch {}
  }

  private cleanupLocksInDir(dirPath: string): void {
    try {
      if (!fs.existsSync(dirPath)) return;
      execSync(`find "${dirPath}" \\( -name "SingletonLock" -o -name "SingletonSocket" -o -name "SingletonCookie" -o -name "lockfile" -o -name "*.lock" \\) -exec rm -f {} + 2>/dev/null; find "${dirPath}" -type l -name "Singleton*" -exec rm -f {} + 2>/dev/null`);
    } catch {}
  }

  private killProcessesForDir(dirPath: string): void {
    try {
      const absPath = path.resolve(dirPath);
      const output = execSync(
        `ps -eo pid,args 2>/dev/null | grep -i '[c]hromium\\|[c]hrome' | grep -- "${absPath}" | awk '{print $1}'`,
        { encoding: "utf-8" }
      ).trim();
      if (output) {
        for (const pid of output.split("\n")) {
          const p = pid.trim();
          if (p) {
            try { execSync(`kill -9 ${p} 2>/dev/null`); log(`Killed Chromium PID ${p} for ${dirPath}`, "session"); } catch {}
          }
        }
      }
    } catch {}
  }

  private nukeDir(dirPath: string): void {
    try {
      if (fs.existsSync(dirPath)) {
        fs.rmSync(dirPath, { recursive: true, force: true });
        log(`Nuked dir ${dirPath}`, "session");
      }
    } catch {}
  }

  private async destroyClient(session: Session): Promise<void> {
    try {
      const bp = session.client?.pupBrowser?.process();
      const pid = bp?.pid;
      try { await session.client.destroy(); } catch {}
      if (pid) {
        try { execSync(`kill -9 ${pid} 2>/dev/null`); } catch {}
      }
    } catch {}
    this.killProcessesForDir(session.dataDir);
    this.registry.release(session.id, session.dataDir);
  }

  private createClient(dataDir: string): any {
    const absDir = path.resolve(dataDir);
    fs.mkdirSync(absDir, { recursive: true });
    const auth = new DirectAuth(absDir);
    return new Client({
      authStrategy: auth,
      puppeteer: {
        headless: true,
        executablePath: CHROMIUM_PATH,
        protocolTimeout: 600000,
        timeout: 180000,
        args: [...PUPPETEER_ARGS, `--user-data-dir=${absDir}`],
      },
    });
  }

  private setupClientEvents(client: any, session: Session, id: string): void {
    let qrAttempts = 0;
    const MAX_QR_ATTEMPTS = 15;

    client.on("qr", async (qr: string) => {
      qrAttempts++;
      log(`QR Code received for ${id} (attempt ${qrAttempts}/${MAX_QR_ATTEMPTS})`, "session");

      if (qrAttempts > MAX_QR_ATTEMPTS) {
        log(`QR Code timeout for ${id} — too many attempts without scan`, "session");
        session.status = "auth_failure";
        this.callbacks?.onStatusChange(id, "auth_failure");
        try { await client.destroy(); } catch {}
        return;
      }

      session.status = "qr_code";
      try {
        session.qrDataUrl = await QRCode.toDataURL(qr, {
          width: 280,
          margin: 2,
          color: { dark: "#1a1a2e", light: "#ffffff" },
        });
        this.callbacks?.onQRCode(id, session.qrDataUrl);
      } catch {
        log(`Failed to generate QR for ${id}`, "session");
      }
      this.callbacks?.onStatusChange(id, "qr_code");
    });

    client.on("loading_screen", () => {
      session.status = "connecting";
      this.callbacks?.onStatusChange(id, "connecting");
    });

    client.on("authenticated", () => {
      session.status = "connecting";
      this.callbacks?.onStatusChange(id, "connecting");
    });

    client.on("auth_failure", () => {
      log(`Auth failure for ${id}`, "session");
      session.status = "auth_failure";
      this.callbacks?.onStatusChange(id, "auth_failure");
    });

    client.on("ready", () => {
      log(`Session ${id} ready`, "session");
      session.status = "connected";
      session.qrDataUrl = null;
      session.phoneNumber = client.info?.wid?.user || undefined;
      const bp = client.pupBrowser?.process();
      if (bp?.pid) this.registry.registerPid(id, bp.pid);
      this.callbacks?.onStatusChange(id, "connected");
    });

    client.on("disconnected", (reason: string) => {
      log(`Session ${id} disconnected: ${reason}`, "session");
      session.status = "disconnected";
      session.qrDataUrl = null;
      this.callbacks?.onStatusChange(id, "disconnected");
    });
  }

  private async processInitQueue(): Promise<void> {
    if (this.initRunning) return;
    this.initRunning = true;
    while (this.initQueue.length > 0) {
      const task = this.initQueue.shift()!;
      try {
        await task();
      } catch (err: any) {
        log(`Init queue task error: ${err.message}`, "session");
      }
      if (this.initQueue.length > 0) {
        await new Promise(r => setTimeout(r, INIT_DELAY_MS));
      }
    }
    this.initRunning = false;
  }

  async addSession(userId: number): Promise<string> {
    this.sessionCounter++;
    const id = `session-${this.sessionCounter}`;
    const ts = Date.now();
    const dataDir = `.wwebjs_auth/user-${userId}/${id}-${ts}`;

    log(`Adding session ${id} for user ${userId} (dataDir=${dataDir})`, "session");

    this.killProcessesForDir(dataDir);
    this.nukeDir(dataDir);

    if (!this.registry.reserve(id, dataDir)) {
      throw new Error(`Diretório ${dataDir} já está em uso por outra sessão`);
    }

    const session: Session = {
      id,
      userId,
      client: null as any,
      status: "disconnected",
      qrDataUrl: null,
      addsThisHour: 0,
      hourStart: Date.now(),
      cooldownUntil: 0,
      isBusy: false,
      totalAdds: 0,
      totalInvites: 0,
      dataDir,
    };

    this.sessions.set(id, session);
    session.status = "connecting";
    this.callbacks?.onStatusChange(id, "connecting");

    const initTask = async () => {
      const MAX_RETRIES = 3;
      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
          log(`Session ${id} initializing (attempt ${attempt}/${MAX_RETRIES})...`, "session");

          this.killProcessesForDir(dataDir);
          this.nukeDir(dataDir);
          this.cleanupLocksInDir(path.dirname(dataDir));

          const client = this.createClient(dataDir);
          session.client = client;
          this.setupClientEvents(client, session, id);

          await client.initialize();
          log(`Session ${id} initialized successfully`, "session");
          return;
        } catch (err: any) {
          const errMsg = err.message || String(err);
          log(`Session ${id} init error (attempt ${attempt}/${MAX_RETRIES}): ${errMsg}`, "session");

          if (session.client) {
            await this.destroyClient(session);
          }

          if (attempt < MAX_RETRIES) {
            log(`Retrying session ${id} in 5s...`, "session");
            await new Promise(r => setTimeout(r, 5000));
          } else {
            log(`Session ${id} failed after ${MAX_RETRIES} attempts`, "session");
            session.status = "auth_failure";
            this.callbacks?.onStatusChange(id, "auth_failure");
          }
        }
      }
    };

    this.initQueue.push(initTask);
    this.processInitQueue();

    return id;
  }

  async removeSession(id: string, userId?: number): Promise<void> {
    const session = this.sessions.get(id);
    if (!session) return;
    if (userId !== undefined && session.userId !== userId) return;
    await this.destroyClient(session);
    this.sessions.delete(id);
    log(`Session ${id} removed`, "session");
  }

  async removeAllSessionsForUser(userId: number): Promise<void> {
    const userSessions = this.getSessionsForUser(userId);
    for (const s of userSessions) {
      await this.removeSession(s.id);
    }
  }

  resetCounter(): void {
    this.sessionCounter = 0;
  }

  getSessionUserId(sessionId: string): number | undefined {
    return this.sessions.get(sessionId)?.userId;
  }

  getAvailableSession(): Session | null {
    const now = Date.now();
    let best: Session | null = null;
    let bestAdds = Infinity;

    for (const session of this.sessions.values()) {
      if (session.status !== "connected") continue;
      if (session.isBusy) continue;
      if (session.cooldownUntil > now) continue;

      this.resetHourlyCountIfNeeded(session);

      if (session.addsThisHour >= MAX_ADDS_PER_HOUR) {
        session.cooldownUntil = now + 3600000;
        log(`Session ${session.id} hit hourly limit, cooldown for 1h`, "session");
        continue;
      }

      if (session.addsThisHour < bestAdds) {
        best = session;
        bestAdds = session.addsThisHour;
      }
    }

    return best;
  }

  markBusy(id: string) {
    const s = this.sessions.get(id);
    if (s) s.isBusy = true;
  }

  markFree(id: string) {
    const s = this.sessions.get(id);
    if (s) s.isBusy = false;
  }

  recordAdd(id: string) {
    const s = this.sessions.get(id);
    if (s) {
      this.resetHourlyCountIfNeeded(s);
      s.addsThisHour++;
      s.totalAdds++;
    }
  }

  recordInvite(id: string) {
    const s = this.sessions.get(id);
    if (s) s.totalInvites++;
  }

  setCooldown(id: string, durationMs: number) {
    const s = this.sessions.get(id);
    if (s) {
      s.cooldownUntil = Date.now() + durationMs;
      log(`Session ${id} cooldown for ${Math.round(durationMs / 1000)}s`, "session");
    }
  }

  getSessionClient(id: string): any {
    return this.sessions.get(id)?.client || null;
  }

  getConnectedSessionCount(): number {
    let count = 0;
    for (const s of this.sessions.values()) {
      if (s.status === "connected") count++;
    }
    return count;
  }

  hasAnyConnectedSession(): boolean {
    return this.getConnectedSessionCount() > 0;
  }

  getFirstConnectedSession(): Session | null {
    for (const s of this.sessions.values()) {
      if (s.status === "connected") return s;
    }
    return null;
  }

  getSessionsInfo(userId?: number): SessionInfo[] {
    const now = Date.now();
    const result: SessionInfo[] = [];
    for (const s of this.sessions.values()) {
      if (userId !== undefined && s.userId !== userId) continue;
      this.resetHourlyCountIfNeeded(s);
      result.push({
        id: s.id,
        status: s.status,
        phoneNumber: s.phoneNumber,
        addsThisHour: s.addsThisHour,
        maxAddsPerHour: MAX_ADDS_PER_HOUR,
        cooldownUntil: s.cooldownUntil > now ? s.cooldownUntil : undefined,
        isBusy: s.isBusy,
        totalAdds: s.totalAdds,
        totalInvites: s.totalInvites,
      });
    }
    return result;
  }

  getSessionQR(id: string): string | null {
    return this.sessions.get(id)?.qrDataUrl || null;
  }

  getSessionStatus(id: string): WhatsAppStatus {
    return this.sessions.get(id)?.status || "disconnected";
  }

  getSessionInfo(id: string): { isBusy: boolean; cooldownUntil: number } | null {
    const s = this.sessions.get(id);
    if (!s) return null;
    this.resetHourlyCountIfNeeded(s);
    return {
      isBusy: s.isBusy,
      cooldownUntil: s.addsThisHour >= MAX_ADDS_PER_HOUR ? (s.cooldownUntil || Date.now() + 3600000) : s.cooldownUntil,
    };
  }

  async getGroups(userId?: number): Promise<WhatsAppGroup[]> {
    const uid = userId ?? -1;
    const cached = this.groupsCache.get(uid);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      log(`Groups served from cache for user ${uid}`, "session");
      return cached.data;
    }

    const session = userId !== undefined ? this.getFirstConnectedSessionForUser(userId) : this.getFirstConnectedSession();
    if (!session) throw new Error("Nenhuma sessão conectada");

    const chats = await withTimeout(session.client.getChats(), 120000, "Carregar grupos");
    const groups = chats.filter((c: any) => c.isGroup);
    const me = session.client.info?.wid?._serialized;

    const result = groups.map((g: any) => {
      let participantCount = 0;
      const cachedParticipants = g.participants || [];
      if (cachedParticipants.length > 0) {
        participantCount = cachedParticipants.length;
      } else {
        participantCount = g.groupMetadata?.participants?.length || g.groupMetadata?.size || 0;
      }

      const myP = cachedParticipants.find((p: any) => p.id?._serialized === me);
      return {
        id: g.id._serialized,
        name: g.name,
        participantCount,
        isAdmin: myP?.isAdmin || myP?.isSuperAdmin || false,
      };
    });

    this.groupsCache.set(uid, { data: result, timestamp: Date.now() });
    return result;
  }

  clearCache(userId?: number): void {
    if (userId !== undefined) {
      this.groupsCache.delete(userId);
      this.contactsCache.delete(userId);
    } else {
      this.groupsCache.clear();
      this.contactsCache.clear();
    }
  }

  async getContacts(userId?: number): Promise<{ id: string; name: string; number: string; isLid?: boolean }[]> {
    const uid = userId ?? -1;
    const cached = this.contactsCache.get(uid);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      log(`Contacts served from cache for user ${uid}`, "session");
      return cached.data;
    }

    const session = userId !== undefined ? this.getFirstConnectedSessionForUser(userId) : this.getFirstConnectedSession();
    if (!session) throw new Error("Nenhuma sessão conectada");

    const chats = await withTimeout(session.client.getChats(), 120000, "Carregar contatos");
    const privateChats = chats.filter((c: any) => {
      const id = c.id?._serialized || "";
      return !c.isGroup && (id.endsWith("@c.us") || id.endsWith("@lid"));
    });

    const seenIds = new Set<string>();
    const contacts: { id: string; name: string; number: string; isLid?: boolean }[] = [];

    for (const chat of privateChats) {
      const chatId = (chat as any).id._serialized;
      if (seenIds.has(chatId)) continue;
      seenIds.add(chatId);

      const isLid = chatId.endsWith("@lid");
      const rawNumber = chatId.replace("@c.us", "").replace("@lid", "");
      const contactName = (chat as any).name || (chat as any).contact?.pushname || (chat as any).contact?.name || rawNumber;

      contacts.push({
        id: chatId,
        name: contactName,
        number: rawNumber,
        isLid,
      });
    }

    try {
      const allContacts = await withTimeout(session.client.getContacts(), 60000, "Carregar lista de contatos");
      for (const contact of allContacts) {
        const cId = (contact as any).id?._serialized || "";
        if (seenIds.has(cId)) continue;
        if ((contact as any).isGroup) continue;
        if (!cId.endsWith("@c.us") && !cId.endsWith("@lid")) continue;
        if ((contact as any).isMe) continue;

        seenIds.add(cId);
        const isLid = cId.endsWith("@lid");
        const rawNumber = cId.replace("@c.us", "").replace("@lid", "");
        const name = (contact as any).pushname || (contact as any).name || (contact as any).shortName || rawNumber;

        contacts.push({
          id: cId,
          name,
          number: rawNumber,
          isLid,
        });
      }
    } catch (err) {
      log(`Error fetching additional contacts: ${(err as Error).message}`, "session");
    }

    this.contactsCache.set(uid, { data: contacts, timestamp: Date.now() });
    return contacts;
  }

  async getGroupParticipants(groupId: string, userId?: number): Promise<GroupParticipant[]> {
    const session = userId !== undefined ? this.getFirstConnectedSessionForUser(userId) : this.getFirstConnectedSession();
    if (!session) throw new Error("Nenhuma sessão conectada");

    const chat = await withTimeout(session.client.getChatById(groupId), 60000, "Carregar grupo");
    if (!(chat as any).isGroup) throw new Error("Chat não é um grupo");

    let participants = (chat as any).participants || [];
    if (participants.length === 0 && (chat as any).groupMetadata?.participants) {
      participants = (chat as any).groupMetadata.participants;
    }
    if (participants.length === 0) {
      try {
        const metadata = await (chat as any).getGroupMetadata?.();
        if (metadata?.participants) participants = metadata.participants;
      } catch {}
    }

    if (participants.length === 0) {
      log(`No participants found for ${groupId}, trying chat refresh`, "session");
      try {
        const freshChat = await session.client.getChatById(groupId);
        participants = (freshChat as any).participants || [];
      } catch {}
    }

    if (participants.length === 0) {
      throw new Error("Não foi possível obter os membros do grupo. Verifique se a conta principal está no grupo.");
    }

    const rawList = participants.map((p: any) => ({
      id: p.id._serialized,
      number: p.id.user,
      isAdmin: p.isAdmin || false,
      isSuperAdmin: p.isSuperAdmin || false,
      isLid: p.id._serialized.endsWith("@lid"),
    }));

    const lidParticipants = rawList.filter((p: any) => p.isLid);
    if (lidParticipants.length > 0) {
      log(`Resolving ${lidParticipants.length} LID participants...`, "session");
      const resolved = await this.resolveLidBatch(lidParticipants.map((p: any) => p.id));
      for (const p of rawList) {
        if (p.isLid && resolved.has(p.id)) {
          const phoneId = resolved.get(p.id)!;
          p.resolvedPhone = phoneId;
          p.number = phoneId.replace("@c.us", "");
          p.isLid = false;
        }
      }
      const unresolvedCount = rawList.filter((p: any) => p.isLid).length;
      log(`LID resolution: ${lidParticipants.length - unresolvedCount} resolved, ${unresolvedCount} unresolved`, "session");
    }

    return rawList;
  }

  async resolveLidToPhone(lidId: string): Promise<string | null> {
    const connectedSessions = Array.from(this.sessions.values()).filter(
      (s) => s.status === "connected"
    );
    for (const session of connectedSessions) {
      try {
        const result = await session.client.pupPage.evaluate(async (lid: string) => {
          const data = await window.WWebJS.enforceLidAndPnRetrieval(lid);
          if (data?.phone) return data.phone._serialized || data.phone.toString();
          return null;
        }, lidId);
        if (result) return result;
      } catch (err: any) {
        log(`LID resolution failed for ${lidId} on ${session.id}: ${err.message}`, "session");
      }
    }
    return null;
  }

  async resolveLidBatch(lidIds: string[]): Promise<Map<string, string>> {
    const resolved = new Map<string, string>();
    const BATCH = 5;
    for (let i = 0; i < lidIds.length; i += BATCH) {
      const batch = lidIds.slice(i, i + BATCH);
      await Promise.allSettled(
        batch.map(async (lid) => {
          const phone = await this.resolveLidToPhone(lid);
          if (phone) resolved.set(lid, phone);
        })
      );
      if (i + BATCH < lidIds.length) {
        await new Promise((r) => setTimeout(r, 200));
      }
    }
    return resolved;
  }

  async sendPresence(sessionId: string): Promise<void> {
    const client = this.getSessionClient(sessionId);
    if (!client) return;
    try {
      await client.sendPresenceAvailable();
      await new Promise((r) => setTimeout(r, randomDelay(2000, 5000)));
    } catch {
    }
  }

  async addParticipant(
    sessionId: string,
    targetGroupId: string,
    participantId: string
  ): Promise<{ added: boolean; rateLimited: boolean; privacyBlocked: boolean; timeout: boolean; error?: string }> {
    const client = this.getSessionClient(sessionId);
    if (!client) return { added: false, rateLimited: false, privacyBlocked: false, timeout: false, error: "Sessão indisponível" };

    try {
      const chat = await client.getChatById(targetGroupId);
      const addResult = await (chat as any).addParticipants([participantId], {
        autoSendInviteV4: false,
      });
      log(`[${sessionId}] addParticipants ${participantId}: ${JSON.stringify(addResult)}`, "session");

      if (addResult && typeof addResult === "object") {
        const statusObj = addResult[participantId] || addResult;
        const code = statusObj?.code || statusObj?.status;

        if (code === 200 || code === "200") {
          return { added: true, rateLimited: false, privacyBlocked: false, timeout: false };
        } else if (code === 409) {
          return { added: true, rateLimited: false, privacyBlocked: false, timeout: false, error: "Já está no grupo" };
        } else if (code === 403) {
          return { added: false, rateLimited: false, privacyBlocked: true, timeout: false, error: "Privacidade impede adição direta" };
        } else if (code === 408) {
          return { added: false, rateLimited: false, privacyBlocked: false, timeout: true, error: "Timeout" };
        } else if (code === 400 || code === 429) {
          return { added: false, rateLimited: true, privacyBlocked: false, timeout: false, error: "Rate-limited" };
        }
      }
      return { added: false, rateLimited: false, privacyBlocked: false, timeout: false, error: "Resposta desconhecida" };
    } catch (err: any) {
      const msg = err.message || "";
      if (msg.includes("Lid is missing")) {
        return { added: false, rateLimited: false, privacyBlocked: false, timeout: false, error: "Contato não sincronizado" };
      }
      return { added: false, rateLimited: false, privacyBlocked: false, timeout: false, error: msg || "Erro ao adicionar" };
    }
  }

  async sendInviteMessage(
    sessionId: string,
    phoneId: string,
    inviteLink: string,
    groupName: string
  ): Promise<{ success: boolean; error?: string }> {
    const client = this.getSessionClient(sessionId);
    if (!client) return { success: false, error: "Sessão indisponível" };
    try {
      const message = `Olá! Você foi convidado para o grupo *${groupName}*.\n\nEntre pelo link: ${inviteLink}`;
      await client.sendMessage(phoneId, message);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message || "Erro ao enviar convite" };
    }
  }

  async getSessionsInGroup(groupId: string, adminOnly = false, userId?: number): Promise<Set<string>> {
    const result = new Set<string>();
    for (const session of this.sessions.values()) {
      if (session.status !== "connected") continue;
      if (userId !== undefined && session.userId !== userId) continue;
      try {
        const chat = await session.client.getChatById(groupId);
        if (!(chat as any).isGroup) continue;

        let participants = (chat as any).participants || [];
        if (participants.length === 0 && (chat as any).groupMetadata?.participants) {
          participants = (chat as any).groupMetadata.participants;
        }
        if (participants.length === 0) {
          try {
            const metadata = await (chat as any).getGroupMetadata?.();
            if (metadata?.participants) participants = metadata.participants;
          } catch {}
        }

        const me = session.client.info?.wid?._serialized;
        const myP = participants.find((p: any) => p.id?._serialized === me);
        if (myP) {
          const isAdmin = myP.isAdmin || myP.isSuperAdmin || false;
          if (adminOnly && !isAdmin) {
            log(`Session ${session.id} is in group ${groupId} but NOT admin — skipping for direct add`, "session");
            continue;
          }
          result.add(session.id);
          log(`Session ${session.id} is in group ${groupId} (admin: ${isAdmin})`, "session");
        }
      } catch {}
    }
    return result;
  }

  getAvailableSessionFrom(allowedIds: Set<string>): Session | null {
    const now = Date.now();
    let best: Session | null = null;
    let bestAdds = Infinity;

    for (const session of this.sessions.values()) {
      if (!allowedIds.has(session.id)) continue;
      if (session.status !== "connected") continue;
      if (session.isBusy) continue;
      if (session.cooldownUntil > now) continue;

      this.resetHourlyCountIfNeeded(session);

      if (session.addsThisHour >= MAX_ADDS_PER_HOUR) {
        session.cooldownUntil = now + 3600000;
        continue;
      }

      if (session.addsThisHour < bestAdds) {
        bestAdds = session.addsThisHour;
        best = session;
      }
    }
    return best;
  }

  async joinGroupViaInvite(sessionId: string, inviteCode: string): Promise<{ success: boolean; error?: string }> {
    const client = this.getSessionClient(sessionId);
    if (!client) return { success: false, error: "Sessão indisponível" };
    try {
      await client.acceptInvite(inviteCode);
      log(`Session ${sessionId} joined group via invite`, "session");
      return { success: true };
    } catch (err: any) {
      const msg = err.message || "";
      if (msg.includes("already") || msg.includes("409")) {
        log(`Session ${sessionId} already in group`, "session");
        return { success: true };
      }
      return { success: false, error: msg || "Erro ao entrar no grupo" };
    }
  }

  async promoteToAdmin(adminSessionId: string, targetGroupId: string, participantWid: string): Promise<boolean> {
    const client = this.getSessionClient(adminSessionId);
    if (!client) return false;
    try {
      const chat = await client.getChatById(targetGroupId);
      await (chat as any).promoteParticipants([participantWid]);
      log(`Promoted ${participantWid} to admin in group via ${adminSessionId}`, "session");
      return true;
    } catch (err: any) {
      log(`Failed to promote ${participantWid}: ${err.message}`, "session");
      return false;
    }
  }

  getSessionWid(sessionId: string): string | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    return session.client?.info?.wid?._serialized || null;
  }

  async ensureSessionsInGroup(targetGroupId: string, inviteLink: string, userId?: number): Promise<Set<string>> {
    const inviteCode = inviteLink.replace("https://chat.whatsapp.com/", "");
    const alreadyInGroup = await this.getSessionsInGroup(targetGroupId, false, userId);

    const adminSession = userId !== undefined
      ? this.getFirstConnectedSessionForUser(userId)
      : this.getFirstConnectedSession();
    const adminSessionId = adminSession?.id || null;

    const connectedSessions = Array.from(this.sessions.values()).filter(
      (s) => s.status === "connected" && (userId === undefined || s.userId === userId)
    );

    for (const session of connectedSessions) {
      if (alreadyInGroup.has(session.id)) continue;

      log(`Session ${session.id} not in target group — joining via invite...`, "session");
      const result = await this.joinGroupViaInvite(session.id, inviteCode);
      if (result.success) {
        alreadyInGroup.add(session.id);
        log(`Session ${session.id} joined target group successfully`, "session");
        await new Promise((r) => setTimeout(r, 3000));
      } else {
        log(`Session ${session.id} failed to join: ${result.error}`, "session");
      }
    }

    if (adminSessionId) {
      const nonAdminSessions = await this.getNonAdminSessionsInGroup(targetGroupId, adminSessionId);
      if (nonAdminSessions.length > 0) {
        log(`Promovendo ${nonAdminSessions.length} contas a admin no grupo de destino...`, "session");
        for (const { sessionId, wid } of nonAdminSessions) {
          const promoted = await this.promoteToAdmin(adminSessionId, targetGroupId, wid);
          if (promoted) {
            log(`${sessionId} (${wid}) promovido a admin`, "session");
          } else {
            log(`Falha ao promover ${sessionId} — ela poderá apenas enviar convites`, "session");
          }
          await new Promise((r) => setTimeout(r, 1000));
        }
      }
    }

    return alreadyInGroup;
  }

  async getNonAdminSessionsInGroup(groupId: string, adminSessionId: string): Promise<{ sessionId: string; wid: string }[]> {
    const result: { sessionId: string; wid: string }[] = [];
    const adminClient = this.getSessionClient(adminSessionId);
    if (!adminClient) return result;

    try {
      const chat = await adminClient.getChatById(groupId);
      let participants = (chat as any).participants || [];
      if (participants.length === 0) {
        try {
          const metadata = await (chat as any).getGroupMetadata?.();
          if (metadata?.participants) participants = metadata.participants;
        } catch {}
      }

      for (const session of this.sessions.values()) {
        if (session.status !== "connected") continue;
        if (session.id === adminSessionId) continue;
        const wid = this.getSessionWid(session.id);
        if (!wid) continue;

        const myP = participants.find((p: any) => p.id?._serialized === wid);
        if (myP) {
          const isAdmin = myP.isAdmin || myP.isSuperAdmin || false;
          if (!isAdmin) {
            result.push({ sessionId: session.id, wid });
          }
        }
      }
    } catch (err: any) {
      log(`Erro ao verificar admins no grupo: ${err.message}`, "session");
    }

    return result;
  }

  async getInviteLink(targetGroupId: string): Promise<string | null> {
    const connectedSessions = Array.from(this.sessions.values()).filter(
      (s) => s.status === "connected"
    );
    for (const session of connectedSessions) {
      try {
        const chat = await session.client.getChatById(targetGroupId);
        const code = await (chat as any).getInviteCode();
        if (code) {
          log(`Got invite link from ${session.id}`, "session");
          return `https://chat.whatsapp.com/${code}`;
        }
      } catch (err: any) {
        log(`Failed to get invite link from ${session.id}: ${err.message}`, "session");
      }
    }
    return null;
  }
}

export const sessionManager = new SessionManager();
