import { useState, useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Search, MessageCircle, CheckSquare, Square } from "lucide-react";
import type { WhatsAppContact } from "@shared/schema";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";

interface ContactSelectorProps {
  contacts: WhatsAppContact[];
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  isLoading?: boolean;
}

export function ContactSelector({
  contacts,
  selectedIds,
  onToggle,
  onSelectAll,
  onDeselectAll,
  isLoading,
}: ContactSelectorProps) {
  const [search, setSearch] = useState("");

  const filteredContacts = useMemo(() => {
    let list = contacts;
    if (search.trim()) {
      const term = search.toLowerCase();
      list = list.filter(
        (c) =>
          c.name.toLowerCase().includes(term) ||
          c.number.toLowerCase().includes(term)
      );
    }
    return [...list].sort((a, b) => {
      if (a.isLid && !b.isLid) return 1;
      if (!a.isLid && b.isLid) return -1;
      return a.name.localeCompare(b.name);
    });
  }, [contacts, search]);

  const allSelected =
    contacts.length > 0 &&
    contacts.every((c) => selectedIds.has(c.id));

  if (isLoading) {
    return (
      <div className="space-y-3">
        <div className="h-4 w-32 bg-muted rounded animate-pulse" />
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="flex items-center gap-3 px-3 py-2.5">
            <div className="w-4 h-4 bg-muted rounded animate-pulse" />
            <div className="w-8 h-8 bg-muted rounded-full animate-pulse" />
            <div className="flex-1 space-y-1.5">
              <div className="h-3.5 w-28 bg-muted rounded animate-pulse" />
              <div className="h-3 w-20 bg-muted rounded animate-pulse" />
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
          Conversas e contatos ({contacts.length})
        </h3>
        <div className="flex items-center gap-2">
          <Badge variant="secondary" data-testid="badge-contacts-selected">
            {selectedIds.size} selecionados
          </Badge>
          <Button
            variant="secondary"
            size="sm"
            onClick={allSelected ? onDeselectAll : onSelectAll}
            data-testid="button-toggle-all-contacts"
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

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por nome ou número..."
          className="pl-9"
          data-testid="input-search-contacts"
        />
      </div>

      <ScrollArea className="h-[300px] sm:h-[400px]">
        <div className="space-y-0.5 pr-3">
          <AnimatePresence>
            {filteredContacts.length === 0 ? (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="py-8 text-center"
              >
                <MessageCircle className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">
                  {search ? "Nenhum contato encontrado" : "Nenhuma conversa encontrada"}
                </p>
              </motion.div>
            ) : (
              filteredContacts.map((contact, index) => {
                const isSelected = selectedIds.has(contact.id);
                return (
                  <motion.div
                    key={contact.id}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: Math.min(index * 0.01, 0.2) }}
                    onClick={() => onToggle(contact.id)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") onToggle(contact.id);
                    }}
                    data-testid={`button-contact-${contact.id}`}
                    className={cn(
                      "w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-left transition-colors cursor-pointer",
                      isSelected
                        ? "bg-primary/5"
                        : "hover-elevate"
                    )}
                  >
                    <Checkbox
                      checked={isSelected}
                      className="pointer-events-none"
                    />
                    <div
                      className={cn(
                        "w-8 h-8 rounded-full flex items-center justify-center shrink-0",
                        isSelected ? "bg-primary/15" : "bg-muted"
                      )}
                    >
                      <MessageCircle
                        className={cn(
                          "w-4 h-4",
                          isSelected ? "text-primary" : "text-muted-foreground"
                        )}
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">
                        {contact.name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        +{contact.number}
                      </p>
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
