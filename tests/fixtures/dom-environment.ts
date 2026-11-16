import { after } from "node:test";
import { JSDOM } from "jsdom";

// React DOM decides when it is first imported whether it runs in a browser that supports input events, and test files import it before browser()
// creates their document. A test that types into fields imports this module first; each test still gets its own document from browser().
const { window } = new JSDOM("<!doctype html><html><body></body></html>");

Object.assign(globalThis, {
  window,
  document: window.document
});

after(() => window.close());
