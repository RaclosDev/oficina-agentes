param(
  [string]$Url = 'http://127.0.0.1:3210/?mini',
  [int]$Height = 0
)
# Abre la vista compacta de la Oficina en una ventana de Edge (modo app) y la deja
# siempre encima con la API de Windows. A diferencia del Picture-in-Picture del
# navegador, otra ventana flotante no la cierra.
# Con -Height solo cambia el alto de la ventana ya abierta (sin moverla).
$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class OficinaWin {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc f, IntPtr l);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint f);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  public static IntPtr Find(string[] marks) {
    IntPtr found = IntPtr.Zero;
    EnumWindows((h, l) => {
      if (!IsWindowVisible(h)) return true;
      var sb = new StringBuilder(512);
      GetWindowText(h, sb, 512);
      var t = sb.ToString();
      foreach (var m in marks) if (t.Contains(m)) { found = h; return false; }
      return true;
    }, IntPtr.Zero);
    return found;
  }
}
"@

# La página marca su título con dos U+2060 (invisibles); «(mini)» es la marca antigua.
$wj = [string][char]0x2060
[string[]]$marks = @(($wj + $wj), '(mini)')
$h = [OficinaWin]::Find($marks)

if ($Height -gt 0) {
  if ($h -eq [IntPtr]::Zero) { 'notfound'; exit 1 }
  $r = New-Object OficinaWin+RECT
  [OficinaWin]::GetWindowRect($h, [ref]$r) | Out-Null
  # SWP_NOMOVE | SWP_NOZORDER | SWP_NOACTIVATE
  [OficinaWin]::SetWindowPos($h, [IntPtr]::Zero, 0, 0, ($r.Right - $r.Left), $Height, 0x0002 -bor 0x0004 -bor 0x0010) | Out-Null
  'ok'
  exit 0
}

$launched = $false
if ($h -eq [IntPtr]::Zero) {
  Start-Process msedge -ArgumentList "--app=$Url", '--window-size=340,640'
  $launched = $true
  for ($i = 0; $i -lt 60 -and $h -eq [IntPtr]::Zero; $i++) {
    Start-Sleep -Milliseconds 250
    $h = [OficinaWin]::Find($marks)
  }
}
if ($h -eq [IntPtr]::Zero) { 'notfound'; exit 1 }
if ($launched) {
  # Edge recuerda el último tamaño de la ventana: se fuerza el compacto por defecto
  # (el alto lo ajusta después la página a las sesiones). SWP_NOMOVE | SWP_NOZORDER
  [OficinaWin]::SetWindowPos($h, [IntPtr]::Zero, 0, 0, 340, 640, 0x0002 -bor 0x0004) | Out-Null
}
# HWND_TOPMOST (-1); SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW
[OficinaWin]::SetWindowPos($h, [IntPtr](-1), 0, 0, 0, 0, 0x0002 -bor 0x0001 -bor 0x0040) | Out-Null
[OficinaWin]::SetForegroundWindow($h) | Out-Null
'ok'
