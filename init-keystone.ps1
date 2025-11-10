param()

function Ensure-Dir($p) {
    if (-not (Test-Path $p)) { New-Item -ItemType Directory -Force -Path $p | Out-Null }
}

Write-Host ">> Ensuring folders..."
Ensure-Dir "src"
Ensure-Dir "src\broker"
Ensure-Dir "src\reader"
Ensure-Dir "src\compiler"
Ensure-Dir "src\utils"
Ensure-Dir "tests"
Ensure-Dir "scripts"

Write-Host ">> Ensuring tsconfig.json..."
$ts = @"
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "rootDir": "src",
    "outDir": "dist",
    "declaration": true,
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src"]
}
"@
if (-not (Test-Path ".\tsconfig.json")) { $ts | Set-Content ".\tsconfig.json" }

Write-Host ">> Done."
