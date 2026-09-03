import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const baseUrl = process.env.E2E_BASE_URL || "http://127.0.0.1:4173";
const browser = await chromium.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
});

function localFullDateFromNow(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

async function selectFutureDate(page, days) {
  const date = page.getByLabel(localFullDateFromNow(days), { exact: true });
  if ((await date.count()) === 0) {
    await page.getByLabel(/Pr.ximo m.s/).click();
  }
  await date.click();
}

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
  await page.getByLabel("Plano de aula").selectOption("10000000-0000-4000-8000-000000000001");
  await page.getByRole("button", { name: "3 pessoas" }).click();
  await selectFutureDate(page, 5);
  const freeSlot = page.getByRole("button", { name: /12:00 Livre/ });
  await freeSlot.click();
  await page.getByText(/1 de 3 vagas ocupadas e 2 vagas restantes/).waitFor();
  await page.waitForTimeout(600);
  await page.screenshot({ path: ".output/shared-session-agenda-mobile.png", fullPage: true });

  await page.getByRole("button", { name: "Comprar plano com Pix" }).click();
  await page.getByRole("heading", { name: "Pagar com Pix" }).waitFor();
  await page.getByRole("button", { name: "Simular pagamento aprovado" }).click();
  await page.getByText(/Pagamento aprovado e cr.ditos liberados/, { exact: true }).waitFor();
  await page.getByRole("button", { name: "Concluir", exact: true }).click();
  await page.getByRole("button", { name: /Reservar com 1 cr.dito/ }).click();
  await page.getByRole("button", { name: /12:00 Sua vaga 1\/3 · 2 restantes/ }).waitFor();
  await page.screenshot({ path: ".output/shared-session-owned-mobile.png", fullPage: true });

  await page.goto(`${baseUrl}/app`, { waitUntil: "networkidle" });
  await page.getByText(/Sua vaga · 1\/3 ocupadas · 2 restantes/).waitFor();
  await page.waitForTimeout(800);
  await page.screenshot({ path: ".output/shared-session-dashboard-mobile.png", fullPage: true });

  await page.evaluate(() => localStorage.setItem("session_audience", "equipe"));
  await page.goto(`${baseUrl}/admin/reservas`, { waitUntil: "networkidle" });
  await page.getByText("1/3 vagas reservadas", { exact: true }).first().waitFor();
  await page.waitForTimeout(600);
  await page.screenshot({ path: ".output/shared-session-admin-mobile.png", fullPage: true });

  await page.evaluate(() => localStorage.setItem("session_audience", "aluno"));
  await page.goto(`${baseUrl}/app/agenda`, { waitUntil: "networkidle" });
  await selectFutureDate(page, 5);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Cancelar aula" }).click();
  await page.getByText(/Aula cancelada e cr.dito devolvido/, { exact: true }).waitFor();

  assert.deepEqual(pageErrors, [], `Browser errors: ${pageErrors.join(" | ")}`);
  console.log("PASS: mobile agenda shows plan pricing and group capacity.");
  console.log("PASS: student agenda and dashboard show occupied and remaining seats.");
  console.log("PASS: the administrator sees the same shared-session occupancy.");
  console.log("PASS: the student dashboard lists only server-confirmed paid reservations.");
} finally {
  await browser.close();
}
