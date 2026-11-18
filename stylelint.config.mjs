export default {
  extends: ["stylelint-config-recommended"],
  plugins: ["stylelint-declaration-strict-value"],
  rules: {
    "declaration-no-important": true,
    // Module-local state selectors intentionally override base rules; DOM nesting is not inferred by this heuristic.
    "no-descending-specificity": null,
    "property-no-unknown": [true, {
      ignoreProperties: ["composes"]
    }],
    "at-rule-no-unknown": [true, {
      ignoreAtRules: ["value"]
    }],
    "selector-pseudo-class-no-unknown": [true, {
      ignorePseudoClasses: ["global", "local", "export", "import"]
    }],
    "scale-unlimited/declaration-strict-value": [["font-size", "border-radius", "color", "background-color", "font-weight"], {
      ignoreValues: {
        "": ["inherit", "initial", "unset", "transparent", "currentcolor", "currentColor", "0", "50%"],
        "font-weight": ["400", "500", "600", "700"]
      },
      disableFix: true
    }]
  },
  overrides: [{
    files: ["src/app/globals.css"],
    rules: {
      "scale-unlimited/declaration-strict-value": null
    }
  }]
};
