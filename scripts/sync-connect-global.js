const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const repoRoot = path.resolve(__dirname, '..');
const srcPath = path.join(repoRoot, 'src', 'commands', 'connect.ts');
const localOut = path.join(repoRoot, 'bin', 'commands', 'connect.js');
const globalOut = path.join(process.env.APPDATA || '', 'npm', 'node_modules', 'betty', 'bin', 'commands', 'connect.js');

const source = fs.readFileSync(srcPath, 'utf8');
const transpiled = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.CommonJS,
    esModuleInterop: true,
    skipLibCheck: true,
  },
}).outputText;

for (const outPath of [localOut, globalOut]) {
  const dir = path.dirname(outPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(outPath, transpiled, 'utf8');
  console.log(`updated: ${outPath}`);
}
