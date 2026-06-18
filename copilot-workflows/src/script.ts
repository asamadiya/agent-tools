import vm from "node:vm";
import { WorkflowMetaSchema, type WorkflowMeta } from "./types.js";

export interface WorkflowInspection {
  valid: boolean;
  meta: WorkflowMeta | null;
  errors: string[];
  warnings: string[];
}

const META_START_RE = /export\s+const\s+meta\s*=\s*({)/m;
// Strips the entire `export const meta = { ... }` declaration (including trailing semicolon)
const META_FULL_RE = /export\s+const\s+meta\s*=\s*{[\s\S]*?}\s*;?\s*/m;

const findMetaLiteral = (script: string): string | null => {
  const match = META_START_RE.exec(script);
  if (!match) return null;
  const start = match.index + match[0].length - 1; // index of opening {
  let depth = 0;
  for (let i = start; i < script.length; i++) {
    if (script[i] === "{") depth++;
    else if (script[i] === "}") {
      depth--;
      if (depth === 0) return script.slice(start, i + 1);
    }
  }
  return null;
};

const rejectNonLiteralMeta = (literal: string): void => {
  const forbidden = [
    { re: /\.\.\./, name: "spread" },
    { re: /`/, name: "template string" },
    { re: /\b[a-zA-Z_$][\w$]*\s*\(/, name: "function call" },
  ];
  for (const f of forbidden) {
    if (f.re.test(literal)) throw new Error(`meta must be a pure literal; found ${f.name}`);
  }
  const withoutKeysAndStrings = literal
    .replace(/(['"])(?:\\.|(?!\1).)*\1\s*:/g, "")
    .replace(/[a-zA-Z_$][\w$]*\s*:/g, "")
    .replace(/(['"])(?:\\.|(?!\1).)*\1/g, "")
    .replace(/\b(true|false|null)\b/g, "");
  if (/[a-zA-Z_$][\w$]*/.test(withoutKeysAndStrings)) {
    throw new Error("meta must be a pure literal; found identifier reference");
  }
};

export const extractWorkflowMeta = (script: string): WorkflowMeta => {
  const literal = findMetaLiteral(script);
  if (!literal) throw new Error("workflow script must start with export const meta = { ... }");
  rejectNonLiteralMeta(literal);
  const context = vm.createContext(Object.freeze({}));
  const parsed = vm.runInContext(`(${literal})`, context, { timeout: 1000 });
  return WorkflowMetaSchema.parse(parsed);
};

export const stripMetaExport = (script: string): string => script.replace(META_FULL_RE, "").trim();

export const validateDeterministicScript = (script: string): void => {
  const checks = [
    { re: /\bDate\.now\s*\(/, name: "Date.now" },
    { re: /\bMath\.random\s*\(/, name: "Math.random" },
    { re: /\bnew\s+Date\s*\(\s*\)/, name: "new Date()" },
    { re: /\brequire\s*\(/, name: "require()" },
    { re: /\bimport\s*\(/, name: "dynamic import()" },
  ];
  for (const check of checks) {
    if (check.re.test(script)) throw new Error(`workflow script uses nondeterministic or unavailable API: ${check.name}`);
  }
};

export const inspectWorkflowScript = (script: string): WorkflowInspection => {
  const errors: string[] = [];
  let meta: WorkflowMeta | null = null;
  try {
    meta = extractWorkflowMeta(script);
    validateDeterministicScript(script);
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
  }
  return { valid: errors.length === 0, meta, errors, warnings: [] };
};
