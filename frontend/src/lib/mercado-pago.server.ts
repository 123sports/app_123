import MercadoPagoConfig, {
  InvalidWebhookSignatureError,
  Payment,
  WebhookSignatureValidator,
} from "mercadopago";

const MERCADO_PAGO_API_TIMEOUT_MS = 12_000;

function requiredServerEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Variavel de servidor ausente: ${name}.`);
  return value;
}

function paymentClient() {
  const config = new MercadoPagoConfig({
    accessToken: requiredServerEnv("MERCADO_PAGO_ACCESS_TOKEN"),
    options: { timeout: MERCADO_PAGO_API_TIMEOUT_MS },
  });
  return new Payment(config);
}

function webhookUrl() {
  const rawBaseUrl = requiredServerEnv("APP_BASE_URL").replace(/\/+$/, "");
  let baseUrl: URL;
  try {
    baseUrl = new URL(rawBaseUrl);
  } catch {
    throw new Error("APP_BASE_URL precisa ser uma URL valida.");
  }
  if (baseUrl.protocol !== "https:") {
    throw new Error("APP_BASE_URL precisa usar HTTPS para pagamentos reais.");
  }
  return `${baseUrl.origin}/api/webhooks/mercadopago`;
}

export function isMercadoPagoConfigured() {
  return Boolean(
    process.env.MERCADO_PAGO_ACCESS_TOKEN?.trim()
    && process.env.MERCADO_PAGO_WEBHOOK_SECRET?.trim()
    && process.env.APP_BASE_URL?.trim(),
  );
}

export type MercadoPagoPayer = {
  email: string;
  fullName?: string | null;
  cpf?: string | null;
};

function splitName(fullName?: string | null) {
  const parts = fullName?.trim().split(/\s+/).filter(Boolean) ?? [];
  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(" ") || undefined,
  };
}

function normalizedCpf(value?: string | null) {
  const digits = value?.replace(/\D/g, "") ?? "";
  return digits.length === 11 ? digits : undefined;
}

function mercadoPagoDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error("Data de expiracao do Pix invalida.");
  }
  return date.toISOString().replace("Z", "+00:00");
}

export async function createMercadoPagoPix(input: {
  orderId: string;
  idempotencyKey: string;
  amountCents: number;
  description: string;
  expiresAt: string;
  payer: MercadoPagoPayer;
}) {
  const name = splitName(input.payer.fullName);
  const cpf = normalizedCpf(input.payer.cpf);
  return paymentClient().create({
    body: {
      transaction_amount: input.amountCents / 100,
      description: input.description,
      payment_method_id: "pix",
      external_reference: input.orderId,
      date_of_expiration: mercadoPagoDate(input.expiresAt),
      notification_url: webhookUrl(),
      payer: {
        email: input.payer.email,
        first_name: name.firstName,
        last_name: name.lastName,
        identification: cpf ? { type: "CPF", number: cpf } : undefined,
      },
      metadata: {
        checkout_order_id: input.orderId,
      },
    },
    requestOptions: {
      idempotencyKey: input.idempotencyKey,
    },
  });
}

export async function getMercadoPagoPayment(paymentId: string) {
  return paymentClient().get({ id: paymentId });
}

export async function cancelMercadoPagoPayment(paymentId: string) {
  return paymentClient().cancel({ id: paymentId });
}

export function validateMercadoPagoWebhook(input: {
  signature: string | null;
  requestId: string | null;
  dataId: string | null;
}) {
  WebhookSignatureValidator.validate({
    xSignature: input.signature,
    xRequestId: input.requestId,
    dataId: input.dataId,
    secret: requiredServerEnv("MERCADO_PAGO_WEBHOOK_SECRET"),
    toleranceSeconds: 300,
  });
}

export { InvalidWebhookSignatureError };
