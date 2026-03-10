import { useState, useCallback, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeftRight,
  LogOut,
  Loader2,
  Users,
  AlertCircle,
  ArrowRight,
  RefreshCw,
  Send,
  UserPlus,
  Shield,
  MessageCircle,
} from "lucide-react";
import { SiWhatsapp } from "react-icons/si";
import { GroupSelector } from "@/components/group-selector";
import { ParticipantList } from "@/components/participant-list";
import { ContactSelector } from "@/components/contact-selector";
import { TransferProgressView } from "@/components/transfer-progress";
import { SessionPanel } from "@/components/session-panel";
import { QueueStatusPanel } from "@/components/queue-status";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type {
  WhatsAppGroup,
  WhatsAppContact,
  GroupParticipant,
  TransferProgress,
  TransferMode,
  SessionInfo,
  QueueStatus,
} from "@shared/schema";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

type SourceMode = "group" | "contacts";

interface DashboardProps {
  onDisconnect: () => void;
  transferProgress: TransferProgress | null;
  onClearProgress: () => void;
  lastError: string | null;
  clearError: () => void;
  sessions: SessionInfo[];
  queueStatus: QueueStatus;
  sessionQRCodes: Record<string, string>;
  user?: { id: number; username: string; role: string };
  onLogout?: () => void;
  onShowAdmin?: () => void;
}

export function Dashboard({
  onDisconnect,
  transferProgress,
  onClearProgress,
  lastError,
  clearError,
  sessions,
  queueStatus,
  sessionQRCodes,
  user,
  onLogout,
  onShowAdmin,
}: DashboardProps) {
  const { toast } = useToast();
  const [sourceMode, setSourceMode] = useState<SourceMode>("group");
  const [sourceGroupId, setSourceGroupId] = useState<string | null>(null);
  const [targetGroupId, setTargetGroupId] = useState<string | null>(null);
  const [selectedParticipants, setSelectedParticipants] = useState<Set<string>>(
    new Set()
  );
  const [isTransferring, setIsTransferring] = useState(false);
  const [transferMode, setTransferMode] = useState<TransferMode>("direct");

  const {
    data: groups = [],
    isLoading: isLoadingGroups,
    error: groupsError,
    refetch: refetchGroups,
  } = useQuery<WhatsAppGroup[]>({
    queryKey: ["/api/whatsapp/groups"],
  });

  const {
    data: participants = [],
    isLoading: isLoadingParticipants,
  } = useQuery<GroupParticipant[]>({
    queryKey: ["/api/whatsapp/groups", sourceGroupId, "participants"],
    enabled: !!sourceGroupId && sourceMode === "group",
  });

  const {
    data: contacts = [],
    isLoading: isLoadingContacts,
  } = useQuery<WhatsAppContact[]>({
    queryKey: ["/api/whatsapp/contacts"],
    enabled: sourceMode === "contacts",
  });

  useEffect(() => {
    setSelectedParticipants(new Set());
  }, [sourceGroupId, sourceMode]);

  useEffect(() => {
    if (lastError) {
      toast({
        title: "Erro na transferência",
        description: lastError,
        variant: "destructive",
      });
      setIsTransferring(false);
      clearError();
    }
  }, [lastError, clearError, toast]);

  useEffect(() => {
    const s = transferProgress?.status;
    if (s === "completed" || s === "error" || s === "stopped") {
      setIsTransferring(false);
    }
    if (s === "in_progress" || s === "cooldown" || s === "paused") {
      setIsTransferring(true);
    }
  }, [transferProgress?.status]);

  const handleToggleParticipant = useCallback((id: string) => {
    setSelectedParticipants((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const handleSelectAll = useCallback(() => {
    if (sourceMode === "contacts") {
      setSelectedParticipants(new Set(contacts.map((c) => c.id)));
    } else {
      setSelectedParticipants(new Set(participants.map((p) => p.id)));
    }
  }, [participants, contacts, sourceMode]);

  const handleDeselectAll = useCallback(() => {
    setSelectedParticipants(new Set());
  }, []);

  const handleTransfer = async () => {
    const hasSource = sourceMode === "group" ? !!sourceGroupId : selectedParticipants.size > 0;
    if (!hasSource || !targetGroupId || selectedParticipants.size === 0) {
      toast({
        title: "Dados incompletos",
        description: sourceMode === "contacts"
          ? "Selecione o grupo de destino e pelo menos um contato."
          : "Selecione os grupos e pelo menos um membro.",
        variant: "destructive",
      });
      return;
    }

    setIsTransferring(true);
    try {
      await apiRequest("POST", "/api/whatsapp/transfer", {
        sourceGroupId: sourceMode === "group" ? sourceGroupId : null,
        targetGroupId,
        participantIds: Array.from(selectedParticipants),
        mode: transferMode,
      });
    } catch (err: any) {
      toast({
        title: "Erro",
        description: err.message || "Falha ao iniciar transferência",
        variant: "destructive",
      });
      setIsTransferring(false);
    }
  };

  const handleDisconnect = async () => {
    try {
      await apiRequest("POST", "/api/whatsapp/disconnect");
      onDisconnect();
    } catch (err: any) {
      toast({
        title: "Erro",
        description: "Falha ao desconectar",
        variant: "destructive",
      });
    }
  };

  const handleSessionsChange = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/sessions"] });
  };

  const connectedCount = sessions.filter((s) => s.status === "connected").length;

  if (transferProgress && isTransferring) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="w-full max-w-md">
          <Card className="p-6">
            <TransferProgressView
              progress={transferProgress}
              onClose={() => {
                setIsTransferring(false);
                onClearProgress();
                setSelectedParticipants(new Set());
                queryClient.invalidateQueries({
                  queryKey: ["/api/whatsapp/groups"],
                });
              }}
            />
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-primary flex items-center justify-center">
              <SiWhatsapp className="w-5 h-5 text-primary-foreground" />
            </div>
            <div>
              <h1 className="font-bold text-foreground text-sm leading-tight" data-testid="text-header-title">
                WhatsApp Transfer
              </h1>
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full bg-green-500" />
                <span className="text-xs text-muted-foreground">
                  {connectedCount} conta{connectedCount !== 1 ? "s" : ""} conectada{connectedCount !== 1 ? "s" : ""}
                </span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {user && (
              <span className="text-xs text-muted-foreground hidden sm:inline">
                {user.username}
              </span>
            )}
            {onShowAdmin && (
              <Button
                variant="outline"
                size="sm"
                onClick={onShowAdmin}
                data-testid="button-admin-panel"
              >
                <Shield className="w-4 h-4 mr-1.5" />
                Admin
              </Button>
            )}
            <Button
              variant="secondary"
              size="sm"
              onClick={onLogout || handleDisconnect}
              data-testid="button-logout"
            >
              <LogOut className="w-4 h-4 mr-1.5" />
              Sair
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-6"
        >
          <SessionPanel
            sessions={sessions}
            sessionQRCodes={sessionQRCodes}
            onSessionsChange={handleSessionsChange}
          />

          <QueueStatusPanel queue={queueStatus} />

          <div className="text-center mb-2">
            <h2 className="text-xl font-bold text-foreground" data-testid="text-page-title">
              Transferir Membros
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              Escolha a origem dos contatos e transfira para um grupo
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2 max-w-md mx-auto">
            <button
              onClick={() => { setSourceMode("group"); setSelectedParticipants(new Set()); }}
              data-testid="button-source-group"
              className={cn(
                "flex items-center justify-center gap-2 p-3 rounded-lg text-sm font-medium transition-colors cursor-pointer",
                sourceMode === "group"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted/50 text-muted-foreground hover:bg-muted"
              )}
            >
              <Users className="w-4 h-4" />
              De Grupo
            </button>
            <button
              onClick={() => { setSourceMode("contacts"); setSourceGroupId(null); setSelectedParticipants(new Set()); }}
              data-testid="button-source-contacts"
              className={cn(
                "flex items-center justify-center gap-2 p-3 rounded-lg text-sm font-medium transition-colors cursor-pointer",
                sourceMode === "contacts"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted/50 text-muted-foreground hover:bg-muted"
              )}
            >
              <MessageCircle className="w-4 h-4" />
              De Conversas
            </button>
          </div>

          {sourceMode === "group" ? (
            isLoadingGroups ? (
              <Card className="p-12">
                <div className="flex flex-col items-center gap-4">
                  <Loader2 className="w-8 h-8 animate-spin text-primary" />
                  <div className="text-center">
                    <p className="text-sm font-medium text-foreground">
                      Carregando seus grupos...
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Isso pode levar alguns segundos na primeira vez
                    </p>
                  </div>
                </div>
              </Card>
            ) : groupsError ? (
              <Card className="p-8">
                <div className="flex flex-col items-center gap-4">
                  <div className="w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center">
                    <AlertCircle className="w-6 h-6 text-destructive" />
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-medium text-foreground">
                      Erro ao carregar grupos
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {(groupsError as Error)?.message || "Não foi possível carregar seus grupos. Tente novamente."}
                    </p>
                  </div>
                  <Button
                    onClick={() => refetchGroups()}
                    data-testid="button-retry-groups"
                  >
                    <RefreshCw className="w-4 h-4 mr-2" />
                    Tentar novamente
                  </Button>
                </div>
              </Card>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <Card className="p-4 sm:p-5">
                  <GroupSelector
                    groups={groups}
                    selectedGroupId={sourceGroupId}
                    onSelect={setSourceGroupId}
                    label="Grupo de Origem"
                    description="Selecione o grupo de onde os membros serão transferidos"
                    disabledGroupId={targetGroupId}
                  />
                </Card>

                <Card className="p-4 sm:p-5">
                  <GroupSelector
                    groups={groups}
                    selectedGroupId={targetGroupId}
                    onSelect={setTargetGroupId}
                    label="Grupo de Destino"
                    description="Selecione o grupo para onde os membros serão transferidos"
                    disabledGroupId={sourceGroupId}
                  />
                </Card>
              </div>
            )
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Card className="p-4 sm:p-5">
                <ContactSelector
                  contacts={contacts}
                  selectedIds={selectedParticipants}
                  onToggle={handleToggleParticipant}
                  onSelectAll={handleSelectAll}
                  onDeselectAll={handleDeselectAll}
                  isLoading={isLoadingContacts}
                />
              </Card>

              <Card className="p-4 sm:p-5">
                {isLoadingGroups ? (
                  <div className="flex flex-col items-center gap-3 py-8">
                    <Loader2 className="w-6 h-6 animate-spin text-primary" />
                    <p className="text-sm text-muted-foreground">Carregando grupos...</p>
                  </div>
                ) : groupsError ? (
                  <div className="flex flex-col items-center gap-3 py-8">
                    <AlertCircle className="w-6 h-6 text-destructive" />
                    <p className="text-sm text-muted-foreground">Erro ao carregar grupos</p>
                    <Button size="sm" onClick={() => refetchGroups()} data-testid="button-retry-groups-contacts">
                      <RefreshCw className="w-4 h-4 mr-2" />
                      Tentar novamente
                    </Button>
                  </div>
                ) : (
                  <GroupSelector
                    groups={groups}
                    selectedGroupId={targetGroupId}
                    onSelect={setTargetGroupId}
                    label="Grupo de Destino"
                    description="Selecione o grupo para onde os contatos serão adicionados"
                  />
                )}
              </Card>
            </div>
          )}

          {sourceMode === "group" && sourceGroupId && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <Card className="p-4 sm:p-5">
                <ParticipantList
                  participants={participants}
                  selectedIds={selectedParticipants}
                  onToggle={handleToggleParticipant}
                  onSelectAll={handleSelectAll}
                  onDeselectAll={handleDeselectAll}
                  isLoading={isLoadingParticipants}
                />
              </Card>
            </motion.div>
          )}

          {((sourceMode === "group" && sourceGroupId) || sourceMode === "contacts") && targetGroupId && selectedParticipants.size > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <Card className="p-4 sm:p-5 space-y-4">
                <div>
                  <h3 className="font-semibold text-foreground text-sm mb-2">Modo de transferência</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <button
                      onClick={() => setTransferMode("direct")}
                      data-testid="button-mode-direct"
                      className={cn(
                        "flex items-start gap-3 p-3 rounded-md text-left transition-colors cursor-pointer",
                        transferMode === "direct"
                          ? "bg-primary/10 ring-2 ring-primary"
                          : "bg-muted/50 hover-elevate"
                      )}
                    >
                      <UserPlus className={cn(
                        "w-5 h-5 mt-0.5 shrink-0",
                        transferMode === "direct" ? "text-primary" : "text-muted-foreground"
                      )} />
                      <div>
                        <p className="text-sm font-medium text-foreground">
                          Adição direta + fallback convite
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Todas as contas adicionam direto no grupo. Se falhar, envia convite automaticamente.
                        </p>
                      </div>
                    </button>
                    <button
                      onClick={() => setTransferMode("invite")}
                      data-testid="button-mode-invite"
                      className={cn(
                        "flex items-start gap-3 p-3 rounded-md text-left transition-colors cursor-pointer",
                        transferMode === "invite"
                          ? "bg-primary/10 ring-2 ring-primary"
                          : "bg-muted/50 hover-elevate"
                      )}
                    >
                      <Send className={cn(
                        "w-5 h-5 mt-0.5 shrink-0",
                        transferMode === "invite" ? "text-primary" : "text-muted-foreground"
                      )} />
                      <div>
                        <p className="text-sm font-medium text-foreground">
                          Apenas convite
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Envia somente o link do grupo por mensagem privada. Não tenta adição direta.
                        </p>
                      </div>
                    </button>
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row items-center gap-4 pt-2 border-t">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div className="flex items-center gap-2 min-w-0">
                      {sourceMode === "contacts" ? (
                        <MessageCircle className="w-4 h-4 text-muted-foreground shrink-0" />
                      ) : (
                        <Users className="w-4 h-4 text-muted-foreground shrink-0" />
                      )}
                      <span className="text-sm text-foreground truncate">
                        {sourceMode === "contacts"
                          ? "Conversas"
                          : groups.find((g) => g.id === sourceGroupId)?.name}
                      </span>
                    </div>
                    <ArrowRight className="w-4 h-4 text-primary shrink-0" />
                    <div className="flex items-center gap-2 min-w-0">
                      <Users className="w-4 h-4 text-muted-foreground shrink-0" />
                      <span className="text-sm text-foreground truncate">
                        {groups.find((g) => g.id === targetGroupId)?.name}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge variant="secondary">
                      {selectedParticipants.size} {sourceMode === "contacts" ? "contatos" : "membros"}
                    </Badge>
                    <Button
                      onClick={handleTransfer}
                      disabled={isTransferring}
                      data-testid="button-transfer"
                    >
                      {isTransferring ? (
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      ) : transferMode === "invite" ? (
                        <Send className="w-4 h-4 mr-2" />
                      ) : (
                        <UserPlus className="w-4 h-4 mr-2" />
                      )}
                      {transferMode === "invite" ? "Enviar convites" : "Adicionar"}
                    </Button>
                  </div>
                </div>
              </Card>
            </motion.div>
          )}
        </motion.div>
      </main>

      <footer className="border-t mt-auto">
        <div className="max-w-5xl mx-auto px-4 py-3">
          <p className="text-center text-xs text-muted-foreground">
            WhatsApp Transfer Bot - Transferência segura de membros entre grupos
          </p>
        </div>
      </footer>
    </div>
  );
}
