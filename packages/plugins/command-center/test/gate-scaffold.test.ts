import { describe, it, expect } from "vitest";
import { generateGateScaffold, scaffoldFileMap, summarizeScaffold, REQUIRED_GATE_PATHS } from "../src/qa/gate-scaffold";

describe("QA gate scaffold generator", () => {
  it("emits the required gate + advisory + CI files", () => {
    const paths = generateGateScaffold().map((f) => f.path);
    for (const p of REQUIRED_GATE_PATHS) expect(paths).toContain(p);
    expect(paths).toContain("e2e/advisory/example.midscene.spec.ts");
    expect(paths).toContain(".github/workflows/qa-gate.yml");
  });

  it("labels the deterministic files required and the Midscene file advisory", () => {
    const files = generateGateScaffold();
    const byPath = new Map(files.map((f) => [f.path, f.lane]));
    expect(byPath.get("e2e/example.spec.ts")).toBe("required");
    expect(byPath.get("e2e/advisory/example.midscene.spec.ts")).toBe("advisory");
    expect(byPath.get(".github/workflows/qa-gate.yml")).toBe("ci");
  });

  it("wires Clerk's first-party testing helpers in the auth setup", () => {
    const map = scaffoldFileMap({ protectedPath: "/app" });
    expect(map["e2e/global-setup.ts"]).toContain("clerkSetup");
    expect(map["e2e/auth.setup.ts"]).toContain("setupClerkTestingToken");
    expect(map["e2e/auth.setup.ts"]).toContain("clerk.signIn");
    expect(map["e2e/auth.setup.ts"]).toContain('page.goto("/app")');
  });

  it("configures deterministic visual regression in the playwright config", () => {
    const cfg = scaffoldFileMap()["playwright.config.ts"];
    expect(cfg).toContain("toHaveScreenshot");
    expect(cfg).toContain("storageState");
    expect(cfg).toContain("globalSetup");
  });

  it("gates on the deterministic job and runs the AI lane allow-fail on your own model", () => {
    const yml = scaffoldFileMap({ advisoryModel: "uitars-7b" })[".github/workflows/qa-gate.yml"];
    expect(yml).toMatch(/^\s*gate:/m); // the required blocking job
    expect(yml).toContain("continue-on-error: true"); // the advisory job
    expect(yml).toContain("e2e/advisory");
    expect(yml).toContain("MIDSCENE_MODEL_NAME: uitars-7b");
    expect(yml).toContain("CLERK_SECRET_KEY"); // gate secret
    expect(yml).toContain("OPENAI_BASE_URL"); // BYO-model endpoint for the advisory lane
    expect(yml).toContain("${{ secrets.CLERK_SECRET_KEY }}"); // GH Actions interpolation preserved literally
  });

  it("the advisory spec uses Midscene's Playwright fixture", () => {
    expect(scaffoldFileMap()["e2e/advisory/example.midscene.spec.ts"]).toContain("@midscene/web/playwright");
  });

  it("never reaches for the dead/rejected visual tools", () => {
    const all = generateGateScaffold().map((f) => f.contents).join("\n").toLowerCase();
    for (const dead of ["lost-pixel", "lost pixel", "meticulous", "octomind"]) {
      expect(all).not.toContain(dead);
    }
  });

  it("summarizes what it installs", () => {
    expect(summarizeScaffold()).toMatch(/4 required.*1 advisory.*1 CI/);
  });
});
