/**
 * QA gate scaffold generator.
 *
 * Emits the canonical files that make a target repo's QA gate real — the same
 * two-lane design the `qa-verify-gate` skill describes, as a path -> contents map
 * the QA agent (or a human) can drop straight into a Next.js + Clerk repo:
 *
 *   REQUIRED (deterministic, blocks merge): Playwright + @clerk/testing + toHaveScreenshot
 *   ADVISORY (allow-fail, informs):         Midscene on a self-hosted / BYO vision model
 *
 * This is the concrete artifact behind the skill — the gate isn't just documented,
 * it's generatable and testable. Pure data: no Paperclip / fs imports, so the run
 * stays host-agnostic and the scaffold is unit-tested.
 */

export interface GateScaffoldOptions {
  /** App name, used in a comment. Default "the app". */
  app?: string;
  /** A protected route to smoke after login. Default "/dashboard". */
  protectedPath?: string;
  /** Self-hosted / BYO vision model for the advisory lane. Default "qwen2.5-vl-72b". */
  advisoryModel?: string;
}

export type GateLane = "required" | "advisory" | "ci";

export interface ScaffoldFile {
  path: string;
  lane: GateLane;
  contents: string;
}

/** Paths in the REQUIRED (blocking) lane — the deterministic gate proper. */
export const REQUIRED_GATE_PATHS = [
  "playwright.config.ts",
  "e2e/global-setup.ts",
  "e2e/auth.setup.ts",
  "e2e/example.spec.ts",
] as const;

export function generateGateScaffold(opts: GateScaffoldOptions = {}): ScaffoldFile[] {
  const app = opts.app ?? "the app";
  const route = opts.protectedPath ?? "/dashboard";
  const model = opts.advisoryModel ?? "qwen2.5-vl-72b";
  return [
    { path: "playwright.config.ts", lane: "required", contents: playwrightConfig() },
    { path: "e2e/global-setup.ts", lane: "required", contents: globalSetup() },
    { path: "e2e/auth.setup.ts", lane: "required", contents: authSetup(route) },
    { path: "e2e/example.spec.ts", lane: "required", contents: exampleSpec(app) },
    { path: "e2e/advisory/example.midscene.spec.ts", lane: "advisory", contents: advisorySpec() },
    { path: ".github/workflows/qa-gate.yml", lane: "ci", contents: ciWorkflow(model) },
  ];
}

/** The scaffold as a flat path -> contents map (what a writer/host would emit). */
export function scaffoldFileMap(opts: GateScaffoldOptions = {}): Record<string, string> {
  return Object.fromEntries(generateGateScaffold(opts).map((f) => [f.path, f.contents]));
}

/** One-line human summary of what the scaffold installs. */
export function summarizeScaffold(opts: GateScaffoldOptions = {}): string {
  const files = generateGateScaffold(opts);
  const req = files.filter((f) => f.lane === "required").length;
  return `Gate scaffold: ${req} required (Playwright + @clerk/testing + toHaveScreenshot, blocks merge), 1 advisory (Midscene, allow-fail), 1 CI workflow.`;
}

// --- file templates (returned as strings; never compiled here) --------------

function playwrightConfig(): string {
  return `import { defineConfig, devices } from "@playwright/test";

// REQUIRED gate: deterministic, runs against the preview deploy, auth via @clerk/testing.
export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  use: { baseURL: process.env.PREVIEW_URL, trace: "on-first-retry" },
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.01 } },
  projects: [
    { name: "auth", testMatch: /auth\\.setup\\.ts/ },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], storageState: "e2e/.auth/user.json" },
      dependencies: ["auth"],
      testIgnore: /advisory\\//,
    },
  ],
});
`;
}

function globalSetup(): string {
  return `import { clerkSetup } from "@clerk/testing/playwright";

// Fetch a Clerk Testing Token (needs CLERK_PUBLISHABLE_KEY + CLERK_SECRET_KEY).
// This is the only clean way past Clerk's bot detection in CI.
export default async function globalSetup() {
  await clerkSetup();
}
`;
}

function authSetup(route: string): string {
  return `import { clerk, setupClerkTestingToken } from "@clerk/testing/playwright";
import { test as setup, expect } from "@playwright/test";

// Sign in once via Clerk's first-party testing helpers, then reuse the state.
setup("authenticate", async ({ page }) => {
  await setupClerkTestingToken({ page });
  await page.goto("/");
  await clerk.signIn({
    page,
    signInParams: {
      strategy: "password",
      identifier: process.env.E2E_CLERK_USER_EMAIL!,
      password: process.env.E2E_CLERK_USER_PASSWORD!,
    },
  });
  await page.goto("${route}");
  // Logged-in smoke: the protected route renders (not bounced to sign-in).
  await expect(page).not.toHaveURL(/sign-in/i);
  await page.context().storageState({ path: "e2e/.auth/user.json" });
});
`;
}

function exampleSpec(app: string): string {
  return `import { test, expect } from "@playwright/test";

// REQUIRED gate sample. Map EVERY acceptance criterion to an executed assertion.
// Replace these with the real criteria for: ${app}.
test("pricing: three tiers render and the CTA works", async ({ page }) => {
  await page.goto("/pricing");
  await expect(page.getByRole("article", { name: /tier/i })).toHaveCount(3); // criterion 1
  await page.getByRole("link", { name: /get started/i }).first().click();
  await expect(page).toHaveURL(/checkout/); // criterion 2
  await expect(page).toHaveScreenshot("pricing.png"); // visual regression
});
`;
}

function advisorySpec(): string {
  return `import { test as base } from "@playwright/test";
import { PlaywrightAiFixture } from "@midscene/web/playwright";

// ADVISORY lane: natural-language assertions on a self-hosted / BYO vision model.
// Runs allow-fail in CI (see qa-gate.yml) — it informs, it never blocks a merge.
// Point OPENAI_BASE_URL + MIDSCENE_MODEL_NAME at your own model (e.g. Proxmox Qwen-VL).
export const test = base.extend(PlaywrightAiFixture());

test("advisory: pricing reads clearly", async ({ page, aiAssert }) => {
  await page.goto("/pricing");
  await aiAssert("the page shows three clearly-priced plans and an obvious primary call to action");
});
`;
}

function ciWorkflow(model: string): string {
  return `name: qa-gate
on: [pull_request]
jobs:
  gate: # REQUIRED — blocks merge
    runs-on: ubuntu-latest
    env:
      PREVIEW_URL: \${{ needs.deploy.outputs.preview_url }}
      CLERK_PUBLISHABLE_KEY: \${{ secrets.CLERK_PUBLISHABLE_KEY }}
      CLERK_SECRET_KEY: \${{ secrets.CLERK_SECRET_KEY }}
      E2E_CLERK_USER_EMAIL: \${{ secrets.E2E_CLERK_USER_EMAIL }}
      E2E_CLERK_USER_PASSWORD: \${{ secrets.E2E_CLERK_USER_PASSWORD }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci && npx playwright install --with-deps chromium
      - run: npx playwright test
  advisory: # NON-BLOCKING — Midscene AI lane on your own model
    runs-on: ubuntu-latest
    continue-on-error: true
    env:
      PREVIEW_URL: \${{ needs.deploy.outputs.preview_url }}
      OPENAI_BASE_URL: \${{ secrets.SELFHOSTED_VLM_URL }}
      MIDSCENE_MODEL_NAME: ${model}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci && npx playwright install --with-deps chromium
      - run: npx playwright test e2e/advisory
`;
}
