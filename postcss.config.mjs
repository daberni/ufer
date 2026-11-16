import postcssGlobalData from "@csstools/postcss-global-data";
import postcssCustomMedia from "postcss-custom-media";

// postcss-custom-media leaves an undefined name in place, where it would silently never match.
const rejectUnknownCustomMedia = {
  postcssPlugin: "reject-unknown-custom-media",
  OnceExit(root) {
    root.walkAtRules(/^(media|custom-media)$/i, rule => {
      if (rule.name.toLowerCase() === "custom-media" || /\(\s*--/.test(rule.params)) {
        throw rule.error(`Unknown custom media in "@${rule.name} ${rule.params}". Define breakpoints in src/styles/media.css.`);
      }
    });
  }
};

export default {
  plugins: [
    postcssGlobalData({
      // Resolved from the project root; Next.js bundles this file, so import.meta.dirname is unavailable.
      files: ["src/styles/media.css"]
    }),
    postcssCustomMedia(),
    rejectUnknownCustomMedia
  ]
};
