import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const baseUrl = process.env.E2E_BASE_URL || "http://127.0.0.1:4173";
const chromePath =
  process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const localUserId = "00000000-0000-4000-8000-000000000001";
const professorId = localUserId;

const storageKeys = {
  bookings: "on_tennis_local_bookings",
  sessions: "on_tennis_local_reservation_sessions",
  orders: "on_tennis_local_checkout_orders",
  items: "on_tennis_local_checkout_items",
  attempts: "on_tennis_local_payment_attempts",
  notifications: "on_tennis_local_notifications",
  grants: "on_tennis_local_credit_grants",
  allocations: "on_tennis_local_credit_allocations",
  ledger: "on_tennis_local_credit_ledger",
  plans: "on_tennis_local_class_plans",
  settings: "on_tennis_local_site_settings",
};

const browser = await chromium.launch({ executablePath: chromePath, headless: true });
const failures = [];

function dateFromNow(days) {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + days);
  return date;
}

function isoDateFromNow(days) {
  const date = dateFromNow(days);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function fullDateFromNow(days) {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(dateFromNow(days));
}

async function setAudience(page, audience) {
  await page.evaluate((value) => localStorage.setItem("session_audience", value), audience);
}

async function resetDomainData(page) {
  await page.evaluate((keys) => {
    for (const key of Object.values(keys)) localStorage.setItem(key, "[]");
    localStorage.removeItem("on_tennis_local_class_plans");
    localStorage.setItem(
      "on_tennis_local_site_settings",
      JSON.stringify([{ key: "cancellation_notice_hours", value: "24" }]),
    );
    window.dispatchEvent(new CustomEvent("on-tennis-local-data-change"));
  }, storageKeys);
}

async function openLoggedPage(context, viewport = { width: 390, height: 844 }) {
  const page = await context.newPage();
  await page.setViewportSize(viewport);
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto(`${baseUrl}/auth`, { waitUntil: "networkidle" });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await page.waitForURL(/\/(?:app|admin)(?:\/|$)/);
  await resetDomainData(page);
  return { page, pageErrors };
}

async function selectDate(page, days) {
  const date = page.getByLabel(fullDateFromNow(days), { exact: true });
  if ((await date.count()) === 0) {
    await page.getByLabel(/Pr.ximo m.s/).click();
  }
  await date.click();
}

async function readRows(page, key) {
  return page.evaluate((storageKey) => JSON.parse(localStorage.getItem(storageKey) || "[]"), key);
}

async function writeRows(page, key, rows) {
  await page.evaluate(
    ({ storageKey, nextRows }) => {
      localStorage.setItem(storageKey, JSON.stringify(nextRows));
      window.dispatchEvent(
        new CustomEvent("on-tennis-local-data-change", { detail: { key: storageKey } }),
      );
    },
    { storageKey: key, nextRows: rows },
  );
}

async function approveOpenPix(page) {
  await page.getByRole("heading", { name: "Pagar com Pix" }).waitFor();
  await page.getByRole("button", { name: "Simular pagamento aprovado" }).click();
  await page
    .getByText(/Pagamento aprovado, plano ativado e aula reservada/, { exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Concluir", exact: true }).click();
}

async function buySelectedAgendaPlan(page) {
  await page.getByRole("button", { name: "Comprar plano e reservar" }).click();
  await approveOpenPix(page);
}

async function reserveSelectedSlot(page) {
  await page.getByRole("button", { name: /Reservar com 1 cr.dito/ }).click();
  await page
    .getByText(/Aula confirmada com cr.dito/, { exact: true })
    .last()
    .waitFor();
}

async function assertNoHorizontalOverflow(page, label) {
  const dimensions = await page.evaluate(() => ({
    body: document.body.scrollWidth,
    root: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
  }));
  assert(
    Math.max(dimensions.body, dimensions.root) <= dimensions.viewport + 1,
    `${label} has horizontal overflow: ${JSON.stringify(dimensions)}`,
  );
}

function planCard(page, title) {
  return page
    .getByText(title, { exact: true })
    .locator("xpath=ancestor::div[.//button[contains(., 'Editar')]][1]");
}

async function runCase(name, test) {
  const context = await browser.newContext();
  try {
    await test(context);
    console.log(`PASS: ${name}`);
  } catch (error) {
    failures.push(`${name}: ${error.stack || error.message}`);
    console.error(`FAIL: ${name}: ${error.message}`);
  } finally {
    await context.close();
  }
}

await runCase("admin plan create, update, deactivate and student catalog sync", async (context) => {
  const { page, pageErrors } = await openLoggedPage(context, { width: 1440, height: 1000 });
  await setAudience(page, "equipe");
  await page.goto(`${baseUrl}/admin/aulas-planos`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Novo plano/ }).click();

  let dialog = page.getByRole("dialog");
  const inputs = dialog.locator("input");
  await inputs.nth(0).fill("Dupla integracao E2E");
  await dialog.locator("select").nth(1).selectOption("dupla");
  await inputs.nth(1).fill("2");
  await inputs.nth(2).fill("123,45");
  await dialog.locator("textarea").fill("Plano criado no simulador isolado.");
  await dialog.getByRole("button", { name: "Salvar", exact: true }).click();
  await page.getByText("Plano criado", { exact: true }).waitFor();

  let plans = await readRows(page, storageKeys.plans);
  let created = plans.find((plan) => plan.title === "Dupla integracao E2E");
  assert(created, "The plan was not persisted by the admin UI.");
  assert.equal(created.credit_modality, "dupla");
  assert.equal(created.credit_quantity, 2);
  assert.equal(created.price_cents, 12345);

  await planCard(page, "Dupla integracao E2E")
    .getByRole("button", { name: /Editar/ })
    .click();
  dialog = page.getByRole("dialog");
  await dialog.locator("input").nth(2).fill("234,56");
  await dialog.getByRole("button", { name: "Salvar", exact: true }).click();
  await page.getByText("Plano atualizado", { exact: true }).waitFor();

  await setAudience(page, "aluno");
  await page.goto(`${baseUrl}/app/agenda`, { waitUntil: "networkidle" });
  const options = await page
    .getByLabel(/Plano de aula/)
    .locator("option")
    .allTextContents();
  assert(
    options.some((option) => option.includes("Dupla integracao E2E") && option.includes("234,56")),
  );

  await page.goto(`${baseUrl}/app/aulas`, { waitUntil: "networkidle" });
  await page.getByText("Dupla integracao E2E", { exact: true }).waitFor();
  await page.getByText("R$ 234,56", { exact: true }).waitFor();

  await setAudience(page, "equipe");
  await page.goto(`${baseUrl}/admin/aulas-planos`, { waitUntil: "networkidle" });
  await planCard(page, "Dupla integracao E2E")
    .getByRole("button", { name: /Desativar/ })
    .click();
  const deactivationDialog = page.getByRole("alertdialog");
  await deactivationDialog.getByRole("heading", { name: "Desativar este plano?" }).waitFor();
  await deactivationDialog.getByRole("button", { name: "Desativar plano" }).click();
  await page.getByText("Plano desativado", { exact: true }).waitFor();

  await setAudience(page, "aluno");
  await page.goto(`${baseUrl}/app/agenda`, { waitUntil: "networkidle" });
  const activeOptions = await page
    .getByLabel(/Plano de aula/)
    .locator("option")
    .allTextContents();
  assert(!activeOptions.some((option) => option.includes("Dupla integracao E2E")));
  assert.deepEqual(pageErrors, []);
});

await runCase(
  "individual Pix plan, immutable snapshot, credit ledger and safe cancellation",
  async (context) => {
    const { page, pageErrors } = await openLoggedPage(context);
    await setAudience(page, "aluno");
    await page.goto(`${baseUrl}/app/agenda`, { waitUntil: "networkidle" });
    await page.getByLabel(/Plano de aula/).selectOption("20000000-0000-4000-8000-000000000001");
    await selectDate(page, 7);
    await page.getByRole("button", { name: /10:00 Livre/ }).click();
    await page.getByRole("button", { name: "Comprar plano e reservar" }).click();

    let orders = await readRows(page, storageKeys.orders);
    assert.equal(orders.length, 1);
    assert.equal(orders[0].kind, "class_plan");
    assert.equal(orders[0].amount_cents, 25000);
    assert.equal(orders[0].metadata.plan_snapshot.credit_modality, "individual");
    assert.equal(orders[0].metadata.plan_snapshot.credit_quantity, 1);
    assert.equal(orders[0].metadata.initial_booking.booking_date, isoDateFromNow(7));
    assert.equal(orders[0].metadata.initial_booking.start_hour, 10);

    const plans = await readRows(page, storageKeys.plans);
    const sourcePlans = plans.length
      ? plans
      : [
          {
            id: "20000000-0000-4000-8000-000000000001",
            title: "Individual avulsa",
            active: true,
            price_cents: 25000,
            credit_modality: "individual",
            credit_quantity: 1,
          },
        ];
    await writeRows(
      page,
      storageKeys.plans,
      sourcePlans.map((plan) =>
        plan.id === "20000000-0000-4000-8000-000000000001"
          ? { ...plan, price_cents: 1, credit_quantity: 99 }
          : plan,
      ),
    );
    await approveOpenPix(page);

    orders = await readRows(page, storageKeys.orders);
    const grantsAfterPayment = await readRows(page, storageKeys.grants);
    const ledgerAfterPayment = await readRows(page, storageKeys.ledger);
    assert.equal(orders[0].status, "paid");
    assert.equal(orders[0].amount_cents, 25000);
    assert.equal(grantsAfterPayment[0].credits_granted, 1);
    assert.equal(grantsAfterPayment[0].amount_paid_cents, 25000);
    assert.deepEqual(
      ledgerAfterPayment.map((entry) => entry.entry_type),
      ["purchase_grant", "booking_debit"],
    );
    assert.deepEqual(
      ledgerAfterPayment.map((entry) => entry.credit_delta),
      [1, -1],
    );

    const sessions = await readRows(page, storageKeys.sessions);
    const bookings = await readRows(page, storageKeys.bookings);
    const allocations = await readRows(page, storageKeys.allocations);
    const ledgerAfterBooking = await readRows(page, storageKeys.ledger);
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].product_type, "aula_individual");
    assert.equal(sessions[0].capacity, 1);
    assert.equal(bookings[0].payment_method, "credito_plano");
    assert.equal(bookings[0].amount_cents, 0);
    assert.equal(allocations[0].status, "reserved");
    assert.deepEqual(
      ledgerAfterBooking.map((entry) => entry.credit_delta),
      [1, -1],
    );

    await page.goto(`${baseUrl}/app/pagamentos`, { waitUntil: "networkidle" });
    await page.getByText("Pago", { exact: true }).waitFor();
    await page.getByText("R$ 250,00", { exact: true }).waitFor();
    await page.goto(`${baseUrl}/app/aulas`, { waitUntil: "networkidle" });
    await page.getByText(/Cr.ditos liberados/, { exact: true }).waitFor();
    await page.getByText(/Aula reservada/, { exact: true }).waitFor();

    await page.goto(`${baseUrl}/app/agenda`, { waitUntil: "networkidle" });
    await selectDate(page, 7);
    await page.getByRole("button", { name: "Cancelar aula" }).click();
    const cancellationDialog = page.getByRole("alertdialog");
    await cancellationDialog.getByRole("heading", { name: "Cancelar esta aula?" }).waitFor();
    await cancellationDialog.getByRole("button", { name: "Cancelar aula" }).click();
    await page.getByText(/Aula cancelada e cr.dito devolvido/, { exact: true }).waitFor();

    const cancelledBookings = await readRows(page, storageKeys.bookings);
    const returnedAllocations = await readRows(page, storageKeys.allocations);
    const finalLedger = await readRows(page, storageKeys.ledger);
    const notifications = await readRows(page, storageKeys.notifications);
    assert.equal(cancelledBookings[0].status, "cancelada");
    assert.equal(returnedAllocations[0].status, "returned");
    assert.deepEqual(
      finalLedger.map((entry) => entry.credit_delta),
      [1, -1, 1],
    );
    assert.equal(
      finalLedger.reduce((sum, entry) => sum + entry.credit_delta, 0),
      1,
    );
    assert.deepEqual(
      notifications.map((notification) => notification.kind),
      ["credits_granted", "credit_booking_confirmed", "credit_booking_cancelled"],
    );

    const bell = page.getByRole("button", { name: /Notifica..es/ });
    await bell.click();
    await page
      .getByText(/Cr.dito devolvido/, { exact: true })
      .last()
      .waitFor();
    await page.getByText("Aula confirmada", { exact: true }).last().waitFor();
    await page
      .getByText(/Cr.ditos liberados/, { exact: true })
      .last()
      .waitFor();
    const readNotifications = await readRows(page, storageKeys.notifications);
    assert(readNotifications.every((notification) => notification.read === true));
    await bell.click();

    await page.getByRole("button", { name: /11:00 Livre/ }).click();
    await reserveSelectedSlot(page);
    assert.equal((await readRows(page, storageKeys.orders)).length, 1);
    const rebookedLedger = await readRows(page, storageKeys.ledger);
    assert.deepEqual(
      rebookedLedger.map((entry) => entry.credit_delta),
      [1, -1, 1, -1],
    );
    const rebooked = await readRows(page, storageKeys.bookings);
    assert.equal(rebooked.filter((booking) => booking.status === "confirmada").length, 1);
    assert.equal(rebooked.filter((booking) => booking.status === "cancelada").length, 1);

    await setAudience(page, "equipe");
    await page.goto(`${baseUrl}/admin/pagamentos`, { waitUntil: "networkidle" });
    await page.getByText("R$ 250,00", { exact: true }).last().waitFor();
    await page.getByText("Pago", { exact: true }).waitFor();
    assert.deepEqual(pageErrors, []);
  },
);

await runCase(
  "group capacities, shared occupancy, privacy and modality isolation",
  async (context) => {
    const { page, pageErrors } = await openLoggedPage(context);
    await setAudience(page, "aluno");
    await page.goto(`${baseUrl}/app/agenda`, { waitUntil: "networkidle" });
    await page.getByLabel(/Plano de aula/).selectOption("10000000-0000-4000-8000-000000000001");
    await page.getByRole("button", { name: "3 pessoas" }).click();
    await selectDate(page, 8);
    await page.getByRole("button", { name: /11:00 Livre/ }).click();
    await buySelectedAgendaPlan(page);
    await page.getByRole("button", { name: /11:00 Sua vaga 1\/3.*2 restantes/ }).waitFor();

    let sessions = await readRows(page, storageKeys.sessions);
    let bookings = await readRows(page, storageKeys.bookings);
    const trioSession = sessions.find((session) => session.start_hour === 11);
    assert.equal(trioSession.capacity, 3);
    assert.equal(trioSession.product_type, "aula_trio");
    bookings.push({
      id: "other-trio-seat",
      session_id: trioSession.id,
      user_id: "other-student-private-a",
      professor_id: professorId,
      booking_date: isoDateFromNow(8),
      start_hour: 11,
      type: "aula_trio",
      status: "confirmada",
      payment_status: "pago",
      payment_method: "credito_plano",
      hold_expires_at: null,
    });
    await writeRows(page, storageKeys.bookings, bookings);
    await page.getByRole("button", { name: /11:00 Sua vaga 2\/3.*1 restante/ }).waitFor();
    assert.equal(await page.getByText("other-student-private-a", { exact: false }).count(), 0);

    await page.getByRole("button", { name: "4 pessoas" }).click();
    await page.getByRole("button", { name: /12:00 Livre/ }).click();
    await reserveSelectedSlot(page);
    await page.getByRole("button", { name: /12:00 Sua vaga 1\/4.*3 restantes/ }).waitFor();

    sessions = await readRows(page, storageKeys.sessions);
    bookings = await readRows(page, storageKeys.bookings);
    const quartetSession = sessions.find((session) => session.start_hour === 12);
    assert.equal(quartetSession.capacity, 4);
    assert.equal(quartetSession.product_type, "aula_quarteto");
    bookings.push(
      {
        id: "other-quartet-seat-a",
        session_id: quartetSession.id,
        user_id: "other-student-private-b",
        professor_id: professorId,
        booking_date: isoDateFromNow(8),
        start_hour: 12,
        type: "aula_quarteto",
        status: "confirmada",
        payment_status: "pago",
        payment_method: "credito_plano",
        hold_expires_at: null,
      },
      {
        id: "other-quartet-seat-b",
        session_id: quartetSession.id,
        user_id: "other-student-private-c",
        professor_id: professorId,
        booking_date: isoDateFromNow(8),
        start_hour: 12,
        type: "aula_quarteto",
        status: "confirmada",
        payment_status: "pago",
        payment_method: "credito_plano",
        hold_expires_at: null,
      },
    );
    await writeRows(page, storageKeys.bookings, bookings);
    await page.getByRole("button", { name: /12:00 Sua vaga 3\/4.*1 restante/ }).waitFor();

    await page.getByLabel(/Plano de aula/).selectOption("20000000-0000-4000-8000-000000000001");
    await page.getByRole("button", { name: /10:00 Livre/ }).click();
    assert.equal(await page.getByRole("button", { name: /Reservar com 1 cr.dito/ }).count(), 0);
    await page.getByRole("button", { name: "Comprar plano e reservar" }).waitFor();
    assert.deepEqual(pageErrors, []);
  },
);

await runCase(
  "full double class blocks another reservation without leaking identities",
  async (context) => {
    const { page, pageErrors } = await openLoggedPage(context);
    await setAudience(page, "aluno");
    await page.goto(`${baseUrl}/app/agenda`, { waitUntil: "networkidle" });
    await page.getByLabel(/Plano de aula/).selectOption("30000000-0000-4000-8000-000000000001");
    await selectDate(page, 10);
    await page.getByRole("button", { name: /15:00 Livre/ }).click();
    await buySelectedAgendaPlan(page);
    await page.getByRole("button", { name: /15:00 Sua vaga 1\/2.*1 restante/ }).waitFor();

    const bookingDate = isoDateFromNow(10);
    const session = {
      id: "full-double-session",
      booking_date: bookingDate,
      start_hour: 13,
      professor_id: professorId,
      product_type: "aula_dupla",
      capacity: 2,
      unit_price_cents: 8000,
      status: "open",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    const occupied = ["private-user-one", "private-user-two"].map((userId, index) => ({
      id: `full-double-booking-${index}`,
      session_id: session.id,
      user_id: userId,
      professor_id: professorId,
      booking_date: bookingDate,
      start_hour: 13,
      type: "aula_dupla",
      status: "confirmada",
      payment_status: "pago",
      payment_method: "credito_plano",
      hold_expires_at: null,
    }));
    const existingSessions = await readRows(page, storageKeys.sessions);
    const existingBookings = await readRows(page, storageKeys.bookings);
    await writeRows(page, storageKeys.sessions, [...existingSessions, session]);
    await writeRows(page, storageKeys.bookings, [...existingBookings, ...occupied]);

    const fullSlot = page.getByRole("button", { name: /13:00 Lotado/ });
    await fullSlot.waitFor();
    assert.equal(await fullSlot.isDisabled(), true);
    assert.equal(await page.getByText(/private-user/, { exact: false }).count(), 0);
    assert.equal((await readRows(page, storageKeys.bookings)).length, 3);
    assert.deepEqual(pageErrors, []);
  },
);

await runCase("late cancellation releases the seat but forfeits the credit", async (context) => {
  const { page, pageErrors } = await openLoggedPage(context);
  await setAudience(page, "aluno");
  await page.goto(`${baseUrl}/app/agenda`, { waitUntil: "networkidle" });
  await page.getByLabel(/Plano de aula/).selectOption("10000000-0000-4000-8000-000000000001");
  await page.getByRole("button", { name: "3 pessoas" }).click();
  await selectDate(page, 5);
  await page.getByRole("button", { name: /14:00 Livre/ }).click();
  await buySelectedAgendaPlan(page);

  await setAudience(page, "equipe");
  await page.goto(`${baseUrl}/admin/configuracoes`, { waitUntil: "networkidle" });
  const noticeInput = page.getByLabel(/Anteced.ncia m.nima em horas/);
  await noticeInput.fill("720");
  await page.getByRole("button", { name: "Salvar prazo" }).click();
  await page.getByText(/Prazo de cancelamento atualizado/, { exact: true }).waitFor();

  await setAudience(page, "aluno");
  await page.goto(`${baseUrl}/app/agenda`, { waitUntil: "networkidle" });
  await selectDate(page, 5);
  await page.getByRole("button", { name: "Cancelar aula" }).click();
  const cancellationDialog = page.getByRole("alertdialog");
  await cancellationDialog.getByRole("heading", { name: "Cancelar esta aula?" }).waitFor();
  await cancellationDialog.getByRole("button", { name: "Cancelar aula" }).click();
  await page.getByText("Aula cancelada", { exact: true }).waitFor();

  const bookings = await readRows(page, storageKeys.bookings);
  const allocations = await readRows(page, storageKeys.allocations);
  const ledger = await readRows(page, storageKeys.ledger);
  assert.equal(bookings[0].status, "cancelada");
  assert.equal(allocations[0].status, "forfeited");
  assert.deepEqual(
    ledger.map((entry) => entry.credit_delta),
    [4, -1, 0],
  );
  assert.equal(
    ledger.reduce((sum, entry) => sum + entry.credit_delta, 0),
    3,
  );
  assert.equal(ledger.at(-1).entry_type, "late_cancellation_forfeit");
  assert.equal((await readRows(page, storageKeys.notifications)).at(-1).title, "Aula cancelada");
  await page.getByRole("button", { name: /14:00 Livre/ }).waitFor();
  assert.deepEqual(pageErrors, []);
});

await runCase("student and admin critical screens fit mobile and desktop", async (context) => {
  const { page, pageErrors } = await openLoggedPage(context);
  await setAudience(page, "aluno");
  for (const route of ["/app", "/app/agenda", "/app/aulas", "/app/pagamentos"]) {
    await page.goto(`${baseUrl}${route}`, { waitUntil: "networkidle" });
    await assertNoHorizontalOverflow(page, `${route} mobile`);
  }
  await setAudience(page, "equipe");
  for (const route of ["/admin", "/admin/reservas", "/admin/aulas-planos", "/admin/pagamentos"]) {
    await page.goto(`${baseUrl}${route}`, { waitUntil: "networkidle" });
    await assertNoHorizontalOverflow(page, `${route} mobile`);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  for (const route of ["/admin/reservas", "/admin/aulas-planos", "/admin/pagamentos"]) {
    await page.goto(`${baseUrl}${route}`, { waitUntil: "networkidle" });
    await assertNoHorizontalOverflow(page, `${route} desktop`);
  }
  assert.deepEqual(pageErrors, []);
});

await browser.close();

if (failures.length) {
  console.error("\nComprehensive E2E failures:\n" + failures.join("\n\n"));
  process.exitCode = 1;
} else {
  console.log("PASS: all isolated comprehensive booking scenarios completed.");
}
