import { afterAll, afterEach } from "vite-plus/test";
import { commands } from "vite-plus/test/browser/context";

const startAddress = location.href;

afterEach(() => {
  if (location.href !== startAddress) history.replaceState(history.state, "", startAddress);
});

afterAll(async () => {
  const exits = localStorage.getItem("tinker.exits");
  if (exits) await commands.writeFile(`.tinker/exits/${crypto.randomUUID()}.json`, exits);
});
