import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const source = resolve(here, "../../frontend/static/themes");
const destination = resolve(here, "../client/themes.generated.ts");
const themes = {};

for (const file of readdirSync(source)
  .filter((name) => name.endsWith(".css"))
  .sort()) {
  const css = readFileSync(join(source, file), "utf8");
  const name = file.replace(/\.css$/, "");
  const read = (property, fallback = "") =>
    new RegExp(`--${property}:\\s*([^;]+)`).exec(css)?.[1]?.trim() ?? fallback;
  const error = read("error-color", "#ca4754");
  themes[name] = {
    label: name
      .split("_")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" "),
    bg: read("bg-color", "#323437"),
    main: read("main-color", "#e2b714"),
    caret: read("caret-color", "#e2b714"),
    sub: read("sub-color", "#646669"),
    subAlt: read("sub-alt-color", "#2c2e31"),
    text: read("text-color", "#d1d0c5"),
    error,
    errorExtra: read("error-extra-color", error),
  };
}

writeFileSync(
  destination,
  `// Generated from frontend/static/themes by scripts/generate-themes.mjs.\nexport const monkeytypeThemes = ${JSON.stringify(themes, null, 2)} as const;\n`,
);
