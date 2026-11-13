$ErrorActionPreference = 'Stop'
# 锚点几何探针的跑法：从**发货源码**里读出 squashSwing，再用与 lib/desktop-pet.js 同一个 csc 编一个离屏探针。
$repo = Split-Path -Parent $PSScriptRoot
$cs = Join-Path $repo 'lib\native\pet-window.cs'
$text = Get-Content $cs -Raw
$m = [regex]::Match($text, 'const float squashSwing = ([\d.]+)f')
if (-not $m.Success) { throw 'pet-window.cs 里找不到 squashSwing —— 桌宠侧的写法变了，这个探针要跟着改' }
$swing = $m.Groups[1].Value
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) { throw 'csc 不在：' + $csc }
$exe = Join-Path $env:TEMP 'pighub-anchor-probe.exe'
# 源码路径必须是**绝对 Windows 路径**：csc 会把带正斜杠的参数当成开关（踩过：路径被啃掉一段，报 CS1504）。
$src = (Resolve-Path (Join-Path $PSScriptRoot '_pet-anchor-probe.cs')).Path
& $csc /nologo /target:exe /platform:x64 /optimize+ /r:System.Drawing.dll "/out:$exe" "$src" | Out-Null
if (-not (Test-Path $exe)) { throw 'csc 编译失败' }
"squashSwing(read from pet-window.cs) = $swing"
# 盒子尺寸取实测的那只猪：96 CSS px @200% = 192 物理宽，pighub-974 的纵横比 0.898 → 高 172
& $exe $swing 192 172
