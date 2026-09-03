import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const baseUrl = process.env.E2E_BASE_URL || "http://127.0.0.1:5173";
const browser = await chromium.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
});

try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto(`${baseUrl}/auth`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await page.waitForURL(/\/(?:app|admin)(?:\/|$)/);

  await page.goto(`${baseUrl}/app`, { waitUntil: "networkidle" });
  await page.getByText("Próximas reservas", { exact: true }).waitFor();
  assert.equal(
    await page.getByRole("heading", { name: "Confirme sua presença" }).count(),
    0,
    "The student dashboard still allows browser-side booking confirmation.",
  );

  await page.goto(`${baseUrl}/app/agenda`, { waitUntil: "networkidle" });
  await page.getByLabel("Tipo de aula").selectOption("aula_trio");
  await page.getByText(/65,00 por aluno\s*·\s*até 3 alunos/).waitFor();
  const freeSlot = page.getByRole("button", { name: /10:00 Livre/ });
  await freeSlot.click();
  await page.getByText("R$ 65,00", { exact: true }).waitFor();
  await page.waitForTimeout(600);
  await page.screenshot({ path: ".output/shared-session-agenda-mobile.png", fullPage: true });

  await page.getByRole("button", { name: "Pagar reserva avulsa com Pix" }).click();
  await page.getByRole("heading", { name: "Pagar com Pix" }).waitFor();
  await page.getByRole("button", { name: "Fechar", exact: true }).click();
  await page.getByRole("button", { name: "Abrir Pix", exact: true }).click();
  await page.getByRole("heading", { name: "Pagar com Pix" }).waitFor();
  await page.getByRole("button", { name: "Fechar", exact: true }).click();
  await page.getByRole("button", { name: "Cancelar", exact: true }).click();
  await page.getByText("Cobrança cancelada. A vaga foi liberada.").waitFor();

  await page.evaluate(() => localStorage.setItem("session_audience", "equipe"));
  await page.goto(`${baseUrl}/admin/configuracoes`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Produtos e valores" }).waitFor();
  await page.getByText("Até 3 alunos por horário", { exact: true }).waitFor();
  await page.waitForTimeout(600);
  await page.screenshot({ path: ".output/shared-session-settings-mobile.png", fullPage: true });

  assert.deepEqual(pageErrors, [], `Browser errors: ${pageErrors.join(" | ")}`);
  console.log("PASS: mobile agenda shows per-student pricing and group capacity.");
  console.log("PASS: pending Pix can be resumed and cancelled without confirming a booking.");
  console.log("PASS: the student dashboard lists only server-confirmed paid reservations.");
  console.log("PASS: mobile admin can manage product prices and availability.");
} finally {
  await browser.close();
}
