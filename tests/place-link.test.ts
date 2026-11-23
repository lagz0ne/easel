import { createScope } from "@tinkered/core";
import { expect, test } from "vite-plus/test";

import { placeClean, placeNow, placeOpen } from "~/components/place";

import { placePageOpened, placePageReloaded, placeTags } from "./support/place";

test("B3: a link's one-time params open the page once, then leave the address", async () => {
  const project = await placePageOpened(["/p/shop/?story=a&find=p2"]);
  const atOpen = project.loads();
  const length = project.history.length;
  const root = createScope({});
  const page = root.createSession({ tags: placeTags(project.router, project.history) });

  page.resolve(placeOpen);

  const link = new URLSearchParams(project.history.location.search);

  expect(page.resolve(placeNow)).toBeNull();
  expect(link.get("story")).toBe("a");
  expect(link.get("find")).toBe("p2");

  page.run(placeClean, { input: { names: ["story", "find"], place: "detail" } });
  expect(project.history.location.search).toBe("?place=detail");
  expect(page.resolve(placeNow)).toBe("detail");
  expect(project.history.length).toBe(length);
  expect(project.loads()).toBe(atOpen);

  page.run(placeClean, { input: { names: ["story", "find"], place: "detail" } });
  expect(project.history.location.search).toBe("?place=detail");
  await page.close();
  await project.close();

  const reloaded = await placePageReloaded(project.history);
  const again = root.createSession({ tags: placeTags(reloaded.router, project.history) });

  again.resolve(placeOpen);
  expect(again.resolve(placeNow)).toBe("detail");
  expect(new URLSearchParams(project.history.location.search).get("story")).toBeNull();

  await again.close();
  await root.close();
  await reloaded.close();
});
