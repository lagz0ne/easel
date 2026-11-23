import { createScope } from "@tinkered/core";
import { makeTestClock } from "@tinkered/core/testing";
import { expect, test } from "vite-plus/test";

import {
  placeAddress,
  placeGo,
  placeHistory,
  placeLeaving,
  placeLeave,
  placeNow,
  placeOpen,
  placeRouter,
  placeStack,
  type PlaceAddress,
} from "~/components/place";

import { placeFlush, placePageOpened, placePageReloaded, placeTags } from "./support/place";

test("B4: a reload reads the stack from the entry's state, so Back keeps working and walks no dead entry", async () => {
  const project = await placePageOpened();
  const root = createScope({});
  const before = root.createSession({ tags: placeTags(project.router, project.history) });

  before.resolve(placeOpen);
  before.resolve(placeHistory);
  await before.run(placeGo, { input: "notice" });
  await before.run(placeGo, { input: "checks" });
  expect(before.resolve(placeStack)).toEqual(["notice", "checks"]);
  expect(project.history.location.state).toMatchObject({ places: ["notice", "checks"] });
  await before.close();
  await project.close();

  const reloaded = await placePageReloaded(project.history);
  const after = root.createSession({ tags: placeTags(reloaded.router, project.history) });

  after.resolve(placeOpen);
  after.resolve(placeHistory);
  expect(after.resolve(placeNow)).toBe("checks");
  expect(after.resolve(placeStack)).toEqual(["notice", "checks"]);

  project.history.go(-1);
  await placeFlush();
  expect(after.resolve(placeNow)).toBe("notice");
  expect(after.resolve(placeStack)).toEqual(["notice"]);

  await after.close();
  await root.close();
  await reloaded.close();
});

test("B4: a leave whose move never comes gives up after 600 ms, so the next real Back is not eaten", async () => {
  const clock = makeTestClock();
  const project = await placePageOpened();
  const root = createScope({ clock });

  const dropped: PlaceAddress = {
    get location() {
      return project.history.location;
    },
    replace: (path, state) => project.history.replace(path, state),
    go: () => undefined,
    subscribe: (moved) => project.history.subscribe(moved),
  };

  const page = root.createSession({
    tags: [placeRouter(project.router), placeAddress(dropped)],
  });

  page.resolve(placeOpen);
  page.resolve(placeHistory);
  await page.run(placeGo, { input: "notice" });
  await page.run(placeGo, { input: "checks" });

  const leaving = page.run(placeLeave);

  await placeFlush();
  expect(page.resolve(placeLeaving)).toBe(true);

  clock.advance(600);
  await Promise.race([leaving, new Promise((resolve) => setTimeout(resolve, 100))]);
  await placeFlush();
  expect(page.resolve(placeLeaving)).toBe(false);

  project.history.go(-1);
  await placeFlush();
  expect(page.resolve(placeNow)).toBe("notice");
  expect(page.resolve(placeStack)).toEqual(["notice"]);

  await page.close();
  await root.close();
  await project.close();
});
