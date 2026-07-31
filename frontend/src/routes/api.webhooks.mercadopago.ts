import { createFileRoute } from "@tanstack/react-router";
import { handleMercadoPagoWebhook } from "@/lib/payments.webhook.server";

export const Route = createFileRoute("/api/webhooks/mercadopago")({
  server: {
    handlers: {
      GET: () => new Response("Method not allowed", {
        status: 405,
        headers: { Allow: "POST" },
      }),
      POST: async ({ request }) => {
        try {
          return await handleMercadoPagoWebhook(request);
        } catch (error) {
          console.error("[MercadoPago] Webhook processing failed", {
            error: error instanceof Error ? error.message : "unknown_error",
          });
          return new Response("Webhook processing failed", { status: 500 });
        }
      },
    },
  },
});
