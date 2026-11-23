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

async function openWorkspace(t, { viewport, signedIn = true, accountsStatus = 200, accounts = [] } = {}) {
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
    if (path === "/financial-accounts" && accountsStatus === 200) {
      return route.fulfill({ json: {
        accounts,
        summary: {
          currency: "SGD", balance: accounts[0]?.balance ?? "0.00",
          income: "0.00", expenses: "0.00", netCashflow: "0.00",
          from: "2026-06-01", to: "2026-06-30",
        },
      } });
    }
    if (path === "/financial-accounts") return route.fulfill({ status: accountsStatus, json: {} });
    if (accounts.some(({ id }) => path === `/financial-accounts/${id}/holdings`)) {
      return route.fulfill({ json: { holdings: [], trades: [] } });
    }
    if (path === "/portfolio") {
      return route.fulfill({ json: {
        currency: "SGD", knownSubtotal: accounts[0]?.balance ?? "0.00",
        valuation: "complete", unpricedHoldings: 0,
      } });
    }
    return route.abort();
  });
  await page.goto(address);
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
  await drawer.getByRole("link", { name: "Overview" }).and(page.locator(":focus")).waitFor();
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

test("opens the existing account workflow from Quick actions and returns to the trigger", async (t) => {
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
  const chooseDate = form.getByRole("button", { name: "Choose date" });
  await chooseDate.press("Enter");
  const calendar = form.getByRole("dialog", { name: "Choose opening date" });
  await calendar.getByRole("button", { name: /^Today,/ }).waitFor();
  await page.keyboard.press("Escape");
  await calendar.waitFor({ state: "hidden" });
  await chooseDate.and(page.locator(":focus")).waitFor();
  await form.getByRole("button", { name: "Cancel" }).press("Enter");
  await form.waitFor({ state: "hidden" });
  await quickActions.and(page.locator(":focus")).waitFor();
});

test("keeps account names, exact balances and row actions available across viewport sizes", async (t) => {
  const name = `Long financial account ${"X".repeat(76)}`;
  const page = await openWorkspace(t, {
    viewport: { width: 1440, height: 900 },
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
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
  }
});

test("opens and closes holdings for a long brokerage account name with the keyboard without overflowing", async (t) => {
  const name = "W".repeat(100);
  const page = await openWorkspace(t, {
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
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width, `Page width at ${width}px`);
    await page.keyboard.press("Tab");
    await close.and(page.locator(":focus")).waitFor();
    await page.keyboard.press("Enter");
    await heading.waitFor({ state: "hidden" });
    await open.and(page.locator(":focus")).waitFor();
  }
});

test("shows the Google sign-in screen to a signed-out visitor", async (t) => {
  const page = await openWorkspace(t, { signedIn: false });
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
