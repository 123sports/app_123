import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const baseUrl = process.env.E2E_BASE_URL || "http://127.0.0.1:4173";
const chromePath =
  process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const browser = await chromium.launch({ executablePath: chromePath, headless: true });

try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto(`${baseUrl}/auth`, { waitUntil: "networkidle" });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });

  assert.equal(await page.getByText(/Professor \/ Admin|Sou aluno/).count(), 0);
  await page.getByRole("button", { name: "Cadastre-se" }).click();
  await page.getByRole("heading", { name: "Crie sua conta" }).waitFor();

  const nameInput = page.getByLabel("Nome completo");
  const phoneInput = page.getByLabel("WhatsApp com DDD");
  const emailInput = page.getByLabel("E-mail");
  const passwordInput = page.locator('input[name="password"]');
  await nameInput.fill("Maria da Silva");
  await phoneInput.fill("51999");
  await emailInput.fill("maria@example.com");
  await passwordInput.fill("123456");
  await page.getByRole("button", { name: "Criar conta" }).click();
  const invalidPhoneToast = page.getByText("Informe um WhatsApp válido com DDD.");
  await invalidPhoneToast.waitFor();

  await phoneInput.fill("51999990000");
  assert.equal(await phoneInput.inputValue(), "(51) 99999-0000");
  await invalidPhoneToast.waitFor({ state: "hidden" });
  await phoneInput.evaluate((element) => element.blur());
  await page.screenshot({ path: ".output/student-signup-mobile.png", fullPage: true });

  const dimensions = await page.evaluate(() => ({
    viewport: window.innerWidth,
    content: document.documentElement.scrollWidth,
    overflowing: Array.from(document.querySelectorAll("*"))
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          tag: element.tagName,
          className: element.className?.toString().slice(0, 100) ?? "",
          left: rect.left,
          right: rect.right,
        };
      })
      .filter((element) => element.left < 0 || element.right > window.innerWidth),
  }));
  assert.ok(
    dimensions.content <= dimensions.viewport,
    `signup must not overflow on mobile (${dimensions.content}px > ${dimensions.viewport}px): ${JSON.stringify(dimensions.overflowing)}`,
  );

  await page.getByRole("button", { name: "Criar conta" }).click();

  await page.waitForURL(/\/app(?:\/|$)/);
  assert.equal(await page.getByText(/Confira seu e-mail|Reenviar confirmação/).count(), 0);
  assert.deepEqual(pageErrors, [], `Browser errors: ${pageErrors.join(" | ")}`);
  console.log("PASS: mobile student signup is validated and grants immediate student access.");
} finally {
  await browser.close();
}
