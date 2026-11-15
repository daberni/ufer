import { registerHooks } from "node:module";

/** Lets tests render components that import CSS Modules: every class name resolves to its own key. */
export function stubCssModules() {
  registerHooks({
    load(url, context, nextLoad) {
      if (!url.endsWith(".css")) {
        return nextLoad(url, context);
      }

      return {
        format: "commonjs",
        shortCircuit: true,
        source: "module.exports = new Proxy({}, { get: (_, key) => key === '__esModule' ? false : String(key) });"
      };
    }
  });
}
