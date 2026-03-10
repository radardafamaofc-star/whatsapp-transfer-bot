import { useState, useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Search, User, Shield, CheckSquare, Square, AlertTriangle } from "lucide-react";
import type { GroupParticipant } from "@shared/schema";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";

interface ParticipantListProps {
  participants: GroupParticipant[];
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  isLoading?: boolean;
}

export function ParticipantList({
  participants,
  selectedIds,
  onToggle,
  onSelectAll,
  onDeselectAll,
  isLoading,
}: ParticipantListProps) {
  const [search, setSearch] = useState("");

  const filteredParticipants = useMemo(() => {
    let list = participants;
    if (search.trim()) {
      const term = search.toLowerCase();
      list = list.filter((p) => p.number.toLowerCase().includes(term));
    }
    return [...list].sort((a, b) => {
      if (a.isLid && !b.isLid) return 1;
      if (!a.isLid && b.isLid) return -1;
      return 0;
    });
  }, [participants, search]);

  const unresolvedLidCount = participants.filter((p) => p.isLid).length;
  const resolvedLidCount = participants.filter((p) => !p.isLid && p.resolvedPhone).length;
  const allSelected = participants.length > 0 && selectedIds.size === participants.length;

  if (isLoading) {
    return (
      <div className="space-y-3">
        <div className="h-4 w-24 bg-muted rounded animate-pulse" />
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="flex items-center gap-3 px-3 py-2.5">
            <div className="w-4 h-4 bg-muted rounded animate-pulse" />
            <div className="w-8 h-8 bg-muted rounded-full animate-pulse" />
            <div className="flex-1 space-y-1.5">
              <div className="h-3.5 w-28 bg-muted rounded animate-pulse" />
              <div className="h-3 w-16 bg-muted rounded animate-pulse" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="font-semibold text-foreground text-sm">
          Membros do grupo
        </h3>
        <div className="flex items-center gap-2">
          <Badge variant="secondary" data-testid="badge-selected-count">
            {selectedIds.size} selecionados
          </Badge>
          <Button
            variant="secondary"
            size="sm"
            onClick={allSelected ? onDeselectAll : onSelectAll}
            data-testid="button-toggle-all"
          >
            {allSelected ? (
              <Square className="w-3.5 h-3.5 mr-1.5" />
            ) : (
              <CheckSquare className="w-3.5 h-3.5 mr-1.5" />
            )}
            {allSelected ? "Desmarcar" : "Selecionar todos"}
          </Button>
        </div>
      </div>

      {(unresolvedLidCount > 0 || resolvedLidCount > 0) && (
        <div className="space-y-1.5">
          {resolvedLidCount > 0 && (
            <div className="flex items-start gap-2 p-2.5 rounded-md bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800" data-testid="banner-lid-resolved">
              <CheckSquare className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
              <p className="text-xs text-emerald-700 dark:text-emerald-300">
                {resolvedLidCount} membro{resolvedLidCount > 1 ? "s" : ""} com ID interno {resolvedLidCount > 1 ? "foram resolvidos" : "foi resolvido"} para número de telefone e {resolvedLidCount > 1 ? "podem" : "pode"} ser transferido{resolvedLidCount > 1 ? "s" : ""}.
              </p>
            </div>
          )}
          {unresolvedLidCount > 0 && (
            <div className="flex items-start gap-2 p-2.5 rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800" data-testid="banner-lid-warning">
              <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-700 dark:text-amber-300">
                {unresolvedLidCount} membro{unresolvedLidCount > 1 ? "s" : ""} com ID interno (LID) não {unresolvedLidCount > 1 ? "puderam" : "pôde"} ser resolvido{unresolvedLidCount > 1 ? "s" : ""}. {unresolvedLidCount > 1 ? "Podem" : "Pode"} ser selecionado{unresolvedLidCount > 1 ? "s" : ""}, mas a transferência pode falhar.
              </p>
            </div>
          )}
        </div>
      )}

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por número..."
          className="pl-9"
          data-testid="input-search-participants"
        />
      </div>

      <ScrollArea className="h-[300px]">
        <div className="space-y-0.5 pr-3">
          <AnimatePresence>
            {filteredParticipants.length === 0 ? (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="py-8 text-center"
              >
                <User className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">
                  Nenhum membro encontrado
                </p>
              </motion.div>
            ) : (
              filteredParticipants.map((participant, index) => {
                const isSelected = selectedIds.has(participant.id);
                const isLid = participant.isLid === true;
                return (
                  <motion.div
                    key={participant.id}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: Math.min(index * 0.015, 0.3) }}
                    onClick={() => onToggle(participant.id)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onToggle(participant.id); }}
                    data-testid={`button-participant-${participant.id}`}
                    className={cn(
                      "w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-left transition-colors cursor-pointer",
                      isSelected
                        ? "bg-primary/5"
                        : "hover-elevate",
                      isLid && "opacity-70"
                    )}
                  >
                    <Checkbox
                      checked={isSelected}
                      className="pointer-events-none"
                      data-testid={`checkbox-participant-${participant.id}`}
                    />
                    <div className={cn(
                      "w-8 h-8 rounded-full flex items-center justify-center shrink-0",
                      isSelected ? "bg-primary/15" : "bg-muted"
                    )}>
                      <User className={cn(
                        "w-4 h-4",
                        isSelected ? "text-primary" : "text-muted-foreground"
                      )} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground">
                        {isLid ? participant.number : `+${participant.number}`}
                      </p>
                      <div className="flex items-center gap-2 mt-0.5">
                        {isLid && (
                          <span className="text-xs text-amber-600 dark:text-amber-400">
                            ID interno
                          </span>
                        )}
                        {!isLid && participant.resolvedPhone && (
                          <span className="text-xs text-emerald-600 dark:text-emerald-400">
                            Resolvido
                          </span>
                        )}
                        {participant.isAdmin && (
                          <span className="flex items-center gap-0.5 text-xs text-primary">
                            <Shield className="w-3 h-3" />
                            Admin
                          </span>
                        )}
                        {participant.isSuperAdmin && (
                          <span className="text-xs text-muted-foreground">
                            Criador
                          </span>
                        )}
                      </div>
                    </div>
                  </motion.div>
                );
              })
            )}
          </AnimatePresence>
        </div>
      </ScrollArea>
    </div>
  );
}
