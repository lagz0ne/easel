import { createRootRouteWithContext, createRoute, Outlet } from "@tanstack/react-router";
import type { Scope } from "@tinkered/core";

import { baseVersion } from "~/components/health";

import { greet } from "@/greet";
import { Greeting } from "@/greet/greeting";
import { Board, IssuesHome, Thread } from "@/issues/board";
import { TodoList } from "@/todo/todo-list";
import { openPage } from "@/viewer/gate";
import { Opening, Viewer } from "@/viewer/viewer";

const root = createRootRouteWithContext<{ scope: Scope.Handle }>()({ component: Outlet });

const index = createRoute({
  getParentRoute: () => root,
  path: "/",
  loader: ({ context, abortController }) =>
    context.scope.run(greet.api.greet, {
      input: { name: "world" },
      signal: abortController.signal,
    }),
  component: () => <Greeting text={index.useLoaderData().text} />,
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
  todo,
  issues,
  team.addChildren([thread]),
  share,
  tinker,
]);
