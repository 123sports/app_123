import { useEffect, useState } from "react";
import { Bell } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { playPop } from "@/lib/sfx";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

type Notif = {
  id: string;
  title: string;
  body: string | null;
  kind: string;
  read: boolean;
  created_at: string;
};

export function NotificationsBell() {
  const [items, setItems] = useState<Notif[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const unread = items.filter((i) => !i.read).length;

  useEffect(() => {
    let chan: ReturnType<typeof supabase.channel> | null = null;
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return;
      setUserId(u.user.id);
      const { data } = await (supabase as any)
        .from("notifications")
        .select("id, title, body, kind, read, created_at")
        .eq("user_id", u.user.id)
        .order("created_at", { ascending: false })
        .limit(20);
      setItems((data ?? []) as Notif[]);

      chan = supabase
        .channel(`notif:${u.user.id}:${Math.random().toString(36).slice(2)}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "notifications",
            filter: `user_id=eq.${u.user.id}`,
          },
          (payload) => {
            const n = payload.new as Notif;
            setItems((prev) => [n, ...prev].slice(0, 20));
            if (n.kind === "booking_confirmed") {
              toast.success(n.title, { description: n.body ?? undefined });
            } else {
              toast(n.title, { description: n.body ?? undefined });
            }
          },
        )
        .subscribe();
    })();
    return () => {
      if (chan) supabase.removeChannel(chan);
    };
  }, []);

  const markAllRead = async () => {
    if (!userId || unread === 0) return;
    const ids = items.filter((i) => !i.read).map((i) => i.id);
    await (supabase as any).from("notifications").update({ read: true }).in("id", ids);
    setItems((prev) => prev.map((i) => ({ ...i, read: true })));
  };

  return (
    <Popover open={open} onOpenChange={(v) => { setOpen(v); if (v) { playPop(); markAllRead(); } }}>
      <PopoverTrigger asChild>
        <button
          className="btn-bounce relative rounded-full border border-border bg-card p-2 hover:bg-secondary"
          aria-label="Notificações"
        >
          <Bell className="h-4 w-4" />
          {unread > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
              {unread}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="border-b border-border p-3">
          <div className="text-sm font-semibold">Notificações</div>
        </div>
        <div className="max-h-96 overflow-y-auto">
          {items.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              Nada por aqui ainda.
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {items.map((n) => (
                <li key={n.id} className="p-3 text-sm">
                  <div className="font-medium">{n.title}</div>
                  {n.body && <div className="mt-0.5 text-xs text-muted-foreground">{n.body}</div>}
                  <div className="mt-1 text-[10px] text-muted-foreground">
                    {formatDistanceToNow(new Date(n.created_at), { addSuffix: true, locale: ptBR })}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
