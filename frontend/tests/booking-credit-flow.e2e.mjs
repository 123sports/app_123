import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const baseUrl = process.env.E2E_BASE_URL || "http://127.0.0.1:5173";
const browser = await chromium.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
});

function localDateFromNow(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  }).format(date);
}

function localFullDateFromNow(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto(`${baseUrl}/auth`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await page.waitForURL(/\/(?:app|admin)(?:\/|$)/);

  await page.evaluate(() => localStorage.setItem("session_audience", "equipe"));
  await page.goto(`${baseUrl}/admin/reservas`, { waitUntil: "networkidle" });
  const futureRow = page
    .locator("tbody tr")
    .filter({ hasText: localDateFromNow(1) })
    .first();
  await futureRow.waitFor();
  assert.equal(
    await futureRow.getByTitle("Presente").isDisabled(),
    true,
    "A future lesson still allows attendance.",
  );
  assert.equal(
    await futureRow.locator('option[value="concluida"]').count(),
    0,
    "A future lesson still allows completion.",
  );

  await page.goto(`${baseUrl}/admin/configuracoes`, { waitUntil: "networkidle" });
  const trioPrice = page.getByLabel("Valor de Aula em trio");
  await trioPrice.fill("66,00");
  await page.getByTitle("Salvar Aula em trio").click();
  await page.getByText("Aula em trio atualizado", { exact: true }).waitFor();

  await page.evaluate(() => localStorage.setItem("session_audience", "aluno"));
  await page.goto(`${baseUrl}/app/agenda`, { waitUntil: "networkidle" });
  await page.getByLabel("Tipo de aula").selectOption("aula_trio");
  await page.getByText(/R\$\s*66,00 por aluno/).waitFor();

  await page.goto(`${baseUrl}/app/aulas`, { waitUntil: "networkidle" });
  const planCard = page.getByText("Individual avulsa", { exact: true }).locator("../..");
  await planCard.getByRole("button", { name: "Comprar com Pix" }).click();
  await page.getByRole("heading", { name: "Pagar com Pix" }).waitFor();
  await page.getByRole("button", { name: "Simular pagamento aprovado" }).click();
  await page.getByText("Pagamento aprovado e créditos liberados", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Concluir", exact: true }).click();
  await page.getByText("1", { exact: true }).first().waitFor();

  await page.goto(`${baseUrl}/app/agenda`, { waitUntil: "networkidle" });
  const safeBookingDate = page.getByLabel(localFullDateFromNow(3), { exact: true });
  if ((await safeBookingDate.count()) === 0) {
    await page.getByLabel(/Pr.ximo m.s/).click();
  }
  await safeBookingDate.click();
  await page.getByLabel("Tipo de aula").selectOption("aula_individual");
  await page.getByRole("button", { name: /10:00 Livre/ }).click();
  await page.getByRole("button", { name: "Reservar com 1 crédito" }).click();
  await page.getByText("Aula confirmada com crédito", { exact: true }).waitFor();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Cancelar aula" }).click();
  await page.getByText("Aula cancelada e crédito devolvido", { exact: true }).waitFor();

  await page.evaluate(() => localStorage.setItem("session_audience", "equipe"));
  await page.goto(`${baseUrl}/admin/configuracoes`, { waitUntil: "networkidle" });
  await page.getByLabel("Valor de Aula em trio").fill("65,00");
  await page.getByTitle("Salvar Aula em trio").click();
  await page.getByText("Aula em trio atualizado", { exact: true }).waitFor();

  assert.deepEqual(pageErrors, [], `Browser errors: ${pageErrors.join(" | ")}`);
  console.log("PASS: future attendance and completion actions are blocked.");
  console.log("PASS: an admin price change reaches the student booking catalog.");
  console.log("PASS: plan Pix creates credit, booking consumes it and cancellation returns it.");
} finally {
  await browser.close();
}
