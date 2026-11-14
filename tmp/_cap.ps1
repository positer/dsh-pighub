
param([string]$Out, [int]$X = 0, [int]$Y = 0, [int]$W = 0, [int]$H = 0)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class Dpi {
    [DllImport("shcore.dll")] public static extern int SetProcessDpiAwareness(int v);
    [DllImport("user32.dll")] public static extern int GetSystemMetrics(int i);
}
'@
$d = [Dpi]::SetProcessDpiAwareness(2)
$sw = [Dpi]::GetSystemMetrics(78); $sh = [Dpi]::GetSystemMetrics(79)
if ($W -le 0) { $W = $sw }; if ($H -le 0) { $H = $sh }
$bmp = New-Object System.Drawing.Bitmap($W, $H, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($X, $Y, 0, 0, $bmp.Size, [System.Drawing.CopyPixelOperation]::SourceCopy)
$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
Write-Output ("dpi=$d screen=" + $sw + "x" + $sh + " region=" + $X + "," + $Y + "," + $W + "x" + $H + " bytes=" + (Get-Item $Out).Length)
