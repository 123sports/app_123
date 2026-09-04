import { createContext, useContext } from "react";

export type ConfirmationOptions = {
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
};

export type ConfirmAction = (options: ConfirmationOptions) => Promise<boolean>;

export const ConfirmationContext = createContext<ConfirmAction | null>(null);

export function useConfirmation() {
  const confirmAction = useContext(ConfirmationContext);
  if (!confirmAction) {
    throw new Error("useConfirmation must be used within ConfirmationProvider");
  }
  return confirmAction;
}
