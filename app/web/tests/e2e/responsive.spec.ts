import { expect, test } from "@playwright/test";

const pointerEventFor = (
  bounds: { x: number; y: number; width: number; height: number },
  overrides: Record<string, number> = {},
) => ({
  clientX: bounds.x + bounds.width / 2,
  clientY: bounds.y + bounds.height / 2,
  pointerId: 7,
  pointerType: "touch",
  isPrimary: true,
  button: 0,
  buttons: 1,
  pressure: 0.5,
  bubbles: true,
  cancelable: true,
  composed: true,
  ...overrides,
});

test.beforeEach(async ({ page }) => {
  await page.goto("/?demo=1");
  await expect(page.getByRole("heading", { name: "Library" })).toBeVisible();
});

test("adapts navigation to the current resolution", async ({
  page,
}, testInfo) => {
  if (testInfo.project.name === "desktop") {
    await expect(
      page.getByRole("navigation", { name: "Main navigation" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Open navigation" }),
    ).toBeHidden();
  } else {
    await expect(
      page.getByRole("navigation", { name: "Main navigation" }),
    ).toBeHidden();
    await expect(
      page.getByRole("button", { name: "Open navigation" }),
    ).toBeVisible();
  }
});

test("collapses the desktop sidebar into an animated icon rail", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop");
  const sidebar = page.locator("aside").first();
  const main = page.locator("main").first();
  await expect(sidebar.getByRole("button", { name: "Add title" })).toHaveCount(
    0,
  );

  const expandedMain = await main.boundingBox();
  await sidebar.getByRole("button", { name: "Collapse sidebar" }).click();
  await expect(sidebar).toHaveAttribute("data-collapsed", "true");
  await expect(
    sidebar.getByRole("button", { name: "Expand sidebar" }),
  ).toBeVisible();
  await expect(sidebar.getByRole("link", { name: "Library" })).toBeVisible();
  await expect(
    sidebar.getByRole("link", { name: /View Profile/ }),
  ).toBeVisible();

  await page.waitForTimeout(350);
  const collapsedMain = await main.boundingBox();
  expect(expandedMain).not.toBeNull();
  expect(collapsedMain).not.toBeNull();
  expect(collapsedMain!.x).toBeLessThan(expandedMain!.x);
});

test("opens filters as a viewport-safe dialog", async ({ page }) => {
  await page.getByRole("button", { name: /filters/i }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("heading", { name: "Filter library" }),
  ).toBeVisible();
  const bounds = await dialog.boundingBox();
  const viewport = page.viewportSize();
  expect(bounds).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport!.width);
  expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport!.height);
});

test("keeps the library view preference in Settings", async ({ page }) => {
  await page.goto("/settings?demo=1");
  await page.getByRole("button", { name: "Posters" }).click();
  await expect(page.getByRole("button", { name: "Posters" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByText("Grid scale", { exact: true })).toBeVisible();
});

test("switches the library view for the current session", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "mobile");
  await expect(page.getByTestId("library-list")).toBeVisible();
  await page.getByRole("button", { name: "Show poster view" }).click();
  await expect(page.getByTestId("poster-grid")).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("poster-grid")).toBeVisible();
});

test("keeps the add-title action within phone reach", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "mobile");
  const add = page.getByRole("button", { name: "Add title" });
  await expect(add).toBeVisible();
  const bounds = await add.boundingBox();
  const viewport = page.viewportSize();
  expect(bounds).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(bounds!.y + bounds!.height).toBeLessThan(viewport!.height);
  await add.click();
  await expect(page.getByRole("heading", { name: "Add a title" })).toBeVisible();
});

test("reorders a library section with touch pointer events", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "mobile");
  const firstHandle = page.getByRole("button", {
    name: "Drag Frieren: Beyond Journey’s End",
  });
  const secondHandle = page.getByRole("button", { name: "Drag Severance" });
  await expect(firstHandle).toHaveCSS("touch-action", "none");
  const firstBounds = await firstHandle.boundingBox();
  const secondBounds = await secondHandle.boundingBox();
  expect(firstBounds).not.toBeNull();
  expect(secondBounds).not.toBeNull();
  await firstHandle.dispatchEvent("pointerdown", pointerEventFor(firstBounds!));
  await page.locator("body").dispatchEvent(
    "pointermove",
    pointerEventFor(firstBounds!, {
      clientY:
        (firstBounds!.y + firstBounds!.height / 2 +
          secondBounds!.y + secondBounds!.height / 2) /
        2,
    }),
  );
  await page.locator("body").dispatchEvent("pointermove", pointerEventFor(secondBounds!));
  await page.locator("body").dispatchEvent(
    "pointerup",
    pointerEventFor(secondBounds!, { buttons: 0, pressure: 0 }),
  );

  const watching = page.locator('[data-pointer-sortable-group="watching"]');
  await expect(watching.locator("[data-pointer-sortable-item]").first()).toContainText(
    "Severance",
  );
});

test("walks through the password-reset state machine", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "mobile");
  await page.goto("/login?demo=1");
  await page.getByRole("button", { name: "Log in" }).click();
  await page.getByRole("button", { name: "Forgot password?" }).click();
  await page.getByLabel("Email or username").fill("viewer@example.com");
  await page.getByRole("button", { name: "Send reset code" }).click();
  await expect(page.getByRole("heading", { name: "Check your email." })).toBeVisible();
  await page.getByLabel("Verification code").fill("123456");
  await page.getByRole("button", { name: "Verify code" }).click();
  await expect(
    page.getByRole("heading", { name: "Choose a new password." }),
  ).toBeVisible();
  await page.getByLabel("New password", { exact: true }).fill("new-password");
  await page
    .getByLabel("Confirm new password", { exact: true })
    .fill("new-password");
  await page.getByRole("button", { name: "Update password" }).click();
  await expect(page.getByText("Password updated. Sign in with your new password.")).toBeVisible();
});

test("separates profile favorites into TV, anime, and movie shelves", async ({
  page,
}) => {
  await page.goto("/profile?demo=1");
  await expect(page.getByRole("heading", { name: "TV Shows" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Anime" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Movies" })).toBeVisible();
});

test("shows releases inside calendar days and summarizes overflow", async ({ page }) => {
  await page.goto("/calendar?demo=1");
  const busyDay = page.getByRole("button", { name: /8 releases/ });
  await expect(busyDay.getByText("Severance", { exact: true })).toBeVisible();
  await expect(busyDay.getByText(/^\+\d+ more$/)).toBeVisible();
});

test("opens library entries as detail pages and keeps editing in a dialog", async ({
  page,
}) => {
  await page.getByRole("link", { name: /Perfect Days/ }).click();
  await expect(page).toHaveURL(/\/item\/1/);
  await expect(page.getByRole("heading", { name: "Details" })).toBeVisible();
  await expect(page.getByText("Perfect Days", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Edit library entry" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Edit entry" })).toBeVisible();
});

test("opens tags as collection pages", async ({ page }) => {
  await page.goto("/tags?demo=1");
  await page.getByRole("link", { name: /Anime/ }).click();
  await expect(page).toHaveURL(/\/tags\/Anime/);
  await expect(page.getByRole("heading", { name: "Anime" })).toBeVisible();
  const row = page.getByRole("link", { name: /Frieren/ });
  await expect(row).toBeVisible();
  await expect(row.locator("img")).toHaveCount(0);
  await expect(row.getByText("9.1", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Move Frieren/ })).toHaveCount(
    0,
  );
});

test("expands episode metadata and keeps editing in the options dialog", async ({
  page,
}) => {
  await page.goto("/episodes?demo=1");
  const episodeRow = page.getByRole("button", {
    name: "View Frieren: Beyond Journey’s End, episode 18",
  });
  await expect(episodeRow.getByText("Frieren: Beyond Journey’s End", { exact: true })).toBeVisible();
  await expect(episodeRow.getByText("First-Class Mage Exam", { exact: true })).toBeVisible();
  await expect(episodeRow.getByText("EP 18", { exact: true })).toHaveCount(0);
  await expect(episodeRow.getByText("25 min", { exact: true })).toHaveCount(0);
  await expect(
    page.getByText(
      "The party reaches Äußerst and prepares for the first-class mage exam.",
    ),
  ).toBeVisible();

  await episodeRow.click();
  await expect(page.getByText("EP 18", { exact: true })).toBeVisible();
  await expect(page.getByText("25 min", { exact: true })).toBeVisible();
  await expect(
    page.getByText(
      "The party reaches Äußerst and prepares for the first-class mage exam.",
    ),
  ).toBeVisible();
  await expect(page.getByText("Aired 2024-01-12")).toBeVisible();

  await page.getByRole("tab", { name: "Favorites" }).click();
  await expect(page.getByLabel("Rated 10 out of 10")).toBeVisible();
  await page
    .getByRole("button", {
      name: "Frieren: Beyond Journey’s End episode 10 options",
    })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Your Rating", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Tags", { exact: true })).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Mark episode unwatched" }),
  ).toBeVisible();
  await expect(dialog.locator("img")).toHaveCount(0);
  await expect(dialog.getByText("A Powerful Mage")).toHaveCount(0);

  await page.goto("/item/2?demo=1");
  const detailEpisode = page.getByRole("button", {
    name: "View episode 10",
  });
  await expect(detailEpisode.getByText("EP 10", { exact: true })).toBeVisible();
  await expect(
    detailEpisode.getByText("25 min", { exact: true }),
  ).toBeVisible();
  await detailEpisode.click();
  await expect(page.getByText("Aired 2023-11-10")).toBeVisible();
});

test("keeps bottom-navigation destinations out of the mobile menu", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name === "desktop");
  await page.getByRole("button", { name: "Open navigation" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("link", { name: "Explore" })).toBeVisible();
  await expect(
    dialog.getByRole("link", { name: "View Profile" }),
  ).toBeVisible();
  await expect(dialog.getByRole("link", { name: "Episodes" })).toHaveCount(0);
  await expect(dialog.getByRole("link", { name: "Tags" })).toHaveCount(0);
});
