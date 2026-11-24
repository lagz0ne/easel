import {
  createRootRouteWithContext,
  createRoute,
  Outlet,
  useLocation,
} from "@tanstack/react-router";
import type { Scope } from "@tinkered/core";

import { baseVersion } from "~/components/health";

import { HomePage, OpenPage } from "@/home/home";
import { readHome, readSignInLink } from "@/home/signin";
import { Board, IssuesHome, Thread } from "@/issues/board";
import { TodoList } from "@/todo/todo-list";
import { Canvas } from "@/viewer/canvas";
import { openPage } from "@/viewer/gate";
import { Opening, Viewer } from "@/viewer/viewer";
import { readTextsPage } from "@/words/page-data";
import { TextsPage } from "@/words/texts";

const root = createRootRouteWithContext<{ scope: Scope.Handle }>()({ component: Outlet });

const index = createRoute({
  getParentRoute: () => root,
  path: "/",
  loader: ({ context, abortController }) =>
    context.scope.run(readHome, { input: { stop: abortController.signal } }),
  component: () => <HomePage {...index.useLoaderData()} />,
});

const open = createRoute({
  getParentRoute: () => root,
  path: "/open",
  loader: ({ context, abortController }) =>
    context.scope.run(readSignInLink, { input: { stop: abortController.signal } }),
  component: () => <OpenPage link={open.useLoaderData()} />,
});

const canvas = createRoute({
  getParentRoute: () => root,
  path: "/c/$canvas",
  loader: ({ context, abortController }) =>
    context.scope.run(readHome, { input: { stop: abortController.signal } }),
  pendingComponent: Opening,
  pendingMs: 0,
  component: () => {
    const { who, site } = canvas.useLoaderData();
    const key = canvas.useParams().canvas;
    const aim = useLocation({ select: (at) => at.hash });
    return who.kind === "in" ? (
      <Canvas
        canvas={key}
        opening={<Opening />}
        me={{ name: who.name, owner: who.owner }}
        aim={aim}
      />
    ) : (
      <HomePage who={who} site={site} />
    );
  },
});

const texts = createRoute({
  getParentRoute: () => root,
  path: "/texts",
  loader: ({ context, abortController }) =>
    context.scope.run(readTextsPage, { input: { stop: abortController.signal } }),
  component: () => <TextsPage {...texts.useLoaderData()} />,
});

const todo = createRoute({ getParentRoute: () => root, path: "/todo", component: TodoList });

const issues = createRoute({ getParentRoute: () => root, path: "/issues", component: IssuesHome });

const team = createRoute({
  getParentRoute: () => root,
  path: "/issues/$team",
  component: () => (
    <>
      <Board teamId={team.useParams().team} />
      <Outlet />
    </>
  ),
});

const thread = createRoute({
  getParentRoute: () => team,
  path: "$id",
  component: () => <Thread teamId={team.useParams().team} issueId={thread.useParams().id} />,
});

const share = createRoute({
  getParentRoute: () => root,
  path: "/s/$link",
  loader: ({ context, params, abortController }) =>
    context.scope.run(openPage, { input: { link: params.link, stop: abortController.signal } }),
  pendingComponent: Opening,
  pendingMs: 0,
  component: () => <Viewer link={share.useParams().link} />,
});

const tinker = createRoute({
  getParentRoute: () => root,
  path: "/tinker",
  component: () => (
    <main>
      <h1>Tinker base</h1>
      <p>tinker-app {baseVersion}</p>
    </main>
  ),
});

export const routeTree = root.addChildren([
  index,
  open,
  canvas,
  texts,
  todo,
  issues,
  team.addChildren([thread]),
  share,
  tinker,
]);
