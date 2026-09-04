import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";

const SCRIPT_ID = "cloudflare-turnstile-script";
const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

type TurnstileApi = {
  render: (
    container: HTMLElement,
    options: {
      sitekey: string;
      callback: (token: string) => void;
      "expired-callback": () => void;
      "error-callback": () => void;
      theme: "auto";
    },
  ) => string;
  reset: (widgetId: string) => void;
  remove: (widgetId: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

export type TurnstileHandle = {
  reset: () => void;
};

type TurnstileWidgetProps = {
  siteKey: string;
  onToken: (token: string | null) => void;
};

export const TurnstileWidget = forwardRef<TurnstileHandle, TurnstileWidgetProps>(
  function TurnstileWidget({ siteKey, onToken }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const widgetIdRef = useRef<string | null>(null);
    const onTokenRef = useRef(onToken);
    onTokenRef.current = onToken;

    useImperativeHandle(ref, () => ({
      reset: () => {
        if (widgetIdRef.current && window.turnstile) {
          window.turnstile.reset(widgetIdRef.current);
          onTokenRef.current(null);
        }
      },
    }));

    useEffect(() => {
      let cancelled = false;
      let createdScript: HTMLScriptElement | null = null;

      const renderWidget = () => {
        if (cancelled || !containerRef.current || !window.turnstile || widgetIdRef.current) return;
        widgetIdRef.current = window.turnstile.render(containerRef.current, {
          sitekey: siteKey,
          callback: (token) => onTokenRef.current(token),
          "expired-callback": () => onTokenRef.current(null),
          "error-callback": () => onTokenRef.current(null),
          theme: "auto",
        });
      };

      const existingScript = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
      if (window.turnstile) {
        renderWidget();
      } else if (existingScript) {
        existingScript.addEventListener("load", renderWidget);
      } else {
        const script = document.createElement("script");
        createdScript = script;
        script.id = SCRIPT_ID;
        script.src = SCRIPT_SRC;
        script.async = true;
        script.defer = true;
        script.addEventListener("load", renderWidget);
        document.head.appendChild(script);
      }

      return () => {
        cancelled = true;
        existingScript?.removeEventListener("load", renderWidget);
        createdScript?.removeEventListener("load", renderWidget);
        if (widgetIdRef.current && window.turnstile) {
          window.turnstile.remove(widgetIdRef.current);
          widgetIdRef.current = null;
        }
      };
    }, [siteKey]);

    return <div ref={containerRef} className="flex min-h-[65px] justify-center" />;
  },
);
