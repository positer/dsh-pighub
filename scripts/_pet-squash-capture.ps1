param(
  [Parameter(Mandatory=$true)][string]$Out,
  [int]$Frames = 2500,
  [int]$IntervalMs = 0,
  [int]$StartX = 1376,
  [int]$StartY = 896,
  [int]$SpriteW = 192,
  [int]$EarlyStop = 100,
  [int]$DebugEvery = 0,
  [string]$Bg = "36,40,48"
)
# 桌宠走动弹跳的实测台：铺一张纯色满屏窗口当「地面」，让**置顶的分层桌宠窗口**画在它上面。
# 桌宠是 HWND_TOPMOST，本窗口不是 topmost，所以层级天然是「桌宠在纯色地面之上」，不用抢 z-order。
#
# 为什么要 DPI 感知：本机物理 2560×1504（工作区）/ 逻辑 1280×752（200%）。桌宠进程是 per-monitor v2 感知的，
# 不声明感知的话 CopyFromScreen 拿到的是被系统缩放的视图（猪只有一半大、边缘被重采样），
# ±6% 的高度差会被压成 ±3px。所以先声明 per-monitor v2 再量。
#
# 为什么要按连通块挑：本机桌面上**同时还有另一只来自已安装插件的猪**（74 CSS px，与这只 96 CSS px 的尺寸不同）。
# 取整窗并集包围盒会把两只猪量成一个，所以按连通块分割、按「宽度最接近本只猪」来认，窗口跟着认出来的那只走。
#
# 每帧记 [Environment]::TickCount：与 pet-window.cs:266 是同一个时钟，相位可以直接对账。
#
# 只存「刷新了高度极值」的那几帧：每帧存 900×700 PNG 会把采样间隔从 ~25ms 拖到 150ms 以上，节拍就采不到极值了。
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
# PowerShell 7 里 System.Drawing 是外置的 System.Drawing.Common：Add-Type 编 C# 时必须显式引用，否则报 CS1069。
$refs = @([System.Drawing.Bitmap].Assembly.Location, [System.Drawing.Rectangle].Assembly.Location,
          [System.Runtime.InteropServices.Marshal].Assembly.Location) | Select-Object -Unique
Add-Type -ReferencedAssemblies $refs -TypeDefinition @'
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
public static class Dpi {
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
}
public static class PigScan {
  // 连通块（4 邻接）分割，返回**扁平** int[]：[块数, l,t,r,b,count, l,t,r,b,count, ...]（最多 64 块，面积 < minCount 的丢掉）。
  // 为什么扁平：PowerShell 会把返回的数组按层展开，int[][] 在「只有 1 块」时会被摊成裸 int[]，
  // 上层就得猜形状（踩过 op_Subtraction on Object[]）。一维数字数组 + 首元素计数是确定性的。
  public static int[] Components(Bitmap bmp, int bgR, int bgG, int bgB, int tol, int minCount) {
    int w = bmp.Width, h = bmp.Height;
    BitmapData d = bmp.LockBits(new Rectangle(0, 0, w, h), ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
    try {
      byte[] buf = new byte[d.Stride * h];
      Marshal.Copy(d.Scan0, buf, 0, buf.Length);
      bool[] mask = new bool[w * h];
      for (int y = 0; y < h; y++) {
        int row = y * d.Stride;
        for (int x = 0; x < w; x++) {
          int p = row + x * 4;
          if (buf[p + 3] < 8) continue;
          int dr = buf[p + 2] - bgR; if (dr < 0) dr = -dr;
          int dg = buf[p + 1] - bgG; if (dg < 0) dg = -dg;
          int db = buf[p] - bgB; if (db < 0) db = -db;
          if (dr + dg + db <= tol) continue;
          mask[y * w + x] = true;
        }
      }
      int[] flat = new int[1 + 64 * 5];
      int count = 0;
      int[] stack = new int[w * h];
      int[] label = new int[w * h];
      for (int i = 0; i < mask.Length; i++) {
        if (!mask[i] || label[i] != 0) continue;
        if (count >= 64) break;
        int sp = 0;
        stack[sp++] = i;
        label[i] = count + 1;
        int left = int.MaxValue, topY = int.MaxValue, right = -1, bottom = -1, px = 0;
        while (sp > 0) {
          int cur = stack[--sp];
          int cx = cur % w, cy = cur / w;
          px++;
          if (cx < left) left = cx; if (cx > right) right = cx;
          if (cy < topY) topY = cy; if (cy > bottom) bottom = cy;
          if (cx > 0) { int n2 = cur - 1; if (mask[n2] && label[n2] == 0) { label[n2] = count + 1; stack[sp++] = n2; } }
          if (cx < w - 1) { int n2 = cur + 1; if (mask[n2] && label[n2] == 0) { label[n2] = count + 1; stack[sp++] = n2; } }
          if (cy > 0) { int n2 = cur - w; if (mask[n2] && label[n2] == 0) { label[n2] = count + 1; stack[sp++] = n2; } }
          if (cy < h - 1) { int n2 = cur + w; if (mask[n2] && label[n2] == 0) { label[n2] = count + 1; stack[sp++] = n2; } }
        }
        if (px >= minCount) {
          int b2 = 1 + count * 5;
          flat[b2] = left; flat[b2 + 1] = topY; flat[b2 + 2] = right; flat[b2 + 3] = bottom; flat[b2 + 4] = px;
          count++;
        }
      }
      flat[0] = count;
      return flat;
    } finally { bmp.UnlockBits(d); }
  }
}
'@
try { [Dpi]::SetProcessDpiAwarenessContext([IntPtr]::new(-4)) | Out-Null } catch { }

$rgb = $Bg.Split(',') | ForEach-Object { [int]$_ }
$bgColor = [System.Drawing.Color]::FromArgb(255, $rgb[0], $rgb[1], $rgb[2])
$screen = [System.Windows.Forms.Screen]::PrimaryScreen
$area = $screen.WorkingArea

New-Item -ItemType Directory -Force -Path $Out | Out-Null
$times = Join-Path $Out 'frames.txt'
$header = 'index tickCount elapsedMs winX winY boxLeft boxTop boxRight boxBottom count width height accepted'
Set-Content -Path $times -Value $header -Encoding utf8   # 每次重写：Add-Content 会把上一轮的帧拼进来

$form = [System.Windows.Forms.Form]::new()
$form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None
$form.StartPosition = [System.Windows.Forms.FormStartPosition]::Manual
$form.Bounds = $screen.Bounds
$form.BackColor = $bgColor
$form.ShowInTaskbar = $false
$form.TopMost = $false
$form.Show()
[System.Windows.Forms.Application]::DoEvents()
Start-Sleep -Milliseconds 500

$winW = 900; $winH = 700
$tol = 40
$expectW = [int]($SpriteW * 0.96)   # 素材四周有 1–2% 透明边：192 的盒子实测 185
$wTol = 22                          # 收紧：本机另一只桌宠猪只有 142 宽，带宽放到 ±45 会把它认进来（踩过）
$bmp = [System.Drawing.Bitmap]::new($winW, $winH, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$full = [System.Drawing.Bitmap]::new($area.Width, $area.Height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$fg = [System.Drawing.Graphics]::FromImage($full)
$cx = $StartX; $cy = $StartY
$h0 = -1; $oscill = 0; $kept = 0; $miss = 0; $bestMin = [int]::MaxValue; $bestMax = -1; $pinned = 0; $rejected = 0
# 滑动窗口：用来提前抓「猪被边界夹住、Y 不动」的那一段 —— 只有在那种段里才能把缩放锚点量出来。
$histH = [System.Collections.Generic.List[int]]::new()
$histInv = [System.Collections.Generic.List[double]]::new()
$lines = [System.Collections.Generic.List[string]]::new()

$sw = [System.Diagnostics.Stopwatch]::StartNew()
for ($i = 0; $i -lt $Frames; $i++) {
  $useFull = ($i -eq 0) -or ($miss -ge 3)
  if ($useFull) {
    # 全屏找一遍（第一帧、以及跟丢 3 帧后重新捕获）：整屏 2560×1504 只在必要时抓。
    $fg.CopyFromScreen($area.Left, $area.Top, 0, 0, [System.Drawing.Size]::new($area.Width, $area.Height))
    $scan = $bmp2 = $full
    $scanW = $area.Width; $scanH = $area.Height
    $raw = @([PigScan]::Components($full, $rgb[0], $rgb[1], $rgb[2], $tol, 4000))
    $offX = 0; $offY = 0
  } else {
    $wx0 = [Math]::Max(0, [Math]::Min($area.Width - $winW, $cx - [int]($winW / 2)))
    $wy0 = [Math]::Max(0, [Math]::Min($area.Height - $winH, $cy - [int]($winH / 2)))
    $g.CopyFromScreen($area.Left + $wx0, $area.Top + $wy0, 0, 0, [System.Drawing.Size]::new($winW, $winH))
    $raw = @([PigScan]::Components($bmp, $rgb[0], $rgb[1], $rgb[2], $tol, 4000))
    $offX = $wx0; $offY = $wy0
  }
  # 认猪：宽度最接近 $expectW 的块（超差就不认）。
  $pickIdx = -1; $bestErr = [int]::MaxValue
  for ($k = 0; $k -lt $raw[0]; $k++) {
    $b = 1 + $k * 5
    $cw = $raw[$b + 2] - $raw[$b] + 1
    $err = [Math]::Abs($cw - $expectW)
    if ($err -le $wTol -and $err -lt $bestErr) { $pickIdx = $k; $bestErr = $err }
  }
  $tick = [Environment]::TickCount
  $elapsed = [int]$sw.ElapsedMilliseconds
  $wx = $offX; $wy = $offY
  if ($pickIdx -lt 0) {
    $miss++
    $lines.Add("$i $tick $elapsed $wx $wy -1 -1 -1 -1 0 0 0 0")
  } else {
    $miss = 0
    $b = 1 + $pickIdx * 5
    $bl = $offX + $raw[$b]; $bt = $offY + $raw[$b + 1]; $br = $offX + $raw[$b + 2]; $bb = $offY + $raw[$b + 3]
    $bw = $br - $bl + 1; $bh = $bb - $bt + 1; $bc = $raw[$b + 4]
    $cx = [int](($bl + $br) / 2); $cy = [int](($bt + $bb) / 2)
    if ($useFull) {
      # 全屏那帧也存一张 900×700 的裁剪（以这只猪为中心的窗口），坐标原点照实记下来。
      $wx = [Math]::Max(0, [Math]::Min($area.Width - $winW, $cx - [int]($winW / 2)))
      $wy = [Math]::Max(0, [Math]::Min($area.Height - $winH, $cy - [int]($winH / 2)))
      $g.DrawImage($full, [System.Drawing.Rectangle]::new(0, 0, $winW, $winH),
                   [System.Drawing.Rectangle]::new($wx, $wy, $winW, $winH), [System.Drawing.GraphicsUnit]::Pixel)
    }
    # 合理性闸门：实现只可能让高度落在 0.94…1.06 倍「站定高度」之间（外加 1–2px 抗锯齿）。
    # 超出这个带 = 这块不是一只猪（两只贴在一起被连通、或被窗口裁掉一截），不能拿来当证据帧。
    $plausible = ($h0 -lt 0) -or ($bh -ge 0.88 * $h0 -and $bh -le 1.12 * $h0)
    if (-not $plausible) {
      $lines.Add("$i $tick $elapsed $wx $wy $bl $bt $br $bb $bc $bw $bh 0")
      $rejected++
    } else {
      $kept++
      if ($h0 -lt 0) { $h0 = $bh }
      if ([Math]::Abs($bh - $h0) -ge 4) { $oscill++ }
      if ($bh -lt $bestMin -or $bh -gt $bestMax) {
        if ($bh -lt $bestMin) { $bestMin = $bh }
        if ($bh -gt $bestMax) { $bestMax = $bh }
        $bmp.Save((Join-Path $Out ('f{0:d4}.png' -f $i)), [System.Drawing.Imaging.ImageFormat]::Png)
      }
      $lines.Add("$i $tick $elapsed $wx $wy $bl $bt $br $bb $bc $bw $bh 1")
      # 不变量：bottom + hop(相位)。猪的 Y 不动时它应当恒定（脚底锚点）——这就是「夹住段」的判据。
      $hopPred = 0.12 * $SpriteW * [Math]::Abs([Math]::Sin(($tick % 100000) / 90.0))
      $histH.Add($bh); $histInv.Add($bb + $hopPred)
      if ($histH.Count -gt 28) { $histH.RemoveAt(0); $histInv.RemoveAt(0) }
      if ($histH.Count -ge 28) {
        $hSwing = ($histH | Measure-Object -Maximum).Maximum - ($histH | Measure-Object -Minimum).Minimum
        $iSwing = ($histInv | Measure-Object -Maximum).Maximum - ($histInv | Measure-Object -Minimum).Minimum
        if ($hSwing -ge 12 -and $iSwing -le 4) { $pinned = 1 }
      }
    }
  }
  if ($DebugEvery -gt 0 -and ($i % $DebugEvery) -eq 0) {
    Write-Host ("debug i=$i off=($offX,$offY) full=$useFull comps=" + $raw[0] + " pick=" + $pickIdx)
  }
  if (($i % 10) -eq 0) { [System.Windows.Forms.Application]::DoEvents() }
  # 走动是成阵的（0.72 的呆滞率 → 可能十几秒都不走），攒够「高度明显偏离站定值」的帧就收工。
  if ($EarlyStop -gt 0 -and $oscill -ge $EarlyStop) { break }
  if ($pinned -eq 1) { break }   # 已经抓到「夹住段」，不必再空转
  if ($IntervalMs -gt 0) { Start-Sleep -Milliseconds $IntervalMs }
}
$sw.Stop()
$g.Dispose(); $bmp.Dispose(); $fg.Dispose(); $full.Dispose()
Add-Content -Path $times -Value $lines -Encoding utf8
$form.Close()
$form.Dispose()
"captured frames=" + $kept + " in " + [int]$sw.ElapsedMilliseconds + "ms win=" + $winW + "x" + $winH + " area=" + $area.Width + "x" + $area.Height + " spriteW=" + $SpriteW + " oscillating=" + $oscill + " pinnedSegment=" + $pinned + " implausible=" + $rejected
