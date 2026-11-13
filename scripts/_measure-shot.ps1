
# 量一张截图里「猪圈面板是否真的画出来了」：主区域里的绿色（灌木丛/草地）与米色（猪）像素数。
# 白板 = 两个数都接近 0；正常渲染 = 绿色上万、米色上千。
param([Parameter(Mandatory=$true)][string]$Path, [int]$X0=600, [int]$Y0=140, [int]$X1=2540, [int]$Y1=1480)
Add-Type -AssemblyName System.Drawing
$bmp = [System.Drawing.Bitmap]::FromFile($Path)
try {
  $green = 0; $beige = 0; $total = 0
  $step = 2   # 隔点采样，够用且快
  for ($y = $Y0; $y -lt [Math]::Min($Y1, $bmp.Height); $y += $step) {
    for ($x = $X0; $x -lt [Math]::Min($X1, $bmp.Width); $x += $step) {
      $c = $bmp.GetPixel($x, $y)
      $total++
      if ($c.G -gt ($c.R + 12) -and $c.G -gt ($c.B + 12) -and $c.G -gt 40) { $green++ }
      elseif ($c.R -gt 200 -and $c.G -gt 150 -and $c.B -gt 130 -and ($c.R - $c.B) -gt 25) { $beige++ }
    }
  }
  [pscustomobject]@{ file = [System.IO.Path]::GetFileName($Path); w = $bmp.Width; h = $bmp.Height; sampled = $total; green = $green; beige = $beige }
} finally { $bmp.Dispose() }
