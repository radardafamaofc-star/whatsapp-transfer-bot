import { sessionManager } from "./session-manager";
import { logTransfer } from "./transfer-logger";
import { log } from "./index";
import type { TransferProgress, TransferResult, QueueStatus } from "@shared/schema";

function randomDelay(minMs: number, maxMs: number): number {
  return Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
}

interface QueueMember {
  originalId: string;
  effectiveId: string | null;
}

type ProgressCallback = (progress: TransferProgress) => void;
type QueueCallback = (status: QueueStatus) => void;

const MIN_DELAY = 8000;
const MAX_DELAY = 20000;
const BATCH_SIZE = 10;
const BATCH_COOLDOWN_MIN = 180;
const BATCH_COOLDOWN_MAX = 180;
const SAFETY_PAUSE_EVERY = 80;
const SAFETY_PAUSE_SECONDS = 600;
const RATE_LIMIT_COOLDOWN = 1200000;
const TIMEOUT_RETRY_DELAY = 30000;

class TransferQueue {
  private queue: QueueMember[] = [];
  private isRunning = false;
  private isPaused = false;
  private isStopped = false;
  private progress: TransferProgress | null = null;
  private onProgress: ProgressCallback | null = null;
  private onQueueUpdate: QueueCallback | null = null;
  private globalAddsCount = 0;
  private addsSinceBatchCooldown = 0;

  private sourceGroupId = "";
  private targetGroupId = "";
  private targetGroupName = "";
  private inviteLink: string | null = null;
  private mode: "direct" | "invite" = "direct";
  private addCapableSessions = new Set<string>();
  private roundRobinOrder: string[] = [];
  private roundRobinIndex = 0;
  private currentUserId: number = 0;

  setCallbacks(onProgress: ProgressCallback, onQueueUpdate: QueueCallback) {
    this.onProgress = onProgress;
    this.onQueueUpdate = onQueueUpdate;
  }

  getProgress(): TransferProgress | null {
    return this.progress;
  }

  getCurrentUserId(): number {
    return this.currentUserId;
  }

  getQueueStatus(): QueueStatus {
    return {
      totalMembers: this.progress?.total || 0,
      processed: this.progress?.completed || 0,
      succeeded: this.progress?.succeeded || 0,
      failed: this.progress?.failed || 0,
      remaining: (this.progress?.total || 0) - (this.progress?.completed || 0),
      isRunning: this.isRunning,
      isPaused: this.isPaused,
      activeSessionId: undefined,
      globalAddsCount: this.globalAddsCount,
      safetyPauseAt: SAFETY_PAUSE_EVERY,
    };
  }

  pause() {
    this.isPaused = true;
    log("Queue paused", "queue");
    if (this.progress && this.progress.status !== "completed" && this.progress.status !== "error") {
      this.progress = { ...this.progress, status: "paused" };
      this.emitProgress();
    }
  }

  resume() {
    this.isPaused = false;
    log("Queue resumed", "queue");
    if (this.progress && this.progress.status === "paused") {
      this.progress = { ...this.progress, status: "in_progress" };
      this.emitProgress();
    }
  }

  stop() {
    this.isStopped = true;
    this.isPaused = false;
    log("Queue stopped", "queue");
  }

  private emitProgress() {
    if (!this.progress) return;
    const snapshot = { ...this.progress, results: [...this.progress.results] };
    this.onProgress?.(snapshot);
    this.onQueueUpdate?.(this.getQueueStatus());
  }

  private getNextRoundRobinSession(): { id: string } | null {
    if (this.roundRobinOrder.length === 0) return null;

    const now = Date.now();
    const totalSessions = this.roundRobinOrder.length;
    let attempts = 0;

    while (attempts < totalSessions) {
      const sessionId = this.roundRobinOrder[this.roundRobinIndex % totalSessions];
      this.roundRobinIndex = (this.roundRobinIndex + 1) % totalSessions;
      attempts++;

      const status = sessionManager.getSessionStatus(sessionId);
      if (status !== "connected") continue;

      const info = sessionManager.getSessionInfo(sessionId);
      if (!info) continue;
      if (info.isBusy) continue;
      if (info.cooldownUntil && info.cooldownUntil > now) continue;

      log(`Rodízio: vez da ${sessionId} (${this.roundRobinIndex}/${totalSessions})`, "queue");
      return { id: sessionId };
    }

    return null;
  }

  private async waitWhilePaused() {
    while (this.isPaused && !this.isStopped) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  private async interruptibleDelay(ms: number): Promise<boolean> {
    const chunks = Math.ceil(ms / 500);
    for (let i = 0; i < chunks; i++) {
      if (this.isStopped) return false;
      while (this.isPaused && !this.isStopped) {
        await new Promise((r) => setTimeout(r, 500));
      }
      if (this.isStopped) return false;
      await new Promise((r) => setTimeout(r, Math.min(500, ms - i * 500)));
    }
    return true;
  }

  private async doCooldown(seconds: number) {
    if (!this.progress) return;
    log(`Cooldown for ${seconds}s`, "queue");
    this.progress.status = "cooldown";
    this.progress.cooldownSeconds = seconds;
    this.emitProgress();

    for (let remaining = seconds; remaining > 0; remaining--) {
      if (this.isStopped) return;
      while (this.isPaused && !this.isStopped) {
        await new Promise((r) => setTimeout(r, 500));
      }
      if (this.isStopped) return;
      await new Promise((r) => setTimeout(r, 1000));
      this.progress!.cooldownSeconds = remaining;
      if (remaining % 10 === 0 || remaining <= 5) this.emitProgress();
    }

    this.progress!.status = "in_progress";
    this.progress!.cooldownSeconds = undefined;
    this.emitProgress();
    this.addsSinceBatchCooldown = 0;
  }

  async startTransfer(
    sourceGroupId: string | null,
    targetGroupId: string,
    participantIds: string[],
    mode: "direct" | "invite",
    userId: number = 0
  ): Promise<void> {
    if (this.isRunning) throw new Error("Transferência já em andamento");
    if (!sessionManager.hasConnectedSessionForUser(userId)) throw new Error("Nenhuma sessão conectada");

    this.sourceGroupId = sourceGroupId || "";
    this.targetGroupId = targetGroupId;
    this.mode = mode;
    this.isPaused = false;
    this.isStopped = false;
    this.globalAddsCount = 0;
    this.addsSinceBatchCooldown = 0;
    this.currentUserId = userId;

    let validIds: string[];
    if (sourceGroupId) {
      const sourceMembers = await sessionManager.getGroupParticipants(sourceGroupId);
      const sourceParticipantIds = new Set(sourceMembers.map((p) => p.id));
      validIds = participantIds.filter((id) => sourceParticipantIds.has(id));
      if (validIds.length === 0) throw new Error("Nenhum dos membros selecionados pertence ao grupo de origem");
    } else {
      validIds = participantIds;
    }

    const lidIds = validIds.filter((id) => id.endsWith("@lid"));
    const lidToPhone = new Map<string, string>();
    if (lidIds.length > 0) {
      log(`Resolving ${lidIds.length} LID IDs...`, "queue");
      const resolved = await sessionManager.resolveLidBatch(lidIds);
      for (const [lid, phone] of resolved) lidToPhone.set(lid, phone);
      log(`Resolved ${lidToPhone.size}/${lidIds.length} LIDs`, "queue");
    }

    this.queue = validIds.map((id) => ({
      originalId: id,
      effectiveId: id.endsWith("@lid") ? (lidToPhone.get(id) || null) : id,
    }));

    const session = sessionManager.getFirstConnectedSessionForUser(userId);
    if (!session) throw new Error("Nenhuma sessão disponível");
    const targetChat = await sessionManager.getSessionClient(session.id).getChatById(targetGroupId);
    if (!(targetChat as any).isGroup) throw new Error("O destino não é um grupo");
    this.targetGroupName = (targetChat as any).name || "grupo";

    this.inviteLink = await sessionManager.getInviteLink(targetGroupId);
    if (!this.inviteLink && mode === "invite") {
      throw new Error("Não foi possível obter o link de convite do grupo de destino.");
    }
    if (this.inviteLink) {
      log(`Invite link obtido com sucesso`, "queue");
    }

    if (this.inviteLink) {
      log("Garantindo que todas as contas estejam no grupo de destino...", "queue");
      const sessionsInGroup = await sessionManager.ensureSessionsInGroup(targetGroupId, this.inviteLink, userId);
      this.addCapableSessions = sessionsInGroup;
      log(`Sessions no grupo de destino: ${Array.from(this.addCapableSessions).join(", ")}`, "queue");
    } else {
      this.addCapableSessions = await sessionManager.getSessionsInGroup(targetGroupId, false, userId);
    }

    if (this.addCapableSessions.size === 0) {
      log("Nenhuma conta no grupo de destino. Usando conta principal.", "queue");
      this.addCapableSessions.add(session.id);
    }

    this.roundRobinOrder = Array.from(this.addCapableSessions);
    this.roundRobinIndex = 0;
    log(`Rodízio configurado: ${this.roundRobinOrder.join(" → ")} (${this.roundRobinOrder.length} contas)`, "queue");

    this.progress = {
      total: this.queue.length,
      completed: 0,
      succeeded: 0,
      failed: 0,
      results: [],
      status: "in_progress",
    };

    this.isRunning = true;
    this.emitProgress();

    this.processQueue().catch((err) => {
      log(`Queue error: ${err.message}`, "queue");
      if (this.progress) {
        this.progress.status = "error";
        this.emitProgress();
      }
      this.isRunning = false;
    });
  }

  private async processQueue() {
    try {
      await this.processMembers();

      if (!this.isStopped && this.progress) {
        this.progress.status = "completed";
        this.emitProgress();
      }
    } catch (err: any) {
      log(`Queue processing error: ${err.message}`, "queue");
      if (this.progress) {
        this.progress.status = "error";
        this.emitProgress();
      }
    } finally {
      this.isRunning = false;
    }
  }

  private async processMembers() {
    const inviteOnly = this.mode === "invite";
    let consecutiveRateLimits = 0;

    for (const member of this.queue) {
      if (this.isStopped) {
        this.progress!.status = "stopped";
        this.emitProgress();
        return;
      }
      await this.waitWhilePaused();
      if (this.isStopped) {
        this.progress!.status = "stopped";
        this.emitProgress();
        return;
      }

      const result: TransferResult = { participantId: member.originalId, success: false };

      if (!member.effectiveId) {
        result.error = "LID não resolvido — número indisponível";
        this.progress!.failed++;
        this.progress!.completed++;
        this.progress!.results.push(result);
        this.emitProgress();
        logTransfer({ timestamp: new Date().toISOString(), sessionId: "none", memberId: member.originalId, result: "skipped", method: "add", error: result.error });
        continue;
      }

      if (inviteOnly && this.inviteLink) {
        let session = this.getNextRoundRobinSession();
        if (!session) {
          log("Nenhuma sessão disponível no rodízio para convite, aguardando 60s...", "queue");
          if (!(await this.interruptibleDelay(60000))) return;
          session = this.getNextRoundRobinSession();
        }
        if (!session) {
          result.error = "Nenhuma sessão disponível";
          this.progress!.failed++;
          this.progress!.completed++;
          this.progress!.results.push(result);
          this.emitProgress();
          continue;
        }
        await sessionManager.sendPresence(session.id);
        const inviteResult = await sessionManager.sendInviteMessage(session.id, member.effectiveId, this.inviteLink, this.targetGroupName);
        if (inviteResult.success) {
          result.success = true;
          result.sessionId = session.id;
          this.progress!.succeeded++;
          this.globalAddsCount++;
          sessionManager.recordInvite(session.id);
          logTransfer({ timestamp: new Date().toISOString(), sessionId: session.id, memberId: member.originalId, effectiveId: member.effectiveId, result: "success", method: "invite" });
        } else {
          result.error = inviteResult.error;
          this.progress!.failed++;
          logTransfer({ timestamp: new Date().toISOString(), sessionId: session.id, memberId: member.originalId, effectiveId: member.effectiveId, result: "failed", method: "invite", error: inviteResult.error });
        }
        this.progress!.completed++;
        this.progress!.results.push(result);
        this.emitProgress();
        if (this.globalAddsCount > 0 && this.globalAddsCount % SAFETY_PAUSE_EVERY === 0) {
          await this.doCooldown(SAFETY_PAUSE_SECONDS);
          if (this.isStopped) return;
        }
        if (!(await this.interruptibleDelay(randomDelay(3000, 8000)))) return;
        continue;
      }

      if (this.addsSinceBatchCooldown >= BATCH_SIZE) {
        const cd = randomDelay(BATCH_COOLDOWN_MIN, BATCH_COOLDOWN_MAX);
        log(`Batch cooldown ${cd}s`, "queue");
        await this.doCooldown(cd);
        if (this.isStopped) return;
      }

      let activeSession = this.getNextRoundRobinSession();
      if (!activeSession) {
        log("Nenhuma sessão disponível no rodízio, aguardando 60s...", "queue");
        await this.doCooldown(60);
        if (this.isStopped) return;
        activeSession = this.getNextRoundRobinSession();
        if (!activeSession) {
          result.error = "Nenhuma sessão disponível";
          this.progress!.failed++;
          this.progress!.completed++;
          this.progress!.results.push(result);
          this.emitProgress();
          continue;
        }
      }

      result.sessionId = activeSession.id;
      const canDirectAdd = this.addCapableSessions.has(activeSession.id);

      if (canDirectAdd) {
        sessionManager.markBusy(activeSession.id);

        let addAttempt: Awaited<ReturnType<typeof sessionManager.addParticipant>>;
        try {
          await sessionManager.sendPresence(activeSession.id);
          addAttempt = await sessionManager.addParticipant(
            activeSession.id,
            this.targetGroupId,
            member.effectiveId
          );
        } catch (err: any) {
          sessionManager.markFree(activeSession.id);
          result.error = err.message || "Erro inesperado";
          this.progress!.failed++;
          this.progress!.completed++;
          this.progress!.results.push(result);
          this.emitProgress();
          logTransfer({ timestamp: new Date().toISOString(), sessionId: activeSession.id, memberId: member.originalId, effectiveId: member.effectiveId, result: "failed", method: "add", error: result.error });
          continue;
        }

        sessionManager.markFree(activeSession.id);

        if (addAttempt.rateLimited) {
          consecutiveRateLimits++;
          log(`Rate-limited on ${member.effectiveId} via ${activeSession.id} (consecutive: ${consecutiveRateLimits})`, "queue");

          if (this.inviteLink) {
            const inviteSession = this.getNextRoundRobinSession() || activeSession;
            const inviteResult = await sessionManager.sendInviteMessage(inviteSession.id, member.effectiveId, this.inviteLink, this.targetGroupName);
            if (inviteResult.success) {
              result.success = true;
              result.error = "Convite enviado (fallback)";
              this.progress!.succeeded++;
              this.globalAddsCount++;
              sessionManager.recordInvite(inviteSession.id);
              logTransfer({ timestamp: new Date().toISOString(), sessionId: inviteSession.id, memberId: member.originalId, effectiveId: member.effectiveId, result: "success", method: "fallback_invite" });
            } else {
              result.error = inviteResult.error;
              this.progress!.failed++;
              logTransfer({ timestamp: new Date().toISOString(), sessionId: inviteSession.id, memberId: member.originalId, effectiveId: member.effectiveId, result: "failed", method: "fallback_invite", error: inviteResult.error });
            }
          } else {
            result.error = "Rate-limited";
            this.progress!.failed++;
            logTransfer({ timestamp: new Date().toISOString(), sessionId: activeSession.id, memberId: member.originalId, effectiveId: member.effectiveId, result: "failed", method: "add", error: "Rate-limited", responseCode: 429 });
          }

          if (consecutiveRateLimits >= 2) {
            sessionManager.setCooldown(activeSession.id, RATE_LIMIT_COOLDOWN);
            this.progress!.completed++;
            this.progress!.results.push(result);
            this.emitProgress();
            await this.doCooldown(Math.round(RATE_LIMIT_COOLDOWN / 1000));
            consecutiveRateLimits = 0;
            if (this.isStopped) return;
            continue;
          }
        } else if (addAttempt.privacyBlocked) {
          if (this.inviteLink) {
            const inviteSession = this.getNextRoundRobinSession() || activeSession;
            const inviteResult = await sessionManager.sendInviteMessage(inviteSession.id, member.effectiveId, this.inviteLink, this.targetGroupName);
            if (inviteResult.success) {
              result.success = true;
              result.error = "Convite enviado (privacidade)";
              this.progress!.succeeded++;
              this.globalAddsCount++;
              sessionManager.recordInvite(inviteSession.id);
              logTransfer({ timestamp: new Date().toISOString(), sessionId: inviteSession.id, memberId: member.originalId, effectiveId: member.effectiveId, result: "success", method: "fallback_invite" });
            } else {
              result.error = inviteResult.error;
              this.progress!.failed++;
              logTransfer({ timestamp: new Date().toISOString(), sessionId: inviteSession.id, memberId: member.originalId, effectiveId: member.effectiveId, result: "failed", method: "fallback_invite", error: inviteResult.error, responseCode: 403 });
            }
          } else {
            result.error = "Privacidade impede adição";
            this.progress!.failed++;
            logTransfer({ timestamp: new Date().toISOString(), sessionId: activeSession.id, memberId: member.originalId, effectiveId: member.effectiveId, result: "failed", method: "add", error: result.error, responseCode: 403 });
          }
          consecutiveRateLimits = 0;
        } else if (addAttempt.timeout) {
          if (!(await this.interruptibleDelay(TIMEOUT_RETRY_DELAY))) return;
          const retryAttempt = await sessionManager.addParticipant(activeSession.id, this.targetGroupId, member.effectiveId);
          if (retryAttempt.added) {
            result.success = true;
            result.error = retryAttempt.error;
            this.progress!.succeeded++;
            this.addsSinceBatchCooldown++;
            this.globalAddsCount++;
            sessionManager.recordAdd(activeSession.id);
            consecutiveRateLimits = 0;
            logTransfer({ timestamp: new Date().toISOString(), sessionId: activeSession.id, memberId: member.originalId, effectiveId: member.effectiveId, result: "success", method: "add" });
          } else if (this.inviteLink) {
            const inviteSession = this.getNextRoundRobinSession() || activeSession;
            const inviteResult = await sessionManager.sendInviteMessage(inviteSession.id, member.effectiveId, this.inviteLink, this.targetGroupName);
            if (inviteResult.success) {
              result.success = true;
              result.error = "Convite enviado (timeout)";
              this.progress!.succeeded++;
              this.globalAddsCount++;
              sessionManager.recordInvite(inviteSession.id);
              logTransfer({ timestamp: new Date().toISOString(), sessionId: inviteSession.id, memberId: member.originalId, effectiveId: member.effectiveId, result: "success", method: "fallback_invite" });
            } else {
              result.error = inviteResult.error;
              this.progress!.failed++;
            }
          } else {
            result.error = retryAttempt.error || "Timeout persistente";
            this.progress!.failed++;
          }
        } else if (addAttempt.added) {
          result.success = true;
          result.error = addAttempt.error;
          this.progress!.succeeded++;
          this.addsSinceBatchCooldown++;
          this.globalAddsCount++;
          sessionManager.recordAdd(activeSession.id);
          consecutiveRateLimits = 0;
          logTransfer({ timestamp: new Date().toISOString(), sessionId: activeSession.id, memberId: member.originalId, effectiveId: member.effectiveId, result: "success", method: "add" });
        } else {
          if (this.inviteLink && addAttempt.error !== "Já está no grupo") {
            const inviteSession = this.getNextRoundRobinSession() || activeSession;
            const inviteResult = await sessionManager.sendInviteMessage(inviteSession.id, member.effectiveId, this.inviteLink, this.targetGroupName);
            if (inviteResult.success) {
              result.success = true;
              result.error = "Convite enviado (fallback)";
              this.progress!.succeeded++;
              this.globalAddsCount++;
              sessionManager.recordInvite(inviteSession.id);
              logTransfer({ timestamp: new Date().toISOString(), sessionId: inviteSession.id, memberId: member.originalId, effectiveId: member.effectiveId, result: "success", method: "fallback_invite" });
            } else {
              result.error = `${addAttempt.error} / ${inviteResult.error}`;
              this.progress!.failed++;
            }
          } else {
            result.error = addAttempt.error || "Falha ao adicionar";
            this.progress!.failed++;
            logTransfer({ timestamp: new Date().toISOString(), sessionId: activeSession.id, memberId: member.originalId, effectiveId: member.effectiveId, result: "failed", method: "add", error: result.error });
          }
        }
      } else {
        await sessionManager.sendPresence(activeSession.id);
        if (this.inviteLink) {
          const inviteResult = await sessionManager.sendInviteMessage(activeSession.id, member.effectiveId, this.inviteLink, this.targetGroupName);
          if (inviteResult.success) {
            result.success = true;
            result.error = "Convite enviado por DM";
            this.progress!.succeeded++;
            this.globalAddsCount++;
            sessionManager.recordInvite(activeSession.id);
            logTransfer({ timestamp: new Date().toISOString(), sessionId: activeSession.id, memberId: member.originalId, effectiveId: member.effectiveId, result: "success", method: "invite" });
          } else {
            result.error = inviteResult.error;
            this.progress!.failed++;
            logTransfer({ timestamp: new Date().toISOString(), sessionId: activeSession.id, memberId: member.originalId, effectiveId: member.effectiveId, result: "failed", method: "invite", error: inviteResult.error });
          }
        } else {
          result.error = "Conta não está no grupo destino e não há link de convite";
          this.progress!.failed++;
          logTransfer({ timestamp: new Date().toISOString(), sessionId: activeSession.id, memberId: member.originalId, effectiveId: member.effectiveId, result: "failed", method: "none", error: result.error });
        }
      }

      this.progress!.completed++;
      this.progress!.results.push(result);
      this.emitProgress();

      if (this.globalAddsCount > 0 && this.globalAddsCount % SAFETY_PAUSE_EVERY === 0) {
        log(`Safety pause: ${this.globalAddsCount} total adds`, "queue");
        await this.doCooldown(SAFETY_PAUSE_SECONDS);
        if (this.isStopped) return;
      }

      const delay = randomDelay(MIN_DELAY, MAX_DELAY);
      log(`Next in ${Math.round(delay / 1000)}s`, "queue");
      if (!(await this.interruptibleDelay(delay))) return;
    }
  }
}

export const transferQueue = new TransferQueue();
