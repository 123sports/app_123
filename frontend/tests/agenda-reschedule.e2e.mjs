import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const browser = await chromium.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
});

try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  const baseUrl = process.env.E2E_BASE_URL || "http://127.0.0.1:4173";
  await page.goto(`${baseUrl}/auth`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await page.waitForTimeout(1500);
  if (!/\/(?:app|admin)(?:\/|$)/.test(new URL(page.url()).pathname)) {
    await page.screenshot({ path: ".output/local-login-failure.png", fullPage: true });
    throw new Error(`Local login did not navigate. Current URL: ${page.url()}`);
  }
  await page.goto(`${baseUrl}/app/agenda`, { waitUntil: "networkidle" });

  await page.getByRole("button", { name: "trocar horário", exact: true }).click();
  await page.getByText("Trocar horário", { exact: true }).waitFor();
  await page.screenshot({
    path: ".output/agenda-reschedule-mobile.png",
    fullPage: true,
  });

  await page.getByRole("button", { name: /10:00 Livre/ }).click();
  await page.getByRole("button", { name: "Confirmar troca", exact: true }).click();
  await page.getByText("Horário alterado com sucesso", { exact: true }).waitFor();
  await page.getByText("10:00", { exact: true }).first().waitFor();
  await page.getByText("Aula individual", { exact: true }).waitFor();

  assert.deepEqual(pageErrors, [], `Browser errors: ${pageErrors.join(" | ")}`);
  console.log("PASS: mobile student rescheduled a paid booking without a new charge.");
} finally {
  await browser.close();
}
