param(
  [string]$Container = "NodeRedModule",
  [string]$RemoteDir = "/data-internal/dist"
)

$ErrorActionPreference = 'Stop'

Write-Host ">> Building..." -ForegroundColor Cyan
npm run build | Out-Null

$target = "${Container}:${RemoteDir}"
Write-Host ">> Copying to $target ..." -ForegroundColor Cyan
docker --context $env:DOCKER_CONTEXT cp dist/. $target

Write-Host ">> Restart container ${Container} ..." -ForegroundColor Cyan
docker --context $env:DOCKER_CONTEXT restart ${Container} | Out-Null

Write-Host ">> Deployed." -ForegroundColor Green
