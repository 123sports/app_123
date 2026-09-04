import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const baseUrl = process.env.E2E_BASE_URL || "http://127.0.0.1:4173";
const chromePath =
  process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const localUserId = "00000000-0000-4000-8000-000000000001";

const browser = await chromium.launch({ executablePath: chromePath, headless: true });

function localDate() {
  const date = new Date();
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto(`${baseUrl}/auth`, { waitUntil: "networkidle" });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });
  await page.getByLabel("E-mail").fill("local@123sports.dev");
  await page.locator('input[name="password"]').fill("local123");
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await page.waitForTimeout(750);
  if (page.url().includes("/auth")) {
    const debug = await page.evaluate(() => ({
      storage: { ...localStorage },
      email: document.querySelector('input[name="email"]')?.value,
      password: document.querySelector('input[name="password"]')?.value,
    }));
    throw new Error(
      `Local login did not navigate: ${JSON.stringify(debug)} ${(await page.locator("body").innerText()).slice(-500)}`,
    );
  }
  await page.waitForURL(/\/(?:app|admin)(?:\/|$)/);

  const today = localDate();
  const now = Date.now();
  await page.evaluate(
    ({ today, now, userId }) => {
      localStorage.setItem("session_audience", "equipe");
      localStorage.setItem(
        "on_tennis_local_bookings",
        JSON.stringify([
          {
            id: "dashboard-booking",
            session_id: "dashboard-session",
            user_id: userId,
            professor_id: userId,
            booking_date: today,
            start_hour: 14,
            duration_hours: 1,
            type: "aula_trio",
            status: "confirmada",
            payment_status: "pago",
            payment_method: "credito_plano",
            hold_expires_at: null,
            attended: null,
          },
        ]),
      );
      localStorage.setItem(
        "on_tennis_local_checkout_orders",
        JSON.stringify([
          {
            id: "dashboard-paid-order",
            user_id: userId,
            kind: "class_plan",
            status: "paid",
            amount_cents: 29000,
            description: "Grupo mensal",
            created_at: new Date(now - 120_000).toISOString(),
            paid_at: new Date(now - 60_000).toISOString(),
            expires_at: new Date(now + 1_800_000).toISOString(),
            metadata: {},
          },
          {
            id: "dashboard-pending-order",
            user_id: userId,
            kind: "class_plan",
            status: "pending",
            amount_cents: 50000,
            description: "Dupla mensal",
            created_at: new Date(now - 30_000).toISOString(),
            paid_at: null,
            expires_at: new Date(now + 1_800_000).toISOString(),
            metadata: {
              initial_booking: {
                booking_date: today,
                start_hour: 16,
                booking_type: "aula_dupla",
                professor_id: userId,
              },
            },
          },
        ]),
      );
      localStorage.setItem(
        "on_tennis_local_notifications",
        JSON.stringify([
          {
            id: "activity-pending",
            user_id: userId,
            title: "Pix iniciado para uma aula",
            body: "Marina iniciou um Pix para a aula em dupla de hoje às 16:00.",
            kind: "payment_pending",
            read: false,
            related_checkout_order_id: "dashboard-pending-order",
            related_booking_id: null,
            created_at: new Date(now - 30_000).toISOString(),
          },
          {
            id: "activity-paid",
            user_id: userId,
            title: "Plano pago por Pix",
            body: "Marina pagou R$ 290,00 pelo Grupo mensal.",
            kind: "payment_paid",
            read: false,
            related_checkout_order_id: "dashboard-paid-order",
            related_booking_id: "dashboard-booking",
            created_at: new Date(now - 60_000).toISOString(),
          },
          {
            id: "activity-booking",
            user_id: userId,
            title: "Nova vaga confirmada",
            body: "Marina reservou hoje às 14:00. Duas vagas continuam disponíveis.",
            kind: "booking_new",
            read: false,
            related_checkout_order_id: "dashboard-paid-order",
            related_booking_id: "dashboard-booking",
            created_at: new Date(now - 90_000).toISOString(),
          },
          {
            id: "activity-expired",
            user_id: userId,
            title: "Pix expirado e horário liberado",
            body: "O Pix não foi concluído e a vaga está disponível novamente.",
            kind: "payment_expired",
            read: true,
            related_checkout_order_id: "old-order",
            related_booking_id: null,
            created_at: new Date(now - 120_000).toISOString(),
          },
        ]),
      );
      window.dispatchEvent(new CustomEvent("on-tennis-local-data-change"));
    },
    { today, now, userId: localUserId },
  );

  await page.goto(`${baseUrl}/admin`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Movimentações recentes" }).waitFor();
  await page.getByText("Pix iniciado para uma aula", { exact: true }).waitFor();
  await page.getByText("Pix expirado e horário liberado", { exact: true }).waitFor();
  await page.getByRole("heading", { name: "Agenda de hoje" }).waitFor();
  await page.getByText(/Aula em trio · 1 de 3 vagas/).waitFor();
  await page.getByRole("heading", { name: "Pix em andamento" }).waitFor();
  await page.getByText(/Reserva provisória em .* às 16:00/).waitFor();
  assert.match(await page.getByRole("link", { name: /Aulas hoje/ }).innerText(), /\b1\b/);
  assert.match(await page.getByRole("link", { name: /Próximos 7 dias/ }).innerText(), /\b0\b/);

  await page.getByRole("button", { name: "Pagamentos", exact: true }).click();
  await page.getByText("Plano pago por Pix", { exact: true }).waitFor();
  assert.equal(await page.getByText("Nova vaga confirmada", { exact: true }).count(), 0);
  await page.getByRole("button", { name: "Cancelamentos", exact: true }).click();
  await page.getByText("Pix expirado e horário liberado", { exact: true }).waitFor();
  assert.equal(await page.getByText("Plano pago por Pix", { exact: true }).count(), 0);

  const dimensions = await page.evaluate(() => ({
    body: document.body.scrollWidth,
    viewport: document.documentElement.clientWidth,
  }));
  assert.ok(
    dimensions.body <= dimensions.viewport + 1,
    `Dashboard has horizontal overflow: ${dimensions.body}px > ${dimensions.viewport}px`,
  );
  await page.getByRole("button", { name: "Tudo", exact: true }).click();
  await page.screenshot({ path: ".output/admin-dashboard-activity-mobile.png", fullPage: true });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${baseUrl}/admin`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Movimentações recentes" }).waitFor();
  await page.getByText(/Aula em trio · 1 de 3 vagas/).waitFor();
  await page.waitForTimeout(500);
  const desktopDimensions = await page.evaluate(() => ({
    body: document.body.scrollWidth,
    viewport: document.documentElement.clientWidth,
  }));
  assert.ok(
    desktopDimensions.body <= desktopDimensions.viewport + 1,
    `Desktop dashboard has horizontal overflow: ${desktopDimensions.body}px > ${desktopDimensions.viewport}px`,
  );
  await page.screenshot({ path: ".output/admin-dashboard-activity-desktop.png", fullPage: true });

  assert.deepEqual(pageErrors, [], `Browser errors: ${pageErrors.join(" | ")}`);
  console.log(
    "PASS: administrator activity feed filters payment, booking and cancellation events.",
  );
  console.log("PASS: today agenda groups occupancy and pending Pix shows its provisional slot.");
  console.log(
    "PASS: administrator dashboard fits the mobile viewport without horizontal overflow.",
  );
  console.log(
    "PASS: administrator dashboard fits the desktop viewport without horizontal overflow.",
  );
} finally {
  await browser.close();
}
