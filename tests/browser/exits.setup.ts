import { afterAll } from "vite-plus/test";
import { commands } from "vite-plus/test/browser/context";

afterAll(async () => {
  const exits = localStorage.getItem("tinker.exits");
  if (exits) await commands.writeFile(`.tinker/exits/${crypto.randomUUID()}.json`, exits);
});
