import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const authOrigin = "https://finscope-test.supabase.co";
const apiOrigin = "https://finscope-api.test";
const user = {
  id: "50000000-0000-4000-8000-000000000001",
  email: "owner@example.test",
  user_metadata: { full_name: "Test Owner" },
  app_metadata: {},
  aud: "authenticated",
  created_at: "2026-01-01T00:00:00Z",
};
const session = {
  access_token: "test-access-token",
  refresh_token: "test-refresh-token",
  token_type: "bearer",
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  user,
};

let server;
let browser;
let address;

before(async () => {
  server = await createServer({
    server: { host: "127.0.0.1", port: 0 },
    define: {
      "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(authOrigin),
      "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": JSON.stringify("sb_publishable_finscope-browser-tests"),
      "import.meta.env.VITE_API_URL": JSON.stringify(apiOrigin),
    },
  });
  await server.listen();
  address = server.resolvedUrls.local[0];
  browser = await chromium.launch({ channel: process.env.FINSCOPE_BROWSER_CHANNEL || undefined });
});

after(async () => {
  await browser?.close();
  await server?.close();
});

async function openWorkspace(t, { viewport, signedIn = true, accountsStatus = 200, accounts = [], path = "/", write } = {}) {
  const records = [...accounts];
  const context = await browser.newContext({
    viewport,
    storageState: {
      cookies: [],
      origins: signedIn ? [{
        origin: new URL(address).origin,
        localStorage: [{ name: "sb-finscope-test-auth-token", value: JSON.stringify(session) }],
      }] : [],
    },
  });
  t.after(() => context.close());
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  await page.route(`${authOrigin}/auth/v1/**`, async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/logout")) return route.fulfill({ status: 204 });
    if (path.endsWith("/user")) return route.fulfill({ json: user });
    return route.abort();
  });
  await page.route(`${apiOrigin}/**`, async (route) => {
    if (route.request().headers().authorization !== `Bearer ${session.access_token}`) {
      return route.fulfill({ status: 401, json: { status: "unauthenticated" } });
    }
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() !== "GET" && write) return write(route, records);
    if (path === "/financial-accounts" && accountsStatus === 200) {
      return route.fulfill({ json: {
        accounts: records,
        summary: {
          currency: "SGD", balance: records[0]?.balance ?? "0.00",
          income: "0.00", expenses: "0.00", netCashflow: "0.00",
          from: "2026-06-01", to: "2026-06-30",
        },
      } });
    }
    if (path === "/financial-accounts") return route.fulfill({ status: accountsStatus, json: {} });
    if (records.some(({ id }) => path === `/financial-accounts/${id}/holdings`)) {
      return route.fulfill({ json: { holdings: [], trades: [] } });
    }
    if (records.some(({ id }) => path === `/financial-accounts/${id}/transactions`)) {
      return route.fulfill({ json: { transactions: [], transfers: [] } });
    }
    if (path === "/portfolio") {
      return route.fulfill({ json: {
        currency: "SGD", knownSubtotal: records[0]?.balance ?? "0.00",
        valuation: "complete", unpricedHoldings: 0,
      } });
    }
    return route.abort();
  });
  await page.goto(new URL(path, address).href);
  return page;
}

test("keeps the desktop Overview link current when collapsing and reopening navigation", async (t) => {
  const page = await openWorkspace(t);
  await page.getByRole("heading", { name: "Overview", exact: true }).waitFor();
  const navigation = page.getByRole("navigation", { name: "Primary navigation" });
  const overview = navigation.getByRole("link", { name: "Overview" });
  const collapse = page.getByRole("button", { name: "Collapse navigation" });
  const expand = page.getByRole("button", { name: "Expand navigation" });

  assert.equal(await overview.getAttribute("aria-current"), "page");
  assert.equal(await collapse.getAttribute("aria-expanded"), "true");
  await collapse.press("Enter");
  assert.equal(await expand.getAttribute("aria-expanded"), "false");
  assert.equal(await overview.getAttribute("aria-current"), "page");
  await expand.press("Enter");
  assert.equal(await collapse.getAttribute("aria-expanded"), "true");
});

test("keeps keyboard focus within mobile navigation and returns it on dismissal", async (t) => {
  const page = await openWorkspace(t, { viewport: { width: 390, height: 844 } });
  const trigger = page.getByRole("button", { name: "Open navigation" });
  const drawer = page.getByRole("dialog", { name: "Navigation" });
  const close = drawer.getByRole("button", { name: "Close navigation" });

  await trigger.press("Enter");
  await drawer.waitFor();
  await close.and(page.locator(":focus")).waitFor();
  await page.keyboard.press("Shift+Tab");
  await drawer.getByRole("link", { name: "Accounts" }).and(page.locator(":focus")).waitFor();
  await page.keyboard.press("Tab");
  await close.and(page.locator(":focus")).waitFor();
  await page.keyboard.press("Escape");
  await drawer.waitFor({ state: "hidden" });
  await trigger.and(page.locator(":focus")).waitFor();

  await trigger.press("Enter");
  await close.press("Enter");
  await drawer.waitFor({ state: "hidden" });
  await trigger.and(page.locator(":focus")).waitFor();
});

test("moves keyboard focus to desktop navigation when an open drawer becomes a sidebar", async (t) => {
  const page = await openWorkspace(t, { viewport: { width: 390, height: 844 } });
  const trigger = page.getByRole("button", { name: "Open navigation" });
  const drawer = page.getByRole("dialog", { name: "Navigation" });

  await trigger.press("Enter");
  await drawer.getByRole("button", { name: "Close navigation" }).and(page.locator(":focus")).waitFor();
  await page.setViewportSize({ width: 1024, height: 844 });
  await drawer.waitFor({ state: "hidden" });
  const overview = page.getByRole("navigation", { name: "Primary navigation" }).getByRole("link", { name: "Overview" });
  await overview.and(page.locator(":focus")).waitFor();
  assert.equal(await overview.getAttribute("aria-current"), "page");
});

test("signs out with the keyboard from the profile disclosure and stays signed out on reload", async (t) => {
  const page = await openWorkspace(t);
  await page.getByRole("heading", { name: "Financial accounts" }).waitFor();
  const profile = page.getByRole("button", { name: "Profile menu" });
  const signOut = page.getByRole("button", { name: "Sign out", exact: true });

  await profile.press("Enter");
  assert.equal(await profile.getAttribute("aria-expanded"), "true");
  await page.keyboard.press("Tab");
  await signOut.and(page.locator(":focus")).waitFor();
  await page.keyboard.press("Escape");
  await profile.and(page.locator(":focus")).waitFor();
  assert.equal(await profile.getAttribute("aria-expanded"), "false");

  await profile.press("Enter");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  const signIn = page.getByRole("heading", { name: "Sign in to FinScope" });
  await signIn.waitFor();
  await page.reload();
  await signIn.waitFor();
});

test("opens the dedicated Accounts creation view from Overview Quick actions", async (t) => {
  const page = await openWorkspace(t);
  const quickActions = page.getByRole("button", { name: "Quick actions" });
  await quickActions.press("Enter");
  assert.equal(await quickActions.getAttribute("aria-expanded"), "true");
  assert.equal(await page.getByRole("button", { name: "Record a transaction" }).count(), 0);
  assert.equal(await page.getByRole("button", { name: "Transfer cash" }).count(), 0);
  assert.equal(await page.getByRole("button", { name: "Record an ETF trade" }).count(), 0);
  await page.keyboard.press("Tab");
  await page.getByRole("button", { name: "Open a financial account" }).and(page.locator(":focus")).waitFor();
  await page.keyboard.press("Enter");
  const form = page.getByRole("region", { name: "Open a financial account" });
  await form.getByRole("textbox", { name: "Account name" }).and(page.locator(":focus")).waitFor();
  assert.equal(new URL(page.url()).pathname, "/accounts");
  assert.equal(new URL(page.url()).searchParams.get("open"), "true");
  assert.equal(await page.getByRole("link", { name: "Accounts", exact: true }).getAttribute("aria-current"), "page");
  assert.equal(await page.getByRole("heading", { name: "Financial summary" }).count(), 0);
  assert.equal(await page.getByRole("table").count(), 0);
  const chooseDate = form.getByRole("button", { name: "Choose date" });
  await chooseDate.press("Enter");
  const calendar = form.getByRole("dialog", { name: "Choose opening date" });
  await calendar.getByRole("button", { name: /^Today,/ }).waitFor();
  await page.keyboard.press("Escape");
  await calendar.waitFor({ state: "hidden" });
  await chooseDate.and(page.locator(":focus")).waitFor();
  await form.getByRole("button", { name: "Cancel" }).press("Enter");
  await form.waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "Open a financial account", exact: true }).and(page.locator(":focus")).waitFor();
  await page.goBack();
  await page.getByRole("heading", { name: "Overview", exact: true }).waitFor();
});

test("keeps account names, exact balances and row actions available across viewport sizes", async (t) => {
  const name = `Long financial account ${"X".repeat(76)}`;
  const page = await openWorkspace(t, {
    viewport: { width: 1440, height: 900 },
    path: "/accounts",
    accounts: [{
      id: "50000000-0000-4000-8000-000000000002",
      name, openingDate: "2026-06-01", type: "bank", currency: "SGD",
      openingBalance: "999999999999.99", balance: "999999999999.9912345678901234",
      earliestActivityDate: null,
    }],
  });
  const table = page.getByRole("table", { name: "Financial accounts" });
  const row = table.getByRole("row").filter({ hasText: name });

  for (const width of [1440, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await row.getByRole("rowheader", { name: name, exact: false }).waitFor();
    await row.getByText("SGD 999,999,999,999.9912345678901234", { exact: true }).waitFor();
    await row.getByRole("button", { name: `View history for ${name}` }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);
  }
});

test("opens and closes holdings for a long brokerage account name with the keyboard without overflowing", async (t) => {
  const name = "W".repeat(100);
  const page = await openWorkspace(t, {
    path: "/accounts",
    accounts: [{
      id: "50000000-0000-4000-8000-000000000003",
      name, openingDate: "2026-06-01", type: "brokerage", currency: "SGD",
      openingBalance: "0.00", balance: "0.00", earliestActivityDate: null,
    }],
  });
  const open = page.getByRole("button", { name: `View holdings for ${name}` });
  const heading = page.getByRole("heading", { name: `${name} holdings`, exact: true });
  const close = page.getByRole("button", { name: "Close holdings" });

  for (const width of [320, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    await open.press("Enter");
    await heading.and(page.locator(":focus")).waitFor();
    await page.getByText("No ETF trades recorded in this brokerage account.").waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true, `Page width at ${width}px`);
    await page.keyboard.press("Tab");
    await close.and(page.locator(":focus")).waitFor();
    await page.keyboard.press("Enter");
    await heading.waitFor({ state: "hidden" });
    await open.and(page.locator(":focus")).waitFor();
  }
});

test("closes holdings independently of transaction history for the same brokerage account", async (t) => {
  const name = "ETF brokerage";
  const page = await openWorkspace(t, { path: "/accounts", accounts: [{
    id: "50000000-0000-4000-8000-000000000003",
    name, openingDate: "2026-06-01", type: "brokerage", currency: "SGD",
    openingBalance: "0.00", balance: "0.00", earliestActivityDate: null,
  }] });
  const history = page.getByRole("heading", { name: "Transaction history" });
  const holdings = page.getByRole("heading", { name: `${name} holdings` });
  const openHoldings = page.getByRole("button", { name: `View holdings for ${name}` });

  await page.getByRole("button", { name: `View history for ${name}` }).press("Enter");
  await history.and(page.locator(":focus")).waitFor();
  const filter = page.getByLabel("Filter by type");
  await filter.selectOption("income");
  await openHoldings.press("Enter");
  await holdings.and(page.locator(":focus")).waitFor();
  await history.waitFor();
  await page.getByRole("button", { name: "Close holdings" }).press("Enter");
  await holdings.waitFor({ state: "hidden" });
  await openHoldings.and(page.locator(":focus")).waitFor();
  await history.waitFor();
  assert.equal(await filter.inputValue(), "income");
});

test("shows the Google sign-in screen to a signed-out visitor", async (t) => {
  const page = await openWorkspace(t, { path: "/accounts?open=true", signedIn: false });
  await page.getByRole("heading", { name: "Sign in to FinScope" }).waitFor();
  await page.getByRole("button", { name: "Continue with Google" }).waitFor();
  assert.equal(await page.getByRole("navigation", { name: "Primary navigation" }).count(), 0);
});

test("blocks financial workflows when the API refuses workspace access", async (t) => {
  const page = await openWorkspace(t, { accountsStatus: 403 });
  await page.getByRole("heading", { name: "Access restricted" }).waitFor();
  await page.getByRole("alert").filter({ hasText: "designated owner" }).waitFor();
  await page.getByRole("button", { name: "Profile menu" }).press("Enter");
  await page.getByRole("button", { name: "Sign out", exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Quick actions" }).count(), 0);
  assert.equal(await page.getByRole("heading", { name: "Financial accounts" }).count(), 0);
});

test("offers sign-out when the API rejects an expired session", async (t) => {
  const page = await openWorkspace(t, { accountsStatus: 401 });
  await page.getByRole("alert").filter({ hasText: "Your session could not be verified." }).waitFor();
  await page.getByRole("button", { name: "Profile menu" }).press("Enter");
  await page.getByRole("button", { name: "Sign out", exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Quick actions" }).count(), 0);
});

const cashAccount = {
  id: "50000000-0000-4000-8000-000000000010",
  name: "Everyday cash", openingDate: "2026-01-01", type: "bank", currency: "SGD",
  openingBalance: "1000.00", balance: "1000.00", earliestActivityDate: null,
};
const brokerageAccount = {
  ...cashAccount, id: "50000000-0000-4000-8000-000000000011", name: "Brokerage", type: "brokerage",
};

test("opens an account from the empty Accounts page and returns to the refreshed list on save", async (t) => {
  let attempts = 0;
  const page = await openWorkspace(t, {
    path: "/accounts",
    write: async (route, records) => {
      assert.equal(route.request().method(), "POST");
      const input = route.request().postDataJSON();
      assert.deepEqual(input, {
        name: "Everyday cash", type: "bank", currency: "SGD", openingDate: "2026-01-01", openingBalance: "1000.00",
      });
      if (++attempts === 1) return route.fulfill({ status: 503, json: { status: "unavailable" } });
      records.push(cashAccount);
      const { balance, earliestActivityDate, ...saved } = cashAccount;
      return route.fulfill({ status: 201, json: saved });
    },
  });

  await page.getByRole("button", { name: "Open your first financial account" }).click();
  const name = page.getByLabel("Account name");
  await name.and(page.locator(":focus")).waitFor();
  await name.fill("Everyday cash");
  await page.getByRole("textbox", { name: "Opening date" }).fill("2026-01-01");
  await page.getByLabel("Opening balance (SGD)").fill("1000.00");
  const submit = page.getByRole("button", { name: "Open account", exact: true });
  await submit.click();
  await page.getByRole("alert").filter({ hasText: "couldn’t confirm" }).waitFor();
  assert.equal(await name.inputValue(), "Everyday cash");
  await submit.click();
  await page.getByRole("status").filter({ hasText: "Everyday cash was opened." }).waitFor();
  await page.getByRole("rowheader", { name: /Everyday cash/ }).waitFor();
  assert.equal(new URL(page.url()).search, "");
});

test("keeps the desktop Overview in place while editing and saving a cash transfer in a dialog", async (t) => {
  const page = await openWorkspace(t, {
    viewport: { width: 1440, height: 900 },
    accounts: [cashAccount, brokerageAccount],
    write: async (route) => {
      const input = route.request().postDataJSON();
      assert.equal(new URL(route.request().url()).pathname, "/transfers");
      assert.equal(input.sourceAccountId, cashAccount.id);
      assert.equal(input.destinationAccountId, brokerageAccount.id);
      assert.equal(input.amount, "5.00");
      return route.fulfill({ status: 201, json: { ...input, id: "50000000-0000-4000-8000-000000000012" } });
    },
  });

  const overviewCard = page.locator("#overview-accounts-heading").locator("../..");
  const before = await overviewCard.boundingBox();
  const trigger = page.getByRole("button", { name: "Quick actions" });
  await trigger.press("Enter");
  await page.getByRole("button", { name: "Transfer cash", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Record a transfer" });
  const source = dialog.getByLabel("Source financial account");
  await source.and(page.locator(":focus")).waitFor();
  assert.equal((await overviewCard.boundingBox()).width, before.width);
  assert.ok((await dialog.boundingBox()).width < 1440);
  const close = dialog.getByRole("button", { name: "Close form" });
  await close.press("Shift+Tab");
  await dialog.getByRole("button", { name: "Record transfer", exact: true }).and(page.locator(":focus")).waitFor();
  await page.keyboard.press("Tab");
  await close.and(page.locator(":focus")).waitFor();

  await source.selectOption(cashAccount.id);
  await dialog.getByLabel("Destination financial account").selectOption(brokerageAccount.id);
  const amount = dialog.getByLabel("Amount (SGD)");
  await amount.fill("5.00");
  await page.keyboard.press("Escape");
  const confirm = page.getByRole("dialog", { name: "Discard unsaved changes?" });
  await confirm.getByRole("button", { name: "Keep editing" }).press("Enter");
  await amount.and(page.locator(":focus")).waitFor();
  assert.equal(await amount.inputValue(), "5.00");
  await close.click();
  await confirm.getByRole("button", { name: "Keep editing" }).waitFor();
  await page.keyboard.press("Escape");
  await close.and(page.locator(":focus")).waitFor();
  assert.equal(await amount.inputValue(), "5.00");
  await dialog.getByRole("button", { name: "Record transfer", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  await page.getByRole("status").filter({ hasText: "Transfer recorded." }).waitFor();
  await trigger.and(page.locator(":focus")).waitFor();
  assert.equal(new URL(page.url()).pathname, "/");
});

test("shows Quick action forms full-screen on mobile and protects edits during Back navigation", async (t) => {
  const page = await openWorkspace(t, {
    viewport: { width: 390, height: 844 }, accounts: [cashAccount, brokerageAccount],
  });
  await page.getByRole("link", { name: "Manage accounts" }).click();
  await page.getByRole("heading", { name: "Accounts", exact: true }).waitFor();
  const trigger = page.getByRole("button", { name: "Quick actions" });
  await trigger.press("Enter");
  await page.getByRole("button", { name: "Record a transaction", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Record a transaction" });
  await dialog.waitFor();
  assert.deepEqual(await dialog.boundingBox(), { x: 0, y: 0, width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390);
  const amount = dialog.getByLabel("Amount (SGD)");
  await amount.fill("3.00");
  await page.evaluate(() => history.back());
  const confirm = page.getByRole("dialog", { name: "Discard unsaved changes?" });
  await confirm.getByRole("button", { name: "Keep editing" }).click();
  assert.equal(await amount.inputValue(), "3.00");
  assert.equal(new URL(page.url()).pathname, "/accounts");
  await page.evaluate(() => history.back());
  await confirm.getByRole("button", { name: "Discard changes" }).click();
  await page.getByRole("heading", { name: "Overview", exact: true }).waitFor();
  await dialog.waitFor({ state: "hidden" });
});

test("records a transaction from Accounts and preserves the active destination", async (t) => {
  const page = await openWorkspace(t, {
    path: "/accounts", accounts: [cashAccount],
    write: async (route) => {
      const input = route.request().postDataJSON();
      assert.equal(new URL(route.request().url()).pathname, "/transactions");
      assert.equal(input.accountId, cashAccount.id);
      return route.fulfill({ status: 201, json: {
        ...input, id: "50000000-0000-4000-8000-000000000013", description: null,
      } });
    },
  });
  await page.getByRole("button", { name: "Quick actions" }).press("Enter");
  assert.equal(await page.getByRole("button", { name: "Transfer cash" }).count(), 0);
  assert.equal(await page.getByRole("button", { name: "Record an ETF trade" }).count(), 0);
  await page.getByRole("button", { name: "Record a transaction" }).click();
  const dialog = page.getByRole("dialog", { name: "Record a transaction" });
  await dialog.getByRole("button", { name: "Record transaction", exact: true }).click();
  await dialog.getByLabel("Amount (SGD)").and(page.locator(":focus")).waitFor();
  await dialog.getByLabel("Amount (SGD)").fill("1.00");
  await dialog.getByRole("button", { name: "Record transaction", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "Transaction recorded." }).waitFor();
  assert.equal(new URL(page.url()).pathname, "/accounts");
});

test("records an ETF trade without leaving Overview and links to the saved account's holdings", async (t) => {
  const page = await openWorkspace(t, {
    accounts: [brokerageAccount],
    write: async (route) => {
      const input = route.request().postDataJSON();
      assert.equal(new URL(route.request().url()).pathname, "/etf-trades");
      assert.equal(input.accountId, brokerageAccount.id);
      return route.fulfill({ status: 201, json: {
        ...input, id: "50000000-0000-4000-8000-000000000014",
        fee: "0.00", grossAmount: "20.00", cashMovement: "-20.00", realisedPnl: null,
        canChangeFinancialDetails: true,
      } });
    },
  });
  await page.getByRole("button", { name: "Quick actions" }).press("Enter");
  await page.getByRole("button", { name: "Record an ETF trade" }).click();
  const dialog = page.getByRole("dialog", { name: "Record an ETF trade" });
  await dialog.getByLabel("ETF ticker").fill("EXAMPLE");
  await dialog.getByLabel("Quantity").fill("2");
  await dialog.getByLabel("Execution price per unit (SGD)").fill("10.00");
  await dialog.getByRole("button", { name: "Record trade", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "EXAMPLE buy recorded." }).waitFor();
  assert.equal(new URL(page.url()).pathname, "/");
  await page.getByRole("link", { name: "View brokerage holdings" }).click();
  await page.getByRole("heading", { name: "Brokerage holdings", exact: true }).waitFor();
  assert.equal(new URL(page.url()).searchParams.get("holdings"), brokerageAccount.id);
});

test("edits and deletes eligible accounts on the Accounts destination", async (t) => {
  const linked = { ...brokerageAccount, earliestActivityDate: "2026-06-01" };
  const page = await openWorkspace(t, {
    path: "/accounts", accounts: [cashAccount, linked],
    write: async (route, records) => {
      assert.equal(new URL(route.request().url()).pathname, `/financial-accounts/${cashAccount.id}`);
      if (route.request().method() === "PATCH") {
        const input = route.request().postDataJSON();
        records[0] = { ...records[0], ...input };
        const { balance, earliestActivityDate, ...saved } = records[0];
        return route.fulfill({ status: 200, json: saved });
      }
      assert.equal(route.request().method(), "DELETE");
      records.shift();
      return route.fulfill({ status: 204 });
    },
  });

  await page.getByRole("button", { name: "Edit Brokerage" }).click();
  assert.equal(await page.getByRole("button", { name: "Delete Brokerage" }).isDisabled(), true);
  await page.getByRole("textbox", { name: "Opening date" }).fill("2026-06-02");
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.getByText(/earliest recorded entry/).waitFor();
  await page.getByRole("button", { name: "Cancel" }).click();

  await page.getByRole("button", { name: "Edit Everyday cash" }).click();
  await page.getByLabel("Account name").fill("Emergency cash");
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.getByRole("status").filter({ hasText: "Emergency cash was updated." }).waitFor();
  const remove = page.getByRole("button", { name: "Delete Emergency cash" });
  await remove.click();
  const confirmation = page.getByRole("dialog", { name: "Delete Emergency cash?" });
  await confirmation.getByRole("button", { name: "Cancel" }).click();
  await remove.and(page.locator(":focus")).waitFor();
  await remove.click();
  await confirmation.getByRole("button", { name: "Delete account", exact: true }).click();
  await remove.waitFor({ state: "detached" });
  await page.getByRole("rowheader", { name: /Brokerage/ }).waitFor();
});
