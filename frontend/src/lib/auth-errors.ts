type AuthOperation = "signin" | "signup" | "recovery" | "passwordUpdate";

type AuthErrorLike = {
  code?: string;
  message?: string;
};

const MESSAGES_BY_CODE: Record<string, string> = {
  captcha_failed: "Não foi possível validar a proteção de segurança. Tente novamente.",
  email_address_invalid: "Informe um e-mail válido.",
  email_exists: "Este e-mail já está cadastrado. Entre com sua senha ou recupere o acesso.",
  email_not_confirmed: "Confirme seu e-mail antes de entrar.",
  invalid_credentials: "E-mail ou senha incorretos.",
  over_email_send_rate_limit: "Aguarde um minuto antes de solicitar outro e-mail.",
  over_request_rate_limit: "Muitas tentativas seguidas. Aguarde alguns minutos e tente novamente.",
  signup_disabled: "Novos cadastros estão temporariamente indisponíveis.",
  user_already_exists: "Este e-mail já está cadastrado. Entre com sua senha ou recupere o acesso.",
  weak_password: "A senha precisa ter pelo menos 6 caracteres.",
};

const FALLBACK_BY_OPERATION: Record<AuthOperation, string> = {
  signin: "Não foi possível entrar agora. Confira seus dados e tente novamente.",
  signup: "Não foi possível criar sua conta agora. Tente novamente.",
  recovery: "Não foi possível solicitar a recuperação agora. Tente novamente.",
  passwordUpdate: "Não foi possível atualizar a senha agora. Solicite um novo link e tente novamente.",
};

export function friendlyAuthError(error: unknown, operation: AuthOperation): string {
  const candidate = error && typeof error === "object" ? (error as AuthErrorLike) : {};
  const code = candidate.code?.toLowerCase();
  if (code && MESSAGES_BY_CODE[code]) return MESSAGES_BY_CODE[code];

  const message = candidate.message?.toLowerCase() ?? "";
  if (message.includes("email not confirmed")) return MESSAGES_BY_CODE.email_not_confirmed;
  if (message.includes("invalid login credentials")) return MESSAGES_BY_CODE.invalid_credentials;
  if (message.includes("captcha")) return MESSAGES_BY_CODE.captcha_failed;
  if (message.includes("rate limit") || message.includes("security purposes")) {
    return MESSAGES_BY_CODE.over_request_rate_limit;
  }
  if (message.includes("password")) return MESSAGES_BY_CODE.weak_password;

  return FALLBACK_BY_OPERATION[operation];
}
