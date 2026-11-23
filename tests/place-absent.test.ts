import { createScope } from "@tinkered/core";
import { expect, test } from "vite-plus/test";

import { placeNow, placeOpen, placeSearch } from "~/components/place";

import { placePageOpened, placeTags } from "./support/place";

test("a URL that names no place is not given one", async () => {
  const project = await placePageOpened(["/p/shop/?story=a&find=p2"]);
  const location = project.history.location;

  const raw: Record<string, unknown> = Object.fromEntries(new URLSearchParams(location.search));
  const again = project.router.buildLocation({
    to: location.pathname,
    search: { ...raw, ...placeSearch.parse(raw) },
  });

  expect(again.publicHref).not.toContain("place=");
  expect(new URL(again.publicHref, "http://localhost").searchParams.get("story")).toBe("a");

  const root = createScope({});
  const page = root.createSession({ tags: placeTags(project.router, project.history) });

  page.resolve(placeOpen);
  expect(page.resolve(placeNow)).toBeNull();
  expect(project.history.location.search).toBe("?story=a&find=p2");

  await page.close();
  await root.close();
  await project.close();
});

test("a place the address cannot name is no place, not a default", async () => {
  const project = await placePageOpened(["/p/shop/?place="]);
  const root = createScope({});
  const page = root.createSession({ tags: placeTags(project.router, project.history) });

  page.resolve(placeOpen);
  expect(page.resolve(placeNow)).toBeNull();
  expect(placeSearch.parse({ place: "" })).toEqual({ place: undefined });

  await page.close();
  await root.close();
  await project.close();
});
