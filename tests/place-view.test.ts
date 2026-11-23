import { createScope } from "@tinkered/core";
import { expect, test } from "vite-plus/test";

import {
  placeGo,
  placeHistory,
  placeLeave,
  placeNow,
  placeOpen,
  placeSetView,
  placeStack,
} from "~/components/place";

import { placeFlush, placePageOpened, placeTags } from "./support/place";

test("B6: an outside set view moves the place without an entry or a screen of its own", async () => {
  const project = await placePageOpened();
  const root = createScope({});
  const page = root.createSession({ tags: placeTags(project.router, project.history) });

  page.resolve(placeOpen);
  page.resolve(placeHistory);
  await page.run(placeGo, { input: "list" });
  expect(project.history.length).toBe(2);
  expect(page.resolve(placeStack)).toEqual(["list"]);

  await page.run(placeSetView, { input: "detail" });
  expect(project.history.location.search).toBe("?place=detail");
  expect(project.history.length).toBe(2);
  expect(page.resolve(placeNow)).toBe("detail");
  expect(page.resolve(placeStack)).toEqual(["list"]);

  await page.run(placeLeave);
  await placeFlush();
  expect(page.resolve(placeNow)).toBeNull();
  expect(page.resolve(placeStack)).toEqual([]);
  expect(project.history.location.search).toBe("");

  await page.close();
  await root.close();
  await project.close();
});

test("B6: a set view for the place the page already shows moves nothing", async () => {
  const project = await placePageOpened();
  const root = createScope({});
  const page = root.createSession({ tags: placeTags(project.router, project.history) });

  page.resolve(placeOpen);
  page.resolve(placeHistory);
  await page.run(placeGo, { input: "list" });
  const length = project.history.length;

  await page.run(placeSetView, { input: "list" });
  expect(project.history.length).toBe(length);
  expect(page.resolve(placeNow)).toBe("list");
  expect(page.resolve(placeStack)).toEqual(["list"]);

  await page.close();
  await root.close();
  await project.close();
});
