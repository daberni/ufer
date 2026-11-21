import { fixupPluginRules } from "@eslint/compat";
import cssModules from "eslint-plugin-css-modules";
import babelParser from "@babel/eslint-parser";
import stylistic from "@stylistic/eslint-plugin";
import reactHooks from "eslint-plugin-react-hooks";
import next from "@next/eslint-plugin-next";
import boundaries from "eslint-plugin-boundaries";

const browserImports = {
  group: ["node:*", "@libsql/client", "drizzle-orm", "drizzle-orm/**", "**/server/**", "@/server/**", "@/lib/import"],
  message: "Browser features depend on contracts and the HTTP client, never server infrastructure."
};

// The dashboard composes routes and views from feature components; nothing outside its routes depends on it.
const dashboardImports = {
  group: ["@/features/dashboard", "@/features/dashboard/**", "**/dashboard", "**/dashboard/**"],
  message: "Only the dashboard routes import the dashboard; move shared code to the owning feature, src/client, src/components or src/lib."
};

// Server layers of #285: each layer may import the layers below it, never one above it, so feature server modules form no cycle.
const serverLayers = [
  ["banking", "imports", "demo", "reports"],
  ["transactions"],
  ["categorization"],
  ["accounts"]
];
const sharedServerElements = ["auth-server", "appearance-server", "legal-server"];

const featureServerElements = ["auth", "appearance", "legal", ...serverLayers.flat()].map(feature => ({
  type: `${feature}-server`,
  pattern: `src/features/${feature}/server`
}));

const layerPolicies = serverLayers.flatMap((layer, index) => layer.map(feature => ({
  from: {
    element: {
      type: `${feature}-server`
    }
  },
  allow: {
    to: {
      element: {
        types: [`${feature}-server`, ...serverLayers.slice(index + 1).flat().map(lower => `${lower}-server`), ...sharedServerElements, "server", "lib"]
      }
    }
  }
})));

export default [{
  ignores: [".claude/**", "node_modules/**", ".next/**", "data/**", "drizzle/meta/**", "next-env.d.ts"]
}, {
  files: ["**/*.{ts,tsx,mjs}"],
  languageOptions: {
    parser: babelParser,
    ecmaVersion: "latest",
    sourceType: "module",
    parserOptions: {
      requireConfigFile: false,
      babelOptions: {
        parserOpts: {
          plugins: ["typescript", "jsx"]
        }
      }
    }
  },
  plugins: {
    "@stylistic": stylistic
  },
  rules: {
    curly: ["error", "all"],
    "no-var": "error",
    "no-nested-ternary": "error",
    "prefer-const": "error",
    "@stylistic/brace-style": ["error", "1tbs", {
      allowSingleLine: false
    }],
    "@stylistic/max-statements-per-line": ["error", {
      max: 1
    }],
    "@stylistic/indent": ["error", 2, {
      SwitchCase: 1,
      jsx: 2
    }],
    "@stylistic/jsx-wrap-multilines": ["error", {
      declaration: "parens-new-line",
      assignment: "parens-new-line",
      return: "parens-new-line",
      arrow: "parens-new-line",
      condition: "parens-new-line",
      logical: "parens-new-line",
      prop: "parens-new-line"
    }],
    "@stylistic/jsx-first-prop-new-line": ["error", "multiline"],
    "@stylistic/jsx-closing-bracket-location": ["error", "tag-aligned"],
    "@stylistic/jsx-max-props-per-line": ["error", {
      maximum: {
        single: 3,
        multi: 1
      }
    }],
    "@stylistic/semi": ["error", "always"],
    "@stylistic/quotes": ["error", "double", {
      avoidEscape: true,
      allowTemplateLiterals: "always"
    }],
    "@stylistic/keyword-spacing": "error",
    "@stylistic/space-infix-ops": "error",
    "@stylistic/comma-spacing": "error",
    "@stylistic/key-spacing": "error",
    "@stylistic/no-trailing-spaces": "error",
    "@stylistic/eol-last": ["error", "always"],
    "@stylistic/list-style": ["error", {
      overrides: {
        "()": "off",
        "[]": "off",
        "<>": "off",
        ImportDeclaration: "off",
        ExportNamedDeclaration: "off",
        ObjectExpression: {
          empty: "never",
          singleLine: {
            maxItems: 0
          },
          multiLine: {
            minItems: 1
          }
        },
        ObjectPattern: {
          empty: "never",
          singleLine: {
            spacing: "always",
            maxItems: 1
          },
          multiLine: {
            minItems: 1
          }
        },
        TSTypeLiteral: {
          empty: "never",
          singleLine: {
            maxItems: 0
          },
          multiLine: {
            minItems: 1
          }
        }
      }
    }],
    "@stylistic/padding-line-between-statements": ["error", {
      blankLine: "always",
      prev: "*",
      next: ["return", "throw", "function", "export", "type", "interface", "if", "try", "for", "while", "switch"]
    }, {
      blankLine: "always",
      prev: "block-like",
      next: "*"
    }, {
      blankLine: "always",
      prev: "import",
      next: "*"
    }, {
      blankLine: "any",
      prev: "import",
      next: "import"
    }, {
      blankLine: "always",
      prev: ["const", "let"],
      next: "*"
    }, {
      blankLine: "any",
      prev: ["const", "let"],
      next: ["const", "let"]
    }]
  }
}, {
  files: ["src/**/*.{ts,tsx}"],
  plugins: {
    "react-hooks": reactHooks,
    "@next/next": next,
    "css-modules": fixupPluginRules(cssModules)
  },
  rules: {
    ...reactHooks.configs.flat.recommended.rules,
    // The compiler currently misidentifies the stable accountIcon lookup as component construction.
    "react-hooks/static-components": "off",
    ...next.configs["core-web-vitals"].rules,
    "css-modules/no-undef-class": "error"
  }
}, {
  files: ["src/**/*.{ts,tsx}"],
  ignores: ["src/features/dashboard/**", "src/app/(dashboard)/**"],
  rules: {
    "no-restricted-imports": ["error", {
      patterns: [dashboardImports]
    }]
  }
}, {
  files: ["src/features/**/*.{ts,tsx}", "src/components/**/*.{ts,tsx}", "src/client/**/*.{ts,tsx}"],
  ignores: ["src/features/**/server/**", "src/features/dashboard/**"],
  rules: {
    "no-restricted-imports": ["error", {
      patterns: [browserImports, dashboardImports]
    }]
  }
}, {
  files: ["src/features/dashboard/**/*.{ts,tsx}"],
  rules: {
    "no-restricted-imports": ["error", {
      patterns: [browserImports]
    }]
  }
}, {
  files: ["src/app/api/**/route.ts"],
  rules: {
    "no-restricted-imports": ["error", {
      patterns: [{
        group: ["@libsql/client", "drizzle-orm", "drizzle-orm/**"],
        message: "Route handlers delegate persistence to server modules."
      }, dashboardImports]
    }]
  }
}, {
  files: ["src/lib/**/*.ts", "src/features/**/server/**/*service.ts", "src/features/banking/server/connect-bank.ts"],
  rules: {
    "no-restricted-imports": ["error", {
      patterns: [{
        group: ["@libsql/client", "drizzle-orm", "drizzle-orm/**", "**/database/schema", "@/server/database/schema"],
        message: "Services and utilities delegate data access to repositories; use inferred model types when needed."
      }, dashboardImports]
    }],
    "no-restricted-syntax": ["error", {
      selector: "MemberExpression[property.name='$client']",
      message: "Raw client access belongs in repositories, read projections or database infrastructure."
    }]
  }
}, {
  files: ["src/**/*.{ts,tsx}"],
  plugins: {
    boundaries
  },
  settings: {
    "import/resolver": {
      typescript: {
        alwaysTryTypes: true
      }
    },
    "boundaries/elements": [...featureServerElements, {
      type: "server",
      pattern: "src/server"
    }, {
      type: "lib",
      pattern: "src/lib"
    }]
  },
  rules: {
    "boundaries/dependencies": ["error", {
      default: "disallow",
      policies: [...layerPolicies, ...sharedServerElements.map(type => ({
        from: {
          element: {
            type
          }
        },
        allow: {
          to: {
            element: {
              types: [...sharedServerElements, "server", "lib"]
            }
          }
        }
      })), {
        from: {
          element: {
            type: "server"
          }
        },
        allow: {
          to: {
            element: {
              types: ["server", "lib"]
            }
          }
        }
      }, {
        from: {
          element: {
            type: "lib"
          }
        },
        allow: {
          to: {
            element: {
              type: "lib"
            }
          }
        }
      }]
    }]
  }
}];
