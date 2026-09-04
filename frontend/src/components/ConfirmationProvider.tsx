import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { CircleAlert } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  ConfirmationContext,
  type ConfirmAction,
  type ConfirmationOptions,
} from "@/hooks/use-confirmation";
import { cn } from "@/lib/utils";

type ConfirmationRequest = ConfirmationOptions & {
  resolve: (confirmed: boolean) => void;
};

export function ConfirmationProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<ConfirmationRequest | null>(null);
  const requestRef = useRef<ConfirmationRequest | null>(null);

  const settle = useCallback((confirmed: boolean) => {
    const current = requestRef.current;
    if (!current) return;
    requestRef.current = null;
    setRequest(null);
    current.resolve(confirmed);
  }, []);

  const confirmAction = useCallback<ConfirmAction>(
    (options) =>
      new Promise<boolean>((resolve) => {
        requestRef.current?.resolve(false);
        const next = { ...options, resolve };
        requestRef.current = next;
        setRequest(next);
      }),
    [],
  );

  useEffect(
    () => () => {
      requestRef.current?.resolve(false);
      requestRef.current = null;
    },
    [],
  );

  const contextValue = useMemo(() => confirmAction, [confirmAction]);

  return (
    <ConfirmationContext.Provider value={contextValue}>
      {children}
      <AlertDialog open={Boolean(request)} onOpenChange={(open) => !open && settle(false)}>
        <AlertDialogContent className="w-[calc(100%-2rem)] max-w-md gap-0 overflow-hidden border-border bg-card p-0 shadow-none sm:rounded-none">
          <AlertDialogHeader className="flex-row items-start gap-3 space-y-0 border-b border-border p-5 text-left">
            <span
              aria-hidden="true"
              className={cn(
                "flex h-10 w-10 shrink-0 items-center justify-center rounded-full",
                request?.destructive ? "bg-destructive/10 text-destructive" : "bg-acid text-ink",
              )}
            >
              <CircleAlert className="h-5 w-5" />
            </span>
            <span className="min-w-0">
              <AlertDialogTitle className="type-h3 leading-tight">
                {request?.title ?? "Confirmar ação"}
              </AlertDialogTitle>
              <AlertDialogDescription className="mt-2 whitespace-pre-line text-sm leading-relaxed">
                {request?.description}
              </AlertDialogDescription>
            </span>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 bg-background/40 p-4 sm:space-x-0">
            <AlertDialogCancel onClick={() => settle(false)}>
              {request?.cancelLabel ?? "Voltar"}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => settle(true)}
              className={cn(
                request?.destructive &&
                  "bg-destructive text-destructive-foreground hover:bg-destructive hover:brightness-95",
              )}
            >
              {request?.confirmLabel ?? "Confirmar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ConfirmationContext.Provider>
  );
}
