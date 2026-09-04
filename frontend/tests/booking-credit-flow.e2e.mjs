import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const baseUrl = process.env.E2E_BASE_URL || "http://127.0.0.1:4173";
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
  assert.equal(
    await page.getByText("Produtos e valores", { exact: true }).count(),
    0,
    "Legacy per-booking prices are still visible in settings.",
  );

  await page.evaluate(() => localStorage.setItem("session_audience", "aluno"));
  await page.goto(`${baseUrl}/app/agenda`, { waitUntil: "networkidle" });
  const planSelect = page.getByLabel("Plano de aula");
  await planSelect.selectOption("10000000-0000-4000-8000-000000000001");
  await page.getByRole("button", { name: "3 pessoas" }).waitFor();
  await page.getByRole("button", { name: "4 pessoas" }).waitFor();
  await page.getByRole("button", { name: "3 pessoas" }).click();
  assert.equal(
    await page.getByRole("button", { name: "3 pessoas" }).getAttribute("aria-pressed"),
    "true",
  );

  const groupBookingDate = page.getByLabel(localFullDateFromNow(4), { exact: true });
  if ((await groupBookingDate.count()) === 0) {
    await page.getByLabel(/Pr.ximo m.s/).click();
  }
  await groupBookingDate.click();
  await page.getByRole("button", { name: /11:00 Livre/ }).click();
  await page.getByText(/1 de 3 vagas ocupadas e 2 vagas restantes/).waitFor();
  await page.getByRole("button", { name: "Comprar plano e reservar" }).click();
  await page.getByRole("button", { name: "Simular pagamento aprovado" }).click();
  await page
    .getByText(/Pagamento aprovado, plano ativado e aula reservada/, { exact: true })
    .last()
    .waitFor();
  await page.getByRole("button", { name: "Concluir", exact: true }).click();
  await page.getByRole("button", { name: /11:00 Sua vaga 1\/3 · 2 restantes/ }).waitFor();
  await page.getByText(/Sua vaga · 1\/3 ocupadas · 2 restantes/).waitFor();
  assert.equal(
    await page.getByRole("button", { name: /Reservar com 1 cr.dito/ }).count(),
    0,
    "The confirmed slot remained selected and offered a duplicate credit booking.",
  );
  await page.getByRole("button", { name: "Cancelar aula" }).click();
  const groupCancellation = page.getByRole("alertdialog");
  await groupCancellation.getByRole("heading", { name: "Cancelar esta aula?" }).waitFor();
  await groupCancellation.getByRole("button", { name: "Cancelar aula" }).click();
  await page.getByText(/Aula cancelada e cr.dito devolvido/, { exact: true }).waitFor();

  await planSelect.selectOption("20000000-0000-4000-8000-000000000001");
  await page.getByRole("button", { name: "1 pessoa" }).waitFor();
  const safeBookingDate = page.getByLabel(localFullDateFromNow(3), { exact: true });
  if ((await safeBookingDate.count()) === 0) {
    await page.getByLabel(/Pr.ximo m.s/).click();
  }
  await safeBookingDate.click();
  await page.getByRole("button", { name: /10:00 Livre/ }).click();
  await page.getByRole("button", { name: "Comprar plano e reservar" }).click();
  await page.getByRole("heading", { name: "Pagar com Pix" }).waitFor();
  await page.getByRole("button", { name: "Simular pagamento aprovado" }).click();
  await page
    .getByText("Pagamento aprovado, plano ativado e aula reservada", { exact: true })
    .last()
    .waitFor();
  await page.getByRole("button", { name: "Concluir", exact: true }).click();
  await page.getByRole("button", { name: /10:00 Sua vaga/ }).waitFor();
  await page.getByRole("button", { name: "Cancelar aula" }).click();
  const individualCancellation = page.getByRole("alertdialog");
  await individualCancellation.getByRole("heading", { name: "Cancelar esta aula?" }).waitFor();
  await individualCancellation.getByRole("button", { name: "Cancelar aula" }).click();
  await page.getByText("Aula cancelada e crédito devolvido", { exact: true }).last().waitFor();

  assert.deepEqual(pageErrors, [], `Browser errors: ${pageErrors.join(" | ")}`);
  console.log("PASS: future attendance and completion actions are blocked.");
  console.log("PASS: legacy per-booking prices are hidden from the administrator.");
  console.log("PASS: the student sees only plans and the supported class capacities.");
  console.log("PASS: a three-seat class shows one occupied seat and two remaining seats.");
  console.log("PASS: plan Pix atomically grants credits and confirms the selected booking.");
} finally {
  await browser.close();
}
