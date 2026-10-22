# Gera o executável portátil e o instalador do LiminalPDF.
# Requer Node.js 20+ e Rust (rustup) com o Visual Studio Build Tools (C++).
$ErrorActionPreference = "Stop"
Set-Location (Split-Path -Parent $PSScriptRoot)

npm install
npx tauri build

New-Item -ItemType Directory -Force -Path release | Out-Null
Copy-Item -Force src-tauri/target/release/liminalpdf.exe release/LiminalPDF.exe
Copy-Item -Force src-tauri/target/release/bundle/nsis/*.exe release/ -ErrorAction SilentlyContinue
Write-Host "Pronto: release/LiminalPDF.exe (portátil) e instalador em release/"
