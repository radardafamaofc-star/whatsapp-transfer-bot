import { sessionManager } from "./session-manager";
import { transferQueue } from "./transfer-queue";
import type {
  WhatsAppGroup,
  WhatsAppContact,
  GroupParticipant,
  TransferProgress,
  WhatsAppStatus,
} from "@shared/schema";

class WhatsAppService {
  private primarySessionIds = new Map<number, string>();

  setCallbacks() {}

  getPrimarySessionId(userId: number): string | null {
    return this.primarySessionIds.get(userId) || null;
  }

  getStatus(userId: number): WhatsAppStatus {
    const primaryId = this.primarySessionIds.get(userId);
    if (primaryId) {
      const primaryStatus = sessionManager.getSessionStatus(primaryId);
      if (primaryStatus === "connected") {
        return "connected";
      }
      if (primaryStatus === "qr_code" || primaryStatus === "connecting") {
        return primaryStatus;
      }
    }
    if (sessionManager.hasConnectedSessionForUser(userId)) return "connected";
    return "disconnected";
  }

  getQRDataUrl(userId: number): string | null {
    const primaryId = this.primarySessionIds.get(userId);
    if (primaryId) {
      return sessionManager.getSessionQR(primaryId);
    }
    return null;
  }

  getCurrentProgress(): TransferProgress | null {
    return transferQueue.getProgress();
  }

  pauseTransfer() {
    transferQueue.pause();
  }

  resumeTransfer() {
    transferQueue.resume();
  }

  stopTransfer() {
    transferQueue.stop();
  }

  async initialize(userId: number): Promise<void> {
    const existingId = this.primarySessionIds.get(userId);
    if (existingId) {
      const status = sessionManager.getSessionStatus(existingId);
      if (status === "connecting" || status === "qr_code" || status === "connected") {
        return;
      }
      if (status === "auth_failure" || status === "disconnected") {
        await sessionManager.removeSession(existingId, userId);
        this.primarySessionIds.delete(userId);
      }
    }
    const sessionId = await sessionManager.addSession(userId);
    this.primarySessionIds.set(userId, sessionId);
  }

  async disconnect(userId: number): Promise<void> {
    await sessionManager.removeAllSessionsForUser(userId);
    this.primarySessionIds.delete(userId);
  }

  async getGroups(userId: number): Promise<WhatsAppGroup[]> {
    return sessionManager.getGroups(userId);
  }

  async getGroupParticipants(groupId: string, userId: number): Promise<GroupParticipant[]> {
    return sessionManager.getGroupParticipants(groupId, userId);
  }

  async getContacts(userId: number): Promise<WhatsAppContact[]> {
    return sessionManager.getContacts(userId);
  }

  async transferMembers(
    sourceGroupId: string | null,
    targetGroupId: string,
    participantIds: string[],
    mode: "direct" | "invite" = "invite",
    userId: number = 0
  ): Promise<void> {
    await transferQueue.startTransfer(sourceGroupId, targetGroupId, participantIds, mode, userId);
  }
}

export const whatsappService = new WhatsAppService();
