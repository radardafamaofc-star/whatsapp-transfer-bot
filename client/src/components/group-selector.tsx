import { useState, useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Search, Users, Shield, ChevronRight } from "lucide-react";
import type { WhatsAppGroup } from "@shared/schema";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";

interface GroupSelectorProps {
  groups: WhatsAppGroup[];
  selectedGroupId: string | null;
  onSelect: (groupId: string) => void;
  label: string;
  description: string;
  disabledGroupId?: string | null;
}

export function GroupSelector({
  groups,
  selectedGroupId,
  onSelect,
  label,
  description,
  disabledGroupId,
}: GroupSelectorProps) {
  const [search, setSearch] = useState("");

  const filteredGroups = useMemo(() => {
    if (!search.trim()) return groups;
    const term = search.toLowerCase();
    return groups.filter((g) => g.name.toLowerCase().includes(term));
  }, [groups, search]);

  const selectedGroup = groups.find((g) => g.id === selectedGroupId);

  return (
    <div className="space-y-3">
      <div>
        <h3 className="font-semibold text-foreground text-sm">{label}</h3>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>

      {selectedGroup && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          className="flex items-center gap-2 px-3 py-2 rounded-md bg-primary/10 border border-primary/20"
        >
          <Users className="w-4 h-4 text-primary shrink-0" />
          <span className="text-sm font-medium text-foreground truncate" data-testid={`text-selected-${label}`}>
            {selectedGroup.name}
          </span>
          <Badge variant="secondary" className="ml-auto shrink-0">
            {selectedGroup.participantCount}
          </Badge>
        </motion.div>
      )}

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar grupo..."
          className="pl-9"
          data-testid={`input-search-${label}`}
        />
      </div>

      <ScrollArea className="h-[200px]">
        <div className="space-y-1 pr-3">
          <AnimatePresence>
            {filteredGroups.length === 0 ? (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="py-8 text-center"
              >
                <p className="text-sm text-muted-foreground">
                  Nenhum grupo encontrado
                </p>
              </motion.div>
            ) : (
              filteredGroups.map((group, index) => {
                const isDisabled = group.id === disabledGroupId;
                const isSelected = group.id === selectedGroupId;

                return (
                  <motion.button
                    key={group.id}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: index * 0.02 }}
                    onClick={() => !isDisabled && onSelect(group.id)}
                    disabled={isDisabled}
                    data-testid={`button-group-${group.id}`}
                    className={cn(
                      "w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-left transition-colors",
                      isSelected
                        ? "bg-primary text-primary-foreground"
                        : isDisabled
                        ? "opacity-40 cursor-not-allowed"
                        : "hover-elevate active-elevate-2 cursor-pointer"
                    )}
                  >
                    <div className={cn(
                      "w-8 h-8 rounded-md flex items-center justify-center shrink-0",
                      isSelected ? "bg-primary-foreground/20" : "bg-muted"
                    )}>
                      <Users className={cn(
                        "w-4 h-4",
                        isSelected ? "text-primary-foreground" : "text-muted-foreground"
                      )} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={cn(
                        "text-sm font-medium truncate",
                        isSelected ? "text-primary-foreground" : "text-foreground"
                      )}>
                        {group.name}
                      </p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className={cn(
                          "text-xs",
                          isSelected ? "text-primary-foreground/70" : "text-muted-foreground"
                        )}>
                          {group.participantCount} membros
                        </span>
                        {group.isAdmin && (
                          <span className={cn(
                            "flex items-center gap-0.5 text-xs",
                            isSelected ? "text-primary-foreground/70" : "text-primary"
                          )}>
                            <Shield className="w-3 h-3" />
                            Admin
                          </span>
                        )}
                      </div>
                    </div>
                    {isSelected && (
                      <ChevronRight className="w-4 h-4 text-primary-foreground/70 shrink-0" />
                    )}
                  </motion.button>
                );
              })
            )}
          </AnimatePresence>
        </div>
      </ScrollArea>
    </div>
  );
}
