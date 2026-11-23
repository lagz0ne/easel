import { createScope } from "@tinkered/core";
import { expect, test } from "vite-plus/test";

import { placeGo, placeHistory, placeNow, placeOpen, placeStack } from "~/components/place";

import { placePageOpened, placeTags } from "./support/place";

test("B2: a place change is the address's search param, so the page's loader is not run again", async () => {
  const project = await placePageOpened();
  const atOpen = project.loads();
  const root = createScope({});
  const page = root.createSession({ tags: placeTags(project.router, project.history) });

  page.resolve(placeOpen);
  page.resolve(placeHistory);
  expect(page.resolve(placeNow)).toBeNull();

  await page.run(placeGo, { input: "checks" });
  expect(project.history.location.search).toBe("?place=checks");
  expect(page.resolve(placeNow)).toBe("checks");
  expect(page.resolve(placeStack)).toEqual(["checks"]);
  expect(project.loads()).toBe(atOpen);

  expect(project.history.length).toBe(2);
  expect(project.history.location.state).toMatchObject({ places: ["checks"], __TSR_index: 1 });

  await page.run(placeGo, { input: "detail" });
  expect(project.history.location.search).toBe("?place=detail");
  expect(page.resolve(placeStack)).toEqual(["checks", "detail"]);
  expect(project.loads()).toBe(atOpen);

  const length = project.history.length;

  await page.run(placeGo, { input: "detail" });
  expect(project.history.length).toBe(length);
  expect(project.loads()).toBe(atOpen);

  await page.close();
  await root.close();
  await project.close();
});
