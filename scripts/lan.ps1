# Libera (ou fecha) esta máquina para o teste com uma segunda máquina na rede local.
#   npm run lan:abrir   -> regras de firewall só para a rede local (porta 3001 e voz/vídeo do app)
#   npm run lan:fechar  -> remove as regras; a máquina volta ao normal
# Não muda o perfil da rede (Público/Privado): as regras valem em qualquer perfil, mas só
# aceitam conexões da sub-rede local. Pede elevação (UAC) porque mexe no firewall.
param([ValidateSet('abrir', 'fechar', 'status')][string]$Acao = 'status')

$Grupo = 'Clone Local (teste)'
$Raiz = Split-Path -Parent $PSScriptRoot
$Electron = Join-Path $Raiz 'node_modules\electron\dist\electron.exe'

function Show-Status {
  $regras = Get-NetFirewallRule -Group $Grupo -ErrorAction SilentlyContinue
  if ($regras) {
    Write-Host "Liberado para a rede local:" -ForegroundColor Green
    $regras | ForEach-Object { Write-Host "  - $($_.DisplayName)" }
  } else {
    Write-Host 'Nenhuma regra do Clone Local no firewall (máquina no estado normal).'
  }
  Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -notmatch '^(127\.|169\.254\.)' } |
    ForEach-Object { Write-Host "  endereço desta máquina: http://$($_.IPAddress):3001  ($($_.InterfaceAlias))" }
}

$Elevado = $false
$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if ($Acao -ne 'status' -and -not $admin) {
  Write-Host 'Pedindo permissão de administrador para alterar o firewall...'
  $p = Start-Process powershell -Verb RunAs -Wait -PassThru -WindowStyle Hidden -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"", $Acao)
  $Elevado = $true
}

if ($Elevado) {
  # A janela elevada já aplicou; aqui só mostramos o resultado.
  Show-Status
  if ($Acao -eq 'abrir') { Write-Host "`nAgora rode: npm run start:lan   (para fechar depois: npm run lan:fechar)" }
  exit $p.ExitCode
}

switch ($Acao) {
  'abrir' {
    Remove-NetFirewallRule -Group $Grupo -ErrorAction SilentlyContinue
    New-NetFirewallRule -Group $Grupo -DisplayName 'Clone Local - servidor (TCP 3001)' -Direction Inbound -Action Allow `
      -Protocol TCP -LocalPort 3001 -RemoteAddress LocalSubnet -Profile Any | Out-Null
    # Voz, câmera e tela vão direto entre as máquinas (WebRTC/UDP, portas variáveis).
    if (Test-Path $Electron) {
      New-NetFirewallRule -Group $Grupo -DisplayName 'Clone Local - voz e vídeo (app de desenvolvimento)' -Direction Inbound -Action Allow `
        -Protocol UDP -Program $Electron -RemoteAddress LocalSubnet -Profile Any | Out-Null
    }
    Show-Status
    Write-Host "`nAgora rode: npm run start:lan   (e, para fechar depois: npm run lan:fechar)"
  }
  'fechar' {
    Remove-NetFirewallRule -Group $Grupo -ErrorAction SilentlyContinue
    Show-Status
  }
  default { Show-Status }
}
