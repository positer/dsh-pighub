// dsh-pighub 桌面桌宠宿主：一个顶层分层窗口，画所有桌宠。
// .NET Framework 4.x / C# 5 语法（csc.exe 直编，不依赖 SDK）。
// 设计要点（与 docs/DESKTOP-PET-NATIVE.md 的研读结论一致）：
//   * 窗口是桌面级顶层 HWND，不属于任何应用窗口；WS_EX_LAYERED 做逐像素 alpha；
//   * 不做 WS_EX_TRANSPARENT：命中测试由 WM_NCHITTEST 按 alpha 自己判，透明处返回 HTTRANSPARENT，
//     所以窗口可以比猪大、却不挡鼠标；
//   * 宿主（Node）与它只通过临时目录里的 JSON 文件通信，没有端口、没有 stdin；
//   * 关停信号是目录里的 stop 文件。
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

internal static class Native {
    [StructLayout(LayoutKind.Sequential)] internal struct Point { public int X, Y; public Point(int x, int y) { X = x; Y = y; } }
    [StructLayout(LayoutKind.Sequential)] internal struct Size { public int X, Y; public Size(int x, int y) { X = x; Y = y; } }
    [StructLayout(LayoutKind.Sequential, Pack = 1)] internal struct Blend { public byte Operation, Flags, Alpha, Format; }
    [StructLayout(LayoutKind.Sequential)] internal struct Rect { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] internal struct BitmapInfoHeader {
        public int Size, Width, Height;
        public short Planes, BitCount;
        public int Compression, SizeImage, XPelsPerMeter, YPelsPerMeter, ClrUsed, ClrImportant;
    }
    [StructLayout(LayoutKind.Sequential)] internal struct BitmapInfo { public BitmapInfoHeader Header; public int Colors; }

    [DllImport("user32.dll")] internal static extern bool UpdateLayeredWindow(IntPtr hwnd, IntPtr dst, ref Point src, ref Size size, IntPtr dc, ref Point origin, uint colorKey, ref Blend blend, uint flags);
    [DllImport("user32.dll")] internal static extern IntPtr GetDC(IntPtr hwnd);
    [DllImport("user32.dll")] internal static extern int ReleaseDC(IntPtr hwnd, IntPtr dc);
    [DllImport("gdi32.dll")] internal static extern IntPtr CreateCompatibleDC(IntPtr dc);
    [DllImport("gdi32.dll")] internal static extern bool DeleteDC(IntPtr dc);
    [DllImport("gdi32.dll")] internal static extern IntPtr SelectObject(IntPtr dc, IntPtr obj);
    [DllImport("gdi32.dll")] internal static extern bool DeleteObject(IntPtr obj);
    [DllImport("user32.dll")] internal static extern bool SetProcessDpiAwarenessContext(IntPtr context);
    [DllImport("user32.dll")] internal static extern bool SetWindowPos(IntPtr hwnd, IntPtr after, int x, int y, int cx, int cy, uint flags);
    [DllImport("user32.dll")] internal static extern int GetDpiForWindow(IntPtr hwnd);
    [DllImport("user32.dll")] internal static extern bool PostMessage(IntPtr hwnd, int msg, IntPtr wParam, IntPtr lParam);
    [DllImport("dwmapi.dll")] internal static extern int DwmFlush();
    [DllImport("winmm.dll")] internal static extern uint timeBeginPeriod(uint milliseconds);
    [DllImport("winmm.dll")] internal static extern uint timeEndPeriod(uint milliseconds);
    [DllImport("gdi32.dll")] internal static extern IntPtr CreateDIBSection(IntPtr dc, ref BitmapInfo info, uint usage, out IntPtr bits, IntPtr section, uint offset);

    /// <summary>
    /// 一块**常驻**的合成面：32bpp 预乘 alpha 的 DIB + 一张包着同一块像素的 Bitmap。
    ///
    /// 为什么要有它（2026-11-17 实测）：旧写法每帧都 canvas.GetHbitmap() + CreateCompatibleDC，
    /// 等于每帧把整块画布复制一遍再交给 UpdateLayeredWindow —— 4 只猪铺开时画布 1792×1216（8.7 MB），
    /// **30 fps 就吃掉一个核的 78%**（同一台机器、同一个探针量的）。改成「一次分配、每帧只画不复制」。
    ///
    /// 像素格式必须是 **PArgb（预乘 alpha）**：UpdateLayeredWindow 的 ULW_ALPHA 按预乘解释 RGB，
    /// 送未预乘的 ARGB 会让半透明边缘按 alpha 偏亮一次（描边发白）。GDI+ 画进 PArgb 目标时自动预乘。
    ///
    /// biHeight 取负数 = 自上而下的 DIB，与 Bitmap 的行序一致；取正数会整幅上下颠倒。
    /// </summary>
    internal sealed class Surface : IDisposable {
        internal readonly int Width;
        internal readonly int Height;
        internal readonly Bitmap Bitmap;
        internal readonly Graphics Graphics;
        private readonly IntPtr screenDc;
        private readonly IntPtr memoryDc;
        private readonly IntPtr dib;
        private readonly IntPtr previous;

        internal Surface(int width, int height) {
            Width = width;
            Height = height;
            screenDc = GetDC(IntPtr.Zero);
            memoryDc = CreateCompatibleDC(screenDc);
            BitmapInfo info = new BitmapInfo();
            info.Header.Size = Marshal.SizeOf(typeof(BitmapInfoHeader));
            info.Header.Width = width;
            info.Header.Height = -height;
            info.Header.Planes = 1;
            info.Header.BitCount = 32;
            info.Header.Compression = 0;   // BI_RGB
            IntPtr bits;
            dib = CreateDIBSection(screenDc, ref info, 0, out bits, IntPtr.Zero, 0);
            previous = SelectObject(memoryDc, dib);
            Bitmap = new Bitmap(width, height, width * 4, PixelFormat.Format32bppPArgb, bits);
            Graphics = Graphics.FromImage(Bitmap);
        }

        /// <summary>交给 UpdateLayeredWindow 的源 DC：位图已经选在里面。</summary>
        internal IntPtr MemoryDc { get { return memoryDc; } }

        public void Dispose() {
            Graphics.Dispose();
            Bitmap.Dispose();
            SelectObject(memoryDc, previous);
            DeleteObject(dib);
            DeleteDC(memoryDc);
            ReleaseDC(IntPtr.Zero, screenDc);
        }
    }

    /// <summary>把合成面贴到窗口上（位置、尺寸、位图**一次提交**：分两步会出现「窗口是新的、内容是旧的」）。</summary>
    internal static void Present(IntPtr hwnd, Surface surface, Point location) {
        Size size = new Size(surface.Width, surface.Height);
        Point src = new Point(0, 0);
        Blend blend = new Blend();
        blend.Operation = 0; blend.Flags = 0; blend.Alpha = 255; blend.Format = 1;
        UpdateLayeredWindow(hwnd, IntPtr.Zero, ref location, ref size, surface.MemoryDc, ref src, 0, ref blend, 2);
    }
}

/// <summary>
/// 画布几何的裁定规则。**纯函数**：不碰窗口、不碰位图，所以它能被单独跑（test/native-canvas.test.mjs）。
///
/// 为什么需要它 —— 这一条有实测数字（2026-11-15，3 只猪铺满一屏 ≈1900×1100 画布，30fps 进程内渲染）：
///   窗口矩形 6.7 次/秒在变；窗口一变，**静止猪**所在区域的像素有 90.7% 的采样跟着变，
///   窗口没变时只有 12.6%。用户看到的就是"别的猪一起颤动"。
/// 成因是帧循环把画布贴死在"所有猪的包围盒 + margin"上：猪每走 1px，包围盒就换一格，
/// 窗口就搬一次；而搬家分两步走（先搬窗口、里面还是上一帧的位图 → 整窗内容整体位移；
/// 再贴新位图）。画布越大，这两步之间的空档越长，位移就越容易被合成到屏幕上。
/// 所以这条规则只干一件事：**装得下就别动**。画布比猪大一圈是免费的 —— 透明处本来就穿透鼠标。
/// </summary>
internal static class CanvasFit {
    /// <summary>猪到画布边的余量。沿用旧值：气泡与跳动都落在这个余量里。</summary>
    internal const int Margin = 80;
    /// <summary>取整网格：重定画布时向外对齐到它，让"又搬了一次"只发生在 64px 的整数倍上。</summary>
    internal const int Grid = 64;
    /// <summary>额外留的空：猪要走出这么远，才值得再搬一次窗口。</summary>
    internal const int Headroom = 64;
    /// <summary>画布比理想画布大出这么多（任一轴）才收一次；不留这个死区就会来回抖。</summary>
    internal const int Slack = 320;

    /// <summary>
    /// 决定这一帧用哪个画布矩形。
    /// need 已经含了 Margin；screen 是虚拟屏幕（多显示器取并集）。
    /// 装得下就原样返回 current —— 绝大多数帧走这一条，窗口一动不动。
    /// </summary>
    internal static Rectangle Fit(Rectangle current, Rectangle need, Rectangle screen) {
        // 至少要装下这些像素（need 被屏幕裁过之后剩下的部分）
        Rectangle keep = Rectangle.Intersect(need, screen);
        Rectangle target = Rectangle.Intersect(InGrid(Rectangle.Intersect(Rectangle.Inflate(need, Headroom, Headroom), screen)), screen);
        bool valid = current.Width >= 64 && current.Height >= 64;
        if (valid) {
            bool contains = current.Left <= keep.Left && current.Top <= keep.Top
                && current.Right >= keep.Right && current.Bottom >= keep.Bottom;
            bool bloated = current.Width > target.Width + Slack || current.Height > target.Height + Slack;
            if (contains && !bloated) return current;
        }
        return target;
    }

    /// <summary>向外取整到 Grid 的整数倍（负数也向外：-100 → -128，多留总比少留安全）。</summary>
    internal static Rectangle InGrid(Rectangle rect) {
        int left = (int)Math.Floor(rect.Left / (double)Grid) * Grid;
        int top = (int)Math.Floor(rect.Top / (double)Grid) * Grid;
        int right = (int)Math.Ceiling(rect.Right / (double)Grid) * Grid;
        int bottom = (int)Math.Ceiling(rect.Bottom / (double)Grid) * Grid;
        return Rectangle.FromLTRB(left, top, right, bottom);
    }
}

/// <summary>
/// 游走节奏的口径常量（与猪圈浏览器半 lib/client.js 的同一套参数对齐）。
/// **参数是口径，不是玄学**：调它们之前先改这里，不要散落在 Step() 的算式里。
/// </summary>
internal static class WalkTempo {
    /// <summary>每 1.7 s 决策一次（client.js DECISION_MS）。</summary>
    internal const long DecisionMs = 1700;
    /// <summary>72% 原地发呆（client.js 的 IDLE_WEIGHT）。</summary>
    internal const double IdleWeight = 0.72;
    /// <summary>
    /// 走动速度（身位/秒）。**这个数是从旧版实测反推的，不是新定的**：
    /// 旧版每帧走 Size×0.033，而 WM_TIMER 把 33 ms 量化成 3 个系统时钟（3×15.625 = 46.875 ms），
    /// 所以实际速度 = 0.033 / 0.046875 ≈ 0.704 身位/秒 —— 用户 2026-11-13 把速度「减慢」之后
    /// 看到的就是这个数（本次探针实测中位 0.70、峰值 0.72 身位/秒）。
    /// 这一轮只改帧率、不改手感，所以把它钉成显式常量，不再跟着帧间隔漂移。
    /// </summary>
    internal const float SpeedBodiesPerSecond = 0.704f;
}

/// <summary>
/// 「把桌宠拖到猪圈位置松手 → 回猪圈」这块判定区什么时候才算数（纯函数，可被测试真编译断言）。
///
/// 用户口径 2026-11-17：「拖动返回猪圈只在 PigHub 的页面内才应该生效，其他页面（包括 DSH 的其它页面）
/// 拖到对应的位置都不应该触发返回」。所以矩形必须**只在猪圈真的在眼前时**有效：
///   - 浏览器半每次量到矩形都会带上**量它的时刻**（at），并且每 2 s 续期一次；
///   - 换页面 / 面板卸载 / 窗口被隐藏时，浏览器半会显式撤销（rect: null）——宿主把 pen 从负载里删掉；
///   - 万一撤销没送到（客户端崩了、页面重载、请求丢了），**没有续期**这件事本身就足以作废它。
/// </summary>
internal static class PenTarget {
    /// <summary>矩形多久没被续期就作废（毫秒）。浏览器半每 2 s 量一次，这里留 4 倍余量。</summary>
    internal const long TtlMs = 8000L;

    /// <summary>这块矩形此刻能不能当「猪圈」用。</summary>
    internal static bool Usable(bool hasRect, long atMs, long nowMs) {
        if (!hasRect) return false;
        // 老格式的负载没有 at：宁可当作「不在 PigHub 页面」，也不要凭一个来路不明的矩形回圈。
        if (atMs <= 0L) return false;
        long age = nowMs - atMs;
        if (age < 0L) return true;   // 时钟回拨 / 宿主给了未来时刻：不因为时钟问题把功能关掉
        return age <= TtlMs;
    }
}

/// <summary>
/// 帧节拍规则（纯函数：test/native/canvas-harness.cs 把这份源码编出来直接断言）。
///
/// 旧版是 System.Windows.Forms.Timer + Interval = 33 —— 30 fps 的硬上限，而且 WM_TIMER 的分辨率
/// 跟着系统时钟走（默认 15.6 ms），实测帧间隔 31.6 ms、抖动约 ±4 ms。现在帧由后台线程按**合成节拍**驱动
/// （DwmFlush 一次 = 一次 vblank），上限因此是显示器刷新率（本机 165 Hz）；这条规则只管两件事：
/// 有动画时按合成节拍走，没动画时退到 10 Hz 轮询（静止的猪不该每秒被合成 165 次）。
/// </summary>
internal static class FrameCadence {
    /// <summary>没有动画时的轮询间隔：读 pets.json / commands.jsonl 的 mtime、回报位置，10 Hz 够用。</summary>
    internal const int IdleIntervalMs = 100;
    /// <summary>有动画时两次投递之间的**最小**间隔（250 Hz）。DwmFlush 若立刻返回（合成暂停、远程会话），
    /// 没有这条兜底就会变成全速空转，把 CPU 打满。</summary>
    internal const int FloorMs = 4;
    /// <summary>位移积分的时间步上限（毫秒）：一次卡顿或一次空闲轮询（100 ms）不许让猪瞬移。
    /// 正常帧（165 Hz ≈ 6 ms）远低于它，所以这个夹取只在「从发呆切到走动」和真卡顿时生效。</summary>
    internal const int MoveStepMs = 20;

    /// <summary>这一帧之后还要等多久（毫秒）。elapsedMs = 刚才那次「等合成」已经花掉的时间。</summary>
    internal static int SleepFor(bool animating, int elapsedMs) {
        if (!animating) return IdleIntervalMs;
        if (elapsedMs < 0) return 0;
        int rest = FloorMs - elapsedMs;
        return rest > 0 ? rest : 0;
    }

    /// <summary>把「距上一帧的真实毫秒数」夹成可用的积分步长。首帧/时钟异常给一个 60 Hz 的典型值。</summary>
    internal static float MoveStep(float elapsedMs) {
        if (elapsedMs <= 0f || float.IsNaN(elapsedMs)) return 1000f / 60f;
        return elapsedMs > (float)MoveStepMs ? (float)MoveStepMs : elapsedMs;
    }
}

/// <summary>
/// 点击弹性：桌宠被**点一下**时的 squash & stretch。
///
/// 形状是衰减正弦 a(t) = A·e^(−t/τ)·sin(2πft)，屏幕上取 scaleX = 1 + a、scaleY = 1 − a ——
/// 面积近似守恒，读起来是「Q 弹一下再回正」。振幅、频率、时长都从猪圈 CSS 的观感反推（那边是 0.18 的手感），
/// 再按原生窗口 33ms 一帧的刷新率调到「看得见但不夸张」。
///
/// 抽成**静态纯函数**是为了能被 test/native/canvas-harness.cs 编译后直接断言（与 CanvasFit 同一套做法），
/// 而不是靠截图猜「看起来弹了没有」。
/// </summary>
internal static class PetSquish {
    /// <summary>整段时长（毫秒）：超过它就不再变形。</summary>
    internal const float DurationMs = 560f;
    /// <summary>起始振幅（比例）。峰值实际约 0.155（见 NativePath 的测试读数）。</summary>
    internal const float Amplitude = 0.24f;
    /// <summary>衰减时间常数（秒）：越小衰减越快。</summary>
    internal const float Tau = 0.22f;
    /// <summary>振荡频率（Hz）：560ms 里大约一个半来回。</summary>
    internal const float Frequency = 2.6f;

    /// <summary>点击与拖动/长按的分界：位移不超过它、且按下不超过 LongPressMs，才算「点了一下」。</summary>
    internal const float ClickSlopPx = 4f;
    internal const float LongPressMs = 900f;

    /// <summary>t 毫秒时的形变振幅 a（正 = 压扁、负 = 拉长）。区间外恒为 0。</summary>
    internal static float Wave(float elapsedMs) {
        if (elapsedMs <= 0f || elapsedMs >= DurationMs) return 0f;
        float t = elapsedMs / 1000f;
        float decay = (float)Math.Exp(-t / Tau);
        float osc = (float)Math.Sin(2.0 * Math.PI * Frequency * t);
        return Amplitude * decay * osc;
    }

    /// <summary>
    /// t 毫秒时的两个缩放系数（锚点由调用方施加：脚底中点）。
    ///
    /// 横向取 1+a、**纵向取它的倒数**，而不是 1−a —— 与走动那套 squash & stretch 同一条口径：面积守恒。
    /// 用 1−a 的话面积 = 1−a²，峰值时白丢 2.4%，肉眼是「猪变瘦了一点」而不是「被压了一下」。
    /// </summary>
    internal static void Scale(float elapsedMs, out float scaleX, out float scaleY) {
        float a = Wave(elapsedMs);
        scaleX = 1f + a;
        scaleY = 1f / scaleX;
    }

    /// <summary>这一次按下→松手算不算「点击」（而不是拖动或长按）。</summary>
    internal static bool IsClick(float dx, float dy, float elapsedMs, float slopPx) {
        float slop = slopPx > 0f ? slopPx : ClickSlopPx;
        return elapsedMs >= 0f && elapsedMs <= LongPressMs && dx * dx + dy * dy <= slop * slop;
    }
}

internal sealed class Pet {
    public string Id;
    public string Path;
    public Bitmap Sprite;
    /// <summary>按屏幕尺寸**预缩放**好的贴图（朝左）。Size 变了才重建：旧版每帧都从原图重采样一次。</summary>
    public Bitmap Scaled;
    /// <summary>预缩放的镜像版（朝右走时用）。</summary>
    public Bitmap ScaledFlip;
    /// <summary>上面两份缓存是按哪个 Size 生成的；-1 = 还没有。</summary>
    public int ScaledFor = -1;
    public float X, Y;          // 屏幕坐标（左上角）
    public int Size;            // 宽度像素
    public long SpriteStamp;
    public bool Motion;
    public int Stars;
    public bool Walking;
    public float TargetX, TargetY;
    public long NextDecision;
    public bool FacingRight;
    /// <summary>上次被「点一下」的时刻（UtcMs，**long**：float 的 24 位尾数在 epoch 毫秒上误差约 131 秒）。-1 = 从没点过。</summary>
    public long SquishAtMs = -1L;
}

internal sealed class PetForm : Form {
    /// <summary>后台节拍线程投给本窗口的消息：该画下一帧了。所有窗口/位图操作仍在 UI 线程上做。</summary>
    private const int WM_FRAME = 0x0400 + 0x5150;
    private readonly string directory;
    private readonly JavaScriptSerializer json = new JavaScriptSerializer();
    private readonly Dictionary<string, Pet> pets = new Dictionary<string, Pet>();
    /// <summary>常驻合成面：画布矩形不变就一直是同一块 DIB（旧版每帧 GetHbitmap，见 Native.Surface）。</summary>
    private Native.Surface surface;

    /* ---- 帧节拍（2026-11-17 重写）----
     * 旧版 System.Windows.Forms.Timer(33ms)：WM_TIMER 的分辨率跟着系统时钟走，实测帧间隔 31.6 ms、
     * 上限 30 fps。现在由 pacer 线程按合成节拍驱动（DwmFlush 一次 = 一次 vblank），上限就是显示器刷新率。
     * 线程只发消息、不碰窗口；画面该不该重画由「视觉签名」决定（见 Signature）。
     * */
    private Thread pacer;
    private volatile bool pacerStop;
    /// <summary>这一帧之后按什么节拍走：true = 有动画（合成节拍），false = 空闲（10 Hz）。</summary>
    private volatile bool fastMode;
    private int framePending;
    private readonly AutoResetEvent pacerWake = new AutoResetEvent(false);
    /// <summary>窗口句柄缓存：pacer 线程只读它，绝不在别的线程上碰 Form.Handle（那会在错的线程建窗口）。</summary>
    private IntPtr hwnd;
    private long lastFrameStamp;
    /// <summary>上一帧的「视觉签名」：一样就不重画也不重贴。</summary>
    private string lastSignature = "";
    /// <summary>画布刚重建 → 内容无效，下一帧必须重画。</summary>
    private bool canvasFresh;
    /* ---- 帧率统计（只在设置了 PIGHUB_PET_STATS 时写；默认完全不写）---- */
    private string statsFile;
    private long statFrames, statDrawn, statBusyFrames, statStartAt;
    private long statWindowAt;
    private long statDrawFirst, statDrawLast;
    private double statSumMs, statMaxMs;
    private double statRenderMs, statPresentMs;
    private double statDtSum, statDtMin, statDtMax;
    private long statDtCount;
    /// <summary>当前画布对应的**屏幕矩形**：它同时就是窗口矩形（位置与尺寸只经 UpdateLayeredWindow 生效）。</summary>
    private Rectangle canvasRect;
    private long petsStamp;
    private Pet dragging;
    private float dragDX, dragDY;
    /// <summary>按下的起点与时刻：松手时用它区分「点一下」和「拖动/长按」（点击 → 弹性，拖动 → 原来那套）。</summary>
    private Pet pressPet;
    private float pressX, pressY;
    private long pressAtMs;
    private bool pressMoved;
    private Bitmap cursorMask;
    private long lastReport;
    /// <summary>浏览器半报上来的猪圈矩形（屏幕坐标）：拖到里面松手 = 回猪圈。</summary>
    private Rectangle? penRect;
    /// <summary>这块矩形是什么时候量的（Unix 毫秒）：过期就不算数，见 PenTarget.TtlMs。</summary>
    private long penAtMs;
    /// <summary>星级胶囊的显示档位（off / hover / always），与面板的设置同一份。</summary>
    private string starMode = "hover";
    private Font badgeFont = new Font("Segoe UI", 9f, FontStyle.Bold);
    /// <summary>本窗口所在显示器的缩放（物理像素 / CSS px）。尺寸换算由原生侧负责，宿主只管 CSS px。</summary>
    private float dpiScale = 1f;

    /* ---- 气泡（pig-say 工具）----
     * 状态由宿主经 **commands.jsonl** 下发：一行 {"type":"say","id":"<猪>","text":"…","until":<Unix 毫秒>}。
     * 这是既有的命令通道（本来就是"一个目录几份文件"，不新开文件）；
     * 本进程只**追加**用户交互命令，所以读 side 每次按 mtime 全量重读、取**最后一条** say 行——
     * 不需要维护偏移量，也不会被宿主的追加打乱。until 用 Unix 毫秒，与宿主 Date.now() 同一坐标系。
     * 为什么不做成第二个 Form（NewMate 的 DesktopBubble 是独立窗口）：气泡必须**跟着猪走**，
     * 而猪的位置只活在这个进程里；同一个分层窗口逐帧重绘是唯一不用跨进程再同步一次坐标的做法。 */
    /// <summary>在说话的那只猪（空 = 没有气泡）。</summary>
    private string sayPetId = "";
    private string sayText = "";
    /// <summary>Unix 毫秒；到点自动不再绘制（不依赖宿主再发一条"隐藏"）。</summary>
    private long sayUntil = 0L;
    /// <summary>只用来量字；随窗口创建，随窗口结束释放。</summary>
    private Graphics bubbleGraphics;
    private Font bubbleFont;
    private float bubbleFontScale = -1f;
    /// <summary>单字宽度缓存：200 字 × 30fps 若每帧都 MeasureString，会白烧 CPU。</summary>
    private readonly Dictionary<char, float> charWidths = new Dictionary<char, float>();
    private string wrapKey = "";
    private List<string> wrapLines = new List<string>();
    /// <summary>本帧的气泡布局（**屏幕**坐标；Render 里再减 canvasRect 换算成客户区）。</summary>
    private bool bubbleVisible = false;
    private Rectangle bubbleBox;
    private int bubbleTailX, bubbleTailSize, bubblePadX, bubblePadY, bubbleRadius, bubbleLineHeight;
    private bool bubbleTailUp;
    /// <summary>commands.jsonl 的 mtime：变了才重读（每帧重读整份文件是浪费）。</summary>
    private long sayStamp;
    private static readonly long EpochShiftMs = 62135596800000L; // 0001-01-01 → 1970-01-01

    public PetForm(string dir) {
        this.directory = dir;
        Text = "PigHub";
        FormBorderStyle = FormBorderStyle.None;
        ShowInTaskbar = false;
        StartPosition = FormStartPosition.Manual;
        TopMost = true;
        AutoScaleMode = AutoScaleMode.None;
        BackColor = Color.Black;
        Shown += delegate {
            // 句柄一旦拿到就缓存：pacer 线程只用这个值投消息（绝不跨线程读 Form.Handle）。
            hwnd = Handle;
            try {
                int dpi = Native.GetDpiForWindow(hwnd);
                if (dpi > 0) dpiScale = dpi / 96f;
            } catch (Exception) { }
            statsFile = Environment.GetEnvironmentVariable("PIGHUB_PET_STATS");
            statStartAt = UtcMs();
            statWindowAt = Stopwatch.GetTimestamp();
            LoadPets();
            FrameTick();
            StartPacer();
        };
        FormClosed += delegate {
            StopPacer();
            // 进程马上要退，但把 GDI 对象还回去是「谁申请谁释放」的基本纪律（也方便测泄漏）。
            if (surface != null) { surface.Dispose(); surface = null; }
            ReleaseBubbleTools();
        };
    }

    protected override bool ShowWithoutActivation { get { return true; } }
    // TOPMOST | LAYERED | TOOLWINDOW | NOACTIVATE
    protected override CreateParams CreateParams {
        get {
            CreateParams cp = base.CreateParams;
            // TOPMOST | LAYERED | TOOLWINDOW | NOACTIVATE
            cp.ExStyle |= 0x08080088;
            // CS_DBLCLKS：没有这个类样式，Windows 根本不会发 WM_LBUTTONDBLCLK（双击回圈就永远不会触发）。
            cp.ClassStyle |= 0x8;
            return cp;
        }
    }

    private string PetsFile { get { return System.IO.Path.Combine(directory, "pets.json"); } }
    private string StopFile { get { return System.IO.Path.Combine(directory, "stop"); } }
    private string PositionsFile { get { return System.IO.Path.Combine(directory, "positions.json"); } }
    private string CommandsFile { get { return System.IO.Path.Combine(directory, "commands.jsonl"); } }

    private void LoadPets() {
        try {
            if (!File.Exists(PetsFile)) return;
            long stamp = File.GetLastWriteTimeUtc(PetsFile).Ticks;
            if (stamp == petsStamp) return;
            // stamp **解析成功之后**才记：文件正被宿主改写时可能读到半截 JSON，
            // 提前记下 stamp 就等于再也不重读这一版（气泡永远不出现的那种静默故障）。
            object raw = json.DeserializeObject(File.ReadAllText(PetsFile));
            Dictionary<string, object> root = raw as Dictionary<string, object>;
            if (root == null) return;
            petsStamp = stamp;
            object starModeValue;
            if (root.TryGetValue("starMode", out starModeValue) && starModeValue != null) starMode = Convert.ToString(starModeValue);
            object pen;
            if (root.TryGetValue("pen", out pen)) {
                Dictionary<string, object> r = pen as Dictionary<string, object>;
                if (r != null) {
                    penRect = new Rectangle(
                        Convert.ToInt32(r["left"]), Convert.ToInt32(r["top"]),
                        Convert.ToInt32(r["width"]), Convert.ToInt32(r["height"]));
                    object at;
                    penAtMs = r.TryGetValue("at", out at) && at != null ? Convert.ToInt64(at) : 0L;
                }
            } else {
                penRect = null;
                penAtMs = 0L;
            }
            object list;
            if (!root.TryGetValue("pets", out list)) return;
            object[] items = list as object[];
            if (items == null) return;
            HashSet<string> seen = new HashSet<string>();
            foreach (object item in items) {
                Dictionary<string, object> row = item as Dictionary<string, object>;
                if (row == null) continue;
                string id = Convert.ToString(row["id"]);
                string path = Convert.ToString(row["path"]);
                if (id == null || id.Length == 0 || path == null || !File.Exists(path)) continue;
                seen.Add(id);
                Pet pet;
                bool newPet = !pets.TryGetValue(id, out pet);
                if (newPet) { pet = new Pet(); pet.Id = id; pets[id] = pet; }
                pet.Path = path;
                long spriteStamp = File.GetLastWriteTimeUtc(path).Ticks;
                if (pet.SpriteStamp != spriteStamp) {
                    ReleaseSprites(pet);
                    pet.Sprite = new Bitmap(path);
                    pet.SpriteStamp = spriteStamp;
                }
                // pets.json 里的 size 是 **CSS px**（= sizeRatio）；这里按本窗口的 DPI 换成物理像素。
                // 之前是宿主乘 devicePixelRatio 再下发，面板没打开过就会拿到 dpr=1 → 桌宠只有一半大。
                pet.Size = Math.Max(24, (int)Math.Round(Convert.ToInt32(row["size"]) * dpiScale));
                // 只在**第一次看到这只猪**时采纳文件里的坐标；已在走动的猪保持自己的位置。
                // 否则每次 sync（改运动开关、星级、penRect…）都会把它拽回上一版坐标 —— 那是一次闪现。
                if (newPet) {
                    pet.X = Convert.ToSingle(row["x"]);
                    pet.Y = Convert.ToSingle(row["y"]);
                }
                pet.Motion = Convert.ToBoolean(row["motion"]);
                object stars;
                pet.Stars = row.TryGetValue("stars", out stars) && stars != null ? Math.Max(0, Convert.ToInt32(stars)) : 0;
                pet.NextDecision = 0;
            }
            List<string> gone = new List<string>();
            foreach (string id in pets.Keys) if (!seen.Contains(id)) gone.Add(id);
            foreach (string id in gone) { ReleaseSprites(pets[id]); pets.Remove(id); }
        } catch (Exception) { /* 文件正在被替换：下一帧再读 */ }
    }

    /// <summary>释放一只猪的全部位图（原图 + 预缩放缓存）；缓存不跟着老贴图走就是内存泄漏。</summary>
    private static void ReleaseSprites(Pet pet) {
        if (pet.Sprite != null) { pet.Sprite.Dispose(); pet.Sprite = null; }
        if (pet.Scaled != null) { pet.Scaled.Dispose(); pet.Scaled = null; }
        if (pet.ScaledFlip != null) { pet.ScaledFlip.Dispose(); pet.ScaledFlip = null; }
        pet.ScaledFor = -1;
    }

    /* ------------------------------ 帧节拍（pacer） ------------------------------
     * 线程只做一件事：按节拍投一条 WM_FRAME 给本窗口。
     *   - 有动画：DwmFlush() 阻塞到下一次显示器合成 → 帧率上限 = 刷新率（本机 165 Hz）；
     *   - 没动画：10 Hz 轮询（读文件 mtime、回报位置），静止的猪不该每秒被合成 165 次；
     *   - 上一条帧消息没处理完就不投下一条：UI 线程慢的时候宁丢帧，也不要堆一队消息。
     * 窗口与位图操作全部留在 UI 线程（跨线程碰 HWND 是不受支持的写法）。
     * */
    private void StartPacer() {
        Native.timeBeginPeriod(1);          // Sleep/WaitOne 的精度到 ~1 ms（空闲节拍与兜底等待都靠它）
        pacerStop = false;
        pacer = new Thread(PaceLoop);
        pacer.IsBackground = true;          // 宿主强杀时不拖住进程退出
        pacer.Name = "pighub-pet-pacer";
        pacer.Start();
    }

    private void StopPacer() {
        pacerStop = true;
        try { pacerWake.Set(); } catch (Exception) { }
        Thread thread = pacer;
        pacer = null;
        if (thread != null) thread.Join(300);
        try { Native.timeEndPeriod(1); } catch (Exception) { }
    }

    private void PaceLoop() {
        while (!pacerStop) {
            if (fastMode) {
                long started = Stopwatch.GetTimestamp();
                try { Native.DwmFlush(); } catch (Exception) { }
                int rest = FrameCadence.SleepFor(true, ElapsedMs(started));
                if (rest > 0) pacerWake.WaitOne(rest);
            } else {
                pacerWake.WaitOne(FrameCadence.IdleIntervalMs);
            }
            if (pacerStop) return;
            PostFrame();
        }
    }

    private static int ElapsedMs(long since) {
        long ticks = Stopwatch.GetTimestamp() - since;
        return (int)(ticks * 1000L / Stopwatch.Frequency);
    }

    private void PostFrame() {
        if (Interlocked.CompareExchange(ref framePending, 1, 0) != 0) return;
        IntPtr target = hwnd;
        if (target == IntPtr.Zero || !Native.PostMessage(target, WM_FRAME, IntPtr.Zero, IntPtr.Zero)) {
            Interlocked.Exchange(ref framePending, 0);
        }
    }

    /// <summary>处理一条帧消息：算出「距上一帧真实过了多少毫秒」，再交给 Frame。</summary>
    private void FrameTick() {
        long now = Stopwatch.GetTimestamp();
        long previous = lastFrameStamp;
        lastFrameStamp = now;
        float dtMs = previous == 0L ? 1000f / 60f : (now - previous) * 1000f / Stopwatch.Frequency;
        if (previous != 0L) {
            // 帧间隔本身也是读数：它落在 1000/刷新率 附近，才说明是「顶满显示上限」而不是碰巧快。
            if (dtMs > statDtMax) statDtMax = dtMs;
            if (statDtCount == 0L || dtMs < statDtMin) statDtMin = dtMs;
            statDtSum += dtMs;
            statDtCount += 1;
        }
        Frame(FrameCadence.MoveStep(dtMs));
    }

    /// <summary>一只猪的渲染高度（物理像素）：贴图紧裁到猪身，宽高比决定高度。</summary>
    private static float PetHeight(Pet pet) {
        if (pet.Sprite == null) return pet.Size;
        return pet.Size * (pet.Sprite.Height / (float)pet.Sprite.Width);
    }

    /// <summary>蹦跳相位 0..1（0 = 触地、1 = 最高点）：周期 π×90 ms ≈ 283 ms，与猪圈 CSS 同一节拍。</summary>
    private static float HopUnit() {
        return (float)Math.Abs(Math.Sin(Environment.TickCount % 100000 / 90.0));
    }

    /// <summary>这一帧之后要不要按合成节拍跑：只要还有东西在动就算。</summary>
    private bool animatingNow(long nowMs) {
        if (dragging != null) return true;
        if (bubbleVisible) return true;
        foreach (Pet pet in pets.Values) {
            if (pet.Walking) return true;
            if (pet.SquishAtMs >= 0L && nowMs - pet.SquishAtMs < (long)PetSquish.DurationMs) return true;
        }
        return false;
    }

    /// <summary>星级胶囊会盖在哪只猪身上（星档不是 always 时按光标位置判）。空串 = 谁都不盖。</summary>
    private string HoveredBadgeId() {
        System.Drawing.Point cursor = PointToClient(Cursor.Position);
        foreach (Pet pet in pets.Values) {
            if (pet.Stars < 1 || pet.Sprite == null) continue;
            int x = (int)Math.Round(pet.X - canvasRect.Left);
            int y = (int)Math.Round(pet.Y - canvasRect.Top);
            int w = pet.Size;
            int h = (int)Math.Round(PetHeight(pet));
            if (cursor.X >= x && cursor.X <= x + w && cursor.Y >= y && cursor.Y <= y + h) return pet.Id;
        }
        return "";
    }

    /// <summary>
    /// 这一帧的「视觉签名」：只装**会改变像素**的东西。和上一帧一样就既不重画也不重贴 ——
    /// 旧版每帧无条件重画整块画布，静止的猪也在被合成 30 次/秒；换到 165 Hz 就成了白白烧 CPU。
    /// 漏一项的后果是「状态变了、画面停在上一帧」，所以凡是参与渲染的状态都必须进这个签名
    /// （画布矩形、气泡、星档、每只猪的位置/朝向/星级/蹦跳相位/点击弹性相位、拖动中、悬停的猪）。
    /// </summary>
    private string Signature(long nowMs, bool animating) {
        StringBuilder text = new StringBuilder(256);
        text.Append(canvasRect.Left).Append(',').Append(canvasRect.Top).Append(',')
            .Append(canvasRect.Width).Append(',').Append(canvasRect.Height).Append('|');
        text.Append(bubbleVisible ? 1 : 0).Append(',').Append(bubbleBox.Left).Append(',')
            .Append(bubbleBox.Top).Append(',').Append(bubbleBox.Width).Append(',')
            .Append(bubbleBox.Height).Append(',').Append(bubbleTailX).Append(',')
            .Append(bubbleTailUp ? 1 : 0).Append('|');
        text.Append(starMode).Append('|');
        int hopBucket = (int)(HopUnit() * 64f);
        foreach (Pet pet in pets.Values) {
            text.Append(pet.Id).Append(',')
                .Append((int)Math.Round(pet.X)).Append(',').Append((int)Math.Round(pet.Y)).Append(',')
                .Append(pet.Walking ? 1 : 0).Append(',').Append(pet.FacingRight ? 1 : 0).Append(',')
                .Append(pet.Stars).Append(',');
            if (pet.Walking) text.Append(hopBucket);        // 位置没动也要重画：蹦跳是纯相位
            text.Append(',');
            long clickAge = pet.SquishAtMs >= 0L ? nowMs - pet.SquishAtMs : -1L;
            text.Append(clickAge >= 0L && clickAge < (long)PetSquish.DurationMs ? clickAge : -1L).Append(';');
        }
        if (dragging != null) text.Append("drag:").Append(dragging.Id);
        if (starMode != "always") text.Append("hover:").Append(HoveredBadgeId());
        return text.ToString();
    }

    /// <summary>
    /// 每秒一行帧率读数（**只有**环境变量 PIGHUB_PET_STATS 给了路径才写，默认一行都不写）。
    /// 口径：frames = 处理过的帧消息；drawn = 真的重画并重贴的次数；
    /// drawFps = 相邻两次重画间隔的倒数（发呆的那一秒它是 0，走动的那一秒才是刷新率）。
    /// </summary>
    private void WriteStats(long nowStamp) {
        if (statsFile == null || statsFile.Length == 0) return;
        double windowMs = (nowStamp - statWindowAt) * 1000.0 / Stopwatch.Frequency;
        if (windowMs < 1000.0) return;
        statWindowAt = nowStamp;
        double drawFps = statDrawn > 1 && statDrawLast > statDrawFirst
            ? (statDrawn - 1) * 1000.0 / ((statDrawLast - statDrawFirst) * 1000.0 / Stopwatch.Frequency)
            : 0.0;
        StringBuilder row = new StringBuilder(220);
        row.Append("{\"t\":").Append(UtcMs())
            .Append(",\"uptimeMs\":").Append(UtcMs() - statStartAt)
            .Append(",\"frames\":").Append(statFrames)
            .Append(",\"drawn\":").Append(statDrawn)
            .Append(",\"busyFrames\":").Append(statBusyFrames)
            .Append(",\"drawFps\":").Append(Format(drawFps))
            .Append(",\"avgFrameMs\":").Append(Format(statFrames > 0 ? statSumMs / statFrames : 0.0))
            .Append(",\"maxFrameMs\":").Append(Format(statMaxMs))
            .Append(",\"renderMs\":").Append(Format(statDrawn > 0 ? statRenderMs / statDrawn : 0.0))
            .Append(",\"presentMs\":").Append(Format(statDrawn > 0 ? statPresentMs / statDrawn : 0.0))
            .Append(",\"dtAvgMs\":").Append(Format(statDtCount > 0 ? statDtSum / statDtCount : 0.0))
            .Append(",\"dtMinMs\":").Append(Format(statDtCount > 0 ? statDtMin : 0.0))
            .Append(",\"dtMaxMs\":").Append(Format(statDtMax))
            .Append(",\"pets\":").Append(pets.Count)
            .Append(",\"canvas\":\"").Append(canvasRect.Width).Append("x").Append(canvasRect.Height).Append("\"}")
            .Append(Environment.NewLine);
        try { File.AppendAllText(statsFile, row.ToString()); } catch (Exception) { statsFile = null; }
        statFrames = 0; statDrawn = 0; statBusyFrames = 0; statSumMs = 0; statMaxMs = 0;
        statRenderMs = 0; statPresentMs = 0;
        statDtSum = 0; statDtMin = 0; statDtMax = 0; statDtCount = 0;
        statDrawFirst = 0; statDrawLast = 0;
    }

    private static string Format(double value) {
        return value.ToString("0.###", System.Globalization.CultureInfo.InvariantCulture);
    }

    private void Frame(float dtMs) {
        long frameStamp = Stopwatch.GetTimestamp();
        if (File.Exists(StopFile)) { StopPacer(); ReleaseBubbleTools(); Close(); return; }
        LoadPets();
        LoadSay();
        long now = DateTime.UtcNow.Ticks / 10000;
        long nowMs = UtcMs();
        float minX = float.MaxValue, minY = float.MaxValue, maxX = float.MinValue, maxY = float.MinValue;
        foreach (Pet pet in pets.Values) {
            float height = PetHeight(pet);
            if (pet != dragging) Step(pet, now, dtMs);
            if (pet.X < minX) minX = pet.X;
            if (pet.Y < minY) minY = pet.Y;
            if (pet.X + pet.Size > maxX) maxX = pet.X + pet.Size;
            if (pet.Y + height > maxY) maxY = pet.Y + height;
        }
        if (pets.Count == 0) { if (now - lastReport > 400) Report(now); return; }
        // 气泡先排版，再参与窗口 bounds：窗口只有"猪的包围盒 + margin"，气泡比 margin 高，
        // 不算进去就会被直接裁掉（NewMate 用独立窗口避开了这件事，我们同一个窗口就得自己算）。
        LayoutBubble(nowMs);
        if (bubbleVisible) {
            if (bubbleBox.Left < minX) minX = bubbleBox.Left;
            if (bubbleBox.Top < minY) minY = bubbleBox.Top;
            if (bubbleBox.Right > maxX) maxX = bubbleBox.Right;
            if (bubbleBox.Bottom > maxY) maxY = bubbleBox.Bottom;
        }
        const int margin = CanvasFit.Margin;
        Rectangle need = Rectangle.FromLTRB(
            (int)Math.Floor(minX) - margin, (int)Math.Floor(minY) - margin,
            (int)Math.Ceiling(maxX) + margin, (int)Math.Ceiling(maxY) + margin);
        if (need.Width < 64 || need.Height < 64) return;
        Rectangle fitted = CanvasFit.Fit(canvasRect, need, SystemInformation.VirtualScreen);
        if (fitted.Width < 64 || fitted.Height < 64) return;
        if (surface == null || fitted != canvasRect) {
            canvasRect = fitted;
            if (surface != null) surface.Dispose();
            surface = new Native.Surface(fitted.Width, fitted.Height);
            canvasFresh = true;   // 新画布 = 上一帧的像素已经没了，这一帧必须重画
        }
        bool animating = animatingNow(nowMs);
        // 画面和上一帧一模一样就不重画、不重贴：静止的猪不该每秒被合成 165 次。
        string signature = Signature(nowMs, animating);
        bool redraw = canvasFresh || signature != lastSignature;
        if (redraw) {
            long renderStamp = Stopwatch.GetTimestamp();
            Render();
            statRenderMs += (Stopwatch.GetTimestamp() - renderStamp) * 1000.0 / Stopwatch.Frequency;
            // 搬家与贴图**一次提交**：位置、尺寸、位图都交给 UpdateLayeredWindow。
            // 这里绝不能先写 Bounds 再 Present —— 那一帧窗口是新的、内容是旧的，整窗猪一起位移。
            long presentStamp = Stopwatch.GetTimestamp();
            Native.Present(hwnd, surface, new Native.Point(canvasRect.Left, canvasRect.Top));
            statPresentMs += (Stopwatch.GetTimestamp() - presentStamp) * 1000.0 / Stopwatch.Frequency;
            lastSignature = signature;
            canvasFresh = false;
            statDrawn += 1;
            if (statDrawFirst == 0L) statDrawFirst = frameStamp;
            statDrawLast = frameStamp;
        }
        fastMode = animating;
        if (animating) { try { pacerWake.Set(); } catch (Exception) { } }   // 从空闲节拍立刻切到合成节拍
        statFrames += 1;
        if (animating) statBusyFrames += 1;
        double costMs = (Stopwatch.GetTimestamp() - frameStamp) * 1000.0 / Stopwatch.Frequency;
        statSumMs += costMs;
        if (costMs > statMaxMs) statMaxMs = costMs;
        if (now - lastReport > 400) Report(now);
        WriteStats(frameStamp);
    }

    /// <summary>
    /// 走动积分。速度按**真实帧间隔**算（dtMs），不写死每帧 33 ms ——
    /// 旧版把 33 ms 塞进速度里，帧率一高猪就会快 5 倍（165/30）。
    /// </summary>
    private void Step(Pet pet, long now, float dtMs) {
        if (!pet.Motion || pet == dragging) { pet.Walking = false; return; }
        if (now >= pet.NextDecision) {
            pet.NextDecision = now + WalkTempo.DecisionMs;
            // 发呆权重 0.72，与插件内一致；走动时一步最多 3 个身位。
            if (Unity < WalkTempo.IdleWeight) { pet.Walking = false; return; }
            double angle = Unity * Math.PI * 2;
            float step = pet.Size * (1.65f + 1.35f * (float)Unity);
            pet.TargetX = pet.X + (float)Math.Cos(angle) * step;
            pet.TargetY = pet.Y + (float)Math.Sin(angle) * step;
            pet.Walking = true;
        }
        if (!pet.Walking) return;
        float dx = pet.TargetX - pet.X;
        float dy = pet.TargetY - pet.Y;
        float distance = (float)Math.Sqrt(dx * dx + dy * dy);
        // 速度 = 身位/秒 × 真实帧间隔。旧版把 33 ms 写死在算式里，帧间隔一变速度就跟着变 ——
        // 这也是旧版「写着 1 身位/秒、实际跑 0.70」的原因（见 WalkTempo.SpeedBodiesPerSecond）。
        float speed = pet.Size * WalkTempo.SpeedBodiesPerSecond * (dtMs / 1000f);
        if (distance <= speed) { pet.X = pet.TargetX; pet.Y = pet.TargetY; pet.Walking = false; return; }
        pet.X += dx / distance * speed;
        pet.Y += dy / distance * speed;
        pet.FacingRight = dx > 0;
        Rectangle area = Screen.FromPoint(new Point((int)pet.X, (int)pet.Y)).WorkingArea;
        pet.X = Math.Max(area.Left, Math.Min(area.Right - pet.Size, pet.X));
        pet.Y = Math.Max(area.Top, Math.Min(area.Bottom - pet.Size, pet.Y));
    }

    private static double Unity { get { return rng.NextDouble(); } }
    private static readonly Random rng = new Random();

    /// <summary>整帧重画：清空 → 气泡 → 所有猪。只有「视觉签名变了」才会走到这里（见 Frame）。</summary>
    private void Render() {
        Graphics g = surface.Graphics;
        g.ResetTransform();
        g.CompositingMode = CompositingMode.SourceOver;
        /* 贴图已经按屏幕尺寸预缩放好了，这一层只剩 ±6% 的 squash。插值模式不是随手挑的
         * （2026-11-17 实测，192×200 的贴图、同一块 DIB 目标、单次缩放绘制的耗时）：
         *   NearestNeighbor 0.18 ms / HighQualityBilinear 1.66 ms / HighQualityBicubic 2.09 ms /
         *   **Low 5.57 ms** —— GDI+ 的 Low 反而最慢（它走的是另一条软件重采样路径），
         *   而 1:1 的 DrawImageUnscaled 只要 0.08 ms。所以：不变形就 1:1 贴，变形才用 HighQualityBilinear。
         * 旧版每帧每只猪都用 HighQualityBicubic 从原图重采样，是 30 fps 下也吃掉大半颗核的原因之一。 */
        g.InterpolationMode = InterpolationMode.HighQualityBilinear;
        g.PixelOffsetMode = PixelOffsetMode.None;
        g.Clear(Color.Transparent);
        // 气泡先画：它按构造落在猪头顶之外，但"先画猪"会让任何一次几何失误直接盖住猪脸，
        // 而"不遮脸"是这条功能的硬要求 —— 让结构上做不到，而不是靠算术凑对。
        DrawBubble(g);
        DrawPets(g);
    }

    /// <summary>猪本体：走动节拍、点击弹性、星级胶囊。</summary>
    private void DrawPets(Graphics g) {
        long nowMs = UtcMs();
        foreach (Pet pet in pets.Values) {
            if (pet.Sprite == null) continue;
            int w = pet.Size;
            int h = (int)Math.Round(PetHeight(pet));
            // 走动节拍：HopUnit() 的周期 = π × 90ms ≈ 283ms（触地 → 最高点 → 触地），
            // 0 = 触地、1 = 最高点。位移弧与下面的 squash & stretch 共用这一个相位，天然同相。
            float hopUnit = HopUnit();
            float hop = pet.Walking ? hopUnit * pet.Size * 0.12f : 0f;
            int x = (int)Math.Round(pet.X - canvasRect.Left);
            int y = (int)Math.Round(pet.Y - canvasRect.Top - hop);
            // squash & stretch：与猪圈 .pighub-actor.is-walk 的 pighub-hop 同一套口径（纵向 .94 ↔ 1.06）。
            // 触地压扁（矮而宽）、最高点拉长（高而窄），横向取纵向的倒数 —— 面积守恒。
            // **锚点是脚底中点，不是盒子中心**：围绕中心缩会让脚在触地时往上收、起跳时往下探，
            // 读起来像「原地往上飘一下」；钉在脚底，地面那一条线才不动。
            const float squashSwing = 0.12f;   // 纵向总摆幅 = 0.12 → 0.94 … 1.06
            /* 两套形变**相乘**：
             *   ① 走动的是节拍（hopUnit 相位，触地压扁 / 最高点拉长）；
             *   ② 被点一下是衰减正弦（PetSquish，560ms 内 Q 弹一下）。
             * 相乘而不是二选一：边走边被点的时候，两者都该有。锚点仍是脚底中点，
             * 所以压扁时地面那条线不动（围绕盒子中心缩会让脚往上收，读起来像「飘」）。 */
            float scaleY = pet.Walking ? 1f + squashSwing * (hopUnit - 0.5f) : 1f;
            float scaleX = 1f / scaleY;
            if (pet.SquishAtMs >= 0L) {
                float clickMs = (float)(nowMs - pet.SquishAtMs);
                if (clickMs >= 0f && clickMs < PetSquish.DurationMs) {
                    float clickX, clickY;
                    PetSquish.Scale(clickMs, out clickX, out clickY);
                    scaleX *= clickX;
                    scaleY *= clickY;
                }
            }
            bool deformed = Math.Abs(scaleX - 1f) > 0.0005f || Math.Abs(scaleY - 1f) > 0.0005f;
            if (deformed) {
                float footX = x + w * 0.5f;
                float footY = y + h;           // 未缩放盒子的底边 = 脚底
                g.TranslateTransform(footX, footY);
                g.ScaleTransform(scaleX, scaleY);
                g.TranslateTransform(-footX, -footY);
            }
            // 预缩放 + 预镜像缓存：没变形时就是一次 1:1 blit，不再走重采样。
            Bitmap sprite = SpriteFor(pet);
            if (deformed) {
                g.DrawImage(sprite, new Rectangle(x, y, w, h));
            } else {
                g.DrawImageUnscaled(sprite, x, y);
            }
            // 星级胶囊不跟着压扁（文字被缩放会发虚），所以先把变换还原再画它。
            if (deformed) g.ResetTransform();
            DrawBadge(g, pet, x, y, w, h);
        }
    }

    /// <summary>
    /// 取这只猪**已经缩放到屏幕物理尺寸**的贴图（必要时现建，Size 变了才重建）。
    /// 旧版每帧都用 HighQualityBicubic 把原图缩到目标尺寸：4 只猪 × 165 帧/秒 = 每秒 660 次重采样。
    /// 镜像是另一份缓存 —— 朝右走不该每帧翻一次。
    /// </summary>
    private Bitmap SpriteFor(Pet pet) {
        if (pet.Scaled != null && pet.ScaledFor == pet.Size) {
            return pet.FacingRight ? pet.ScaledFlip : pet.Scaled;
        }
        if (pet.Scaled != null) { pet.Scaled.Dispose(); pet.Scaled = null; }
        if (pet.ScaledFlip != null) { pet.ScaledFlip.Dispose(); pet.ScaledFlip = null; }
        int w = Math.Max(1, pet.Size);
        int h = Math.Max(1, (int)Math.Round(PetHeight(pet)));
        pet.Scaled = ScaleSprite(pet.Sprite, w, h, false);
        pet.ScaledFlip = ScaleSprite(pet.Sprite, w, h, true);
        pet.ScaledFor = pet.Size;
        return pet.FacingRight ? pet.ScaledFlip : pet.Scaled;
    }

    /// <summary>把原图缩到目标尺寸一次（预乘 alpha 目标 + 源复制：透明处保持透明）。</summary>
    private static Bitmap ScaleSprite(Bitmap source, int w, int h, bool flip) {
        Bitmap target = new Bitmap(w, h, PixelFormat.Format32bppPArgb);
        using (Graphics g = Graphics.FromImage(target)) {
            g.InterpolationMode = InterpolationMode.HighQualityBicubic;   // 缩一次，代价只付一次
            g.PixelOffsetMode = PixelOffsetMode.HighQuality;
            g.CompositingMode = CompositingMode.SourceCopy;
            g.Clear(Color.Transparent);
            if (flip) {
                g.TranslateTransform(w, 0f);
                g.ScaleTransform(-1f, 1f);
            }
            g.DrawImage(source, new Rectangle(0, 0, w, h));
        }
        return target;
    }

    /* ------------------------------- 气泡（pig-say） -------------------------------
     * 样式对齐 NewMate 的 DesktopBubble（newmark2dsh computeruse/lib/desktop-pet.cs:352-395）：
     * 同字体（Microsoft YaHei UI / 13px×DPI）、圆角 14×DPI、尾巴 10×DPI、浅底 (252,249,250,252)、
     * 细边 (65,80,90,110)、文字 (35,38,43)；宽度上限同为 292×DPI。
     * 三处**故意不同**，都写在 docs/DESKTOP-PET-NATIVE.md：
     *   ① 宽度按内容收窄（NewMate 固定 292），否则「猪猪来了」四个字也占一屏；
     *   ② 高度不封顶到 130×DPI（NewMate 会把长句裁掉，而我们承诺 200 字必须显示完）；
     *   ③ 加一层柔和投影（NewMate 只有细边）—— 任务要求「阴影」。
     */

    /// <summary>
    /// 读 commands.jsonl，取**最后一条** say 命令。整份重读（按 mtime 缓存），这样
    /// 宿主追加的行与本进程追加的行混在同一个文件里也不会错位；坏行直接跳过。
    /// </summary>
    private void LoadSay() {
        try {
            if (!File.Exists(CommandsFile)) return;
            long stamp = File.GetLastWriteTimeUtc(CommandsFile).Ticks;
            if (stamp == sayStamp) return;
            sayStamp = stamp;
            string[] lines = File.ReadAllLines(CommandsFile);
            string target = "";
            string body = "";
            long until = 0L;
            bool found = false;
            for (int i = 0; i < lines.Length; i++) {
                string line = lines[i];
                if (line.Length == 0 || line.IndexOf("\"say\"", StringComparison.Ordinal) < 0) continue;
                try {
                    Dictionary<string, object> row = json.DeserializeObject(line) as Dictionary<string, object>;
                    if (row == null) continue;
                    object type;
                    if (!row.TryGetValue("type", out type) || type == null || Convert.ToString(type) != "say") continue;
                    object text;
                    if (!row.TryGetValue("text", out text) || text == null) continue;
                    object id;
                    object untilValue;
                    target = row.TryGetValue("id", out id) && id != null ? Convert.ToString(id) : "";
                    body = Convert.ToString(text);
                    until = row.TryGetValue("until", out untilValue) && untilValue != null ? Convert.ToInt64(untilValue) : 0L;
                    found = true;
                } catch (Exception) { /* 半截行：等下一次追加再读 */ }
            }
            if (!found) return;
            sayPetId = target;
            sayText = body;
            sayUntil = until;
        } catch (Exception) { /* 文件正在被替写：下一帧再读 */ }
    }

    private static long UtcMs() { return DateTime.UtcNow.Ticks / 10000L - EpochShiftMs; }

    private static bool IsWordChar(char c) {
        return (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9')
            || c == '_' || c == '-' || c == '/' || c == '.' || c == ':' || c == '%' || c == '&' || c == '=' || c == '\'';
    }

    private void EnsureBubbleTools() {
        float scale = dpiScale > 0f ? dpiScale : 1f;
        if (bubbleGraphics == null) bubbleGraphics = CreateGraphics();
        if (bubbleFont == null || bubbleFontScale != scale) {
            if (bubbleFont != null) bubbleFont.Dispose();
            bubbleFont = new Font("Microsoft YaHei UI", 13f * scale, FontStyle.Regular, GraphicsUnit.Pixel);
            bubbleFontScale = scale;
            charWidths.Clear();
            wrapKey = "";
        }
    }

    private void ReleaseBubbleTools() {
        if (bubbleFont != null) { bubbleFont.Dispose(); bubbleFont = null; }
        if (bubbleGraphics != null) { bubbleGraphics.Dispose(); bubbleGraphics = null; }
        charWidths.Clear();
        wrapKey = "";
    }

    /// <summary>单字宽度（缓存）。中文按字宽折行就靠它：一次测量 200 次调用，之后每帧只查表。</summary>
    private float CharWidth(char c) {
        float width;
        if (charWidths.TryGetValue(c, out width)) return width;
        if (bubbleGraphics == null || bubbleFont == null) return 0f;
        width = bubbleGraphics.MeasureString(c.ToString(), bubbleFont, new PointF(0f, 0f), StringFormat.GenericTypographic).Width;
        if (width <= 0f) width = bubbleFont.Size * 0.5f;
        charWidths[c] = width;
        return width;
    }

    private float MeasureLine(string text) {
        float width = 0f;
        for (int i = 0; i < text.Length; i++) width += CharWidth(text[i]);
        return width;
    }

    /// <summary>取下一个不可再分的排版单位：西文连成一词，中日韩一字一词。</summary>
    private static string NextToken(string text, ref int index) {
        char c = text[index];
        if (IsWordChar(c)) {
            int start = index;
            while (index < text.Length && IsWordChar(text[index])) index++;
            return text.Substring(start, index - start);
        }
        index++;
        return c.ToString();
    }

    /// <summary>按字宽折行。结果按「文本 + 字号」缓存，猪走动时不重排。</summary>
    private List<string> WrapText(string text, float maxWidth) {
        string key = bubbleFontScale.ToString() + "|" + text;
        if (key == wrapKey && wrapLines.Count > 0) return wrapLines;
        List<string> lines = new List<string>();
        StringBuilder line = new StringBuilder();
        float width = 0f;
        int index = 0;
        while (index < text.Length) {
            char c = text[index];
            if (c == '\r') { index++; continue; }
            if (c == '\n') { lines.Add(line.ToString().TrimEnd()); line.Length = 0; width = 0f; index++; continue; }
            string token = NextToken(text, ref index);
            float tokenWidth = MeasureLine(token);
            if (line.Length > 0 && width + tokenWidth > maxWidth) {
                lines.Add(line.ToString().TrimEnd());
                line.Length = 0;
                width = 0f;
                if (token.Trim().Length == 0) continue;      // 行首不留空格
                if (token.Length > 1) {
                    // 整个词放不下就拆字塞（URL / 长单词不该撑出一行）
                    for (int i = 0; i < token.Length; i++) {
                        float cw = CharWidth(token[i]);
                        if (line.Length > 0 && width + cw > maxWidth) { lines.Add(line.ToString()); line.Length = 0; width = 0f; }
                        line.Append(token[i]);
                        width += cw;
                    }
                    continue;
                }
            }
            line.Append(token);
            width += tokenWidth;
        }
        lines.Add(line.ToString().TrimEnd());
        if (lines.Count == 0) lines.Add("");
        // 防御：200 字实测最多 10 行；多出来的直接丢，不许撑出屏幕。
        if (lines.Count > 16) lines.RemoveRange(16, lines.Count - 16);
        wrapKey = key;
        wrapLines = lines;
        return lines;
    }

    /// <summary>
    /// 算这一帧气泡落在哪儿（**屏幕坐标**）。锚点是猪头顶中央：气泡底边在头顶上方 gap + 尾巴高处，
    /// 尾巴尖指向头顶。头顶上方放不下（贴着屏幕上沿）就翻到脚下方、尾巴朝上——任何情况下都不压脸。
    /// </summary>
    private void LayoutBubble(long nowMs) {
        bubbleVisible = false;
        if (sayPetId.Length == 0 || sayText.Length == 0 || nowMs >= sayUntil) return;
        Pet pet;
        if (!pets.TryGetValue(sayPetId, out pet)) return;
        if (pet == null || pet.Sprite == null) return;
        EnsureBubbleTools();
        if (bubbleGraphics == null || bubbleFont == null) return;
        float scale = dpiScale > 0f ? dpiScale : 1f;
        bubblePadX = (int)Math.Round(16 * scale);
        bubblePadY = (int)Math.Round(12 * scale);
        bubbleRadius = (int)Math.Round(14 * scale);
        bubbleTailSize = Math.Max(6, (int)Math.Round(10 * scale));
        int gap = (int)Math.Round(6 * scale);
        int maxWidth = (int)Math.Round(292 * scale);
        int minWidth = (int)Math.Round(140 * scale);
        int edge = (int)Math.Round(6 * scale);
        List<string> lines = WrapText(sayText, maxWidth - bubblePadX * 2);
        bubbleLineHeight = Math.Max(1, (int)Math.Round(bubbleFont.GetHeight(bubbleGraphics)));
        float widest = 0f;
        for (int i = 0; i < lines.Count; i++) {
            float w = MeasureLine(lines[i]);
            if (w > widest) widest = w;
        }
        int width = Math.Min(maxWidth, Math.Max(minWidth, (int)Math.Ceiling(widest) + bubblePadX * 2));
        int height = lines.Count * bubbleLineHeight + bubblePadY * 2;
        int petH = (int)Math.Round(pet.Size * (pet.Sprite.Height / (float)pet.Sprite.Width));
        int cx = (int)Math.Round(pet.X + pet.Size / 2f);
        int headTop = (int)Math.Round(pet.Y);
        int footBottom = (int)Math.Round(pet.Y) + petH;
        Rectangle area = Screen.FromPoint(new System.Drawing.Point((int)pet.X, (int)pet.Y)).WorkingArea;
        int x = cx - width / 2;
        if (x + width > area.Right - edge) x = area.Right - edge - width;
        if (x < area.Left + edge) x = area.Left + edge;
        int above = headTop - gap - bubbleTailSize - height;
        bool tailUp = above < area.Top + edge;
        int y = tailUp ? footBottom + gap + bubbleTailSize : above;
        if (y < area.Top + edge) y = area.Top + edge;
        if (y + height + bubbleTailSize > area.Bottom - edge) y = area.Bottom - edge - height - bubbleTailSize;
        bubbleTailX = Math.Max(bubbleRadius + bubbleTailSize, Math.Min(width - bubbleRadius - bubbleTailSize, cx - x));
        bubbleTailUp = tailUp;
        bubbleBox = new Rectangle(x, y, width, height);
        bubbleVisible = true;
    }

    /// <summary>圆角矩形 + 尾巴三角，一笔画成（两段分开画会露出接缝）。</summary>
    private static GraphicsPath BubblePath(Rectangle box, int tailX, int tail, int radius, bool tailUp) {
        float d = radius * 2f;
        float l = 1f;
        float t = 1f;
        float r = box.Width - 2f;
        float b = box.Height - 2f;
        GraphicsPath path = new GraphicsPath();
        // 先在「尾巴朝下、左上角为原点」的局部坐标里画
        path.AddArc(l, t, d, d, 180, 90);
        path.AddArc(r - d, t, d, d, 270, 90);
        path.AddArc(r - d, b - d, d, d, 0, 90);
        path.AddLine(r - radius, b, tailX + tail, b);
        path.AddLine(tailX + tail, b, tailX, b + tail - 1f);
        path.AddLine(tailX, b + tail - 1f, tailX - tail, b);
        path.AddArc(l, b - d, d, d, 90, 90);
        path.CloseFigure();
        Matrix transform = new Matrix();
        if (tailUp) {
            // 以盒子水平中线为轴翻转：局部 (x,y) → (box.X+x, box.Y+box.Height-y)
            transform.Translate(box.X, 0f, MatrixOrder.Append);
            transform.Scale(1f, -1f, MatrixOrder.Append);
            transform.Translate(0f, box.Y + box.Height, MatrixOrder.Append);
        } else {
            transform.Translate(box.X, box.Y, MatrixOrder.Append);
        }
        path.Transform(transform);
        transform.Dispose();
        return path;
    }

    private void DrawBubble(Graphics g) {
        if (!bubbleVisible || wrapLines.Count == 0) return;
        float scale = dpiScale > 0f ? dpiScale : 1f;
        Rectangle box = new Rectangle(bubbleBox.Left - canvasRect.Left, bubbleBox.Top - canvasRect.Top, bubbleBox.Width, bubbleBox.Height);
        g.SmoothingMode = SmoothingMode.AntiAlias;
        using (GraphicsPath path = BubblePath(box, bubbleTailX, bubbleTailSize, bubbleRadius, bubbleTailUp)) {
            // 投影：同一条 path 连叠三次（不引 GDI+ blur，糊不到字上）
            for (int i = 1; i <= 3; i++) {
                using (GraphicsPath shadow = (GraphicsPath)path.Clone()) {
                    using (Matrix shift = new Matrix()) {
                        shift.Translate(0f, i * 1.5f * scale);
                        shadow.Transform(shift);
                    }
                    using (SolidBrush shade = new SolidBrush(Color.FromArgb(12, 20, 24, 32))) g.FillPath(shade, shadow);
                }
            }
            using (SolidBrush fill = new SolidBrush(Color.FromArgb(252, 249, 250, 252))) g.FillPath(fill, path);
            using (Pen pen = new Pen(Color.FromArgb(65, 80, 90, 110), Math.Max(1f, scale * 0.75f))) g.DrawPath(pen, path);
        }
        using (SolidBrush ink = new SolidBrush(Color.FromArgb(35, 38, 43))) {
            for (int i = 0; i < wrapLines.Count; i++) {
                g.DrawString(wrapLines[i], bubbleFont, ink,
                    new PointF(box.X + bubblePadX, box.Y + bubblePadY + i * bubbleLineHeight),
                    StringFormat.GenericTypographic);
            }
        }
        g.SmoothingMode = SmoothingMode.None;
    }

    /// <summary>星级胶囊：与面板共用 starMode（off / hover / always）。悬停判定用当前光标位置。</summary>
    private void DrawBadge(Graphics g, Pet pet, int x, int y, int w, int h) {
        if (pet.Stars < 1) return;
        if (starMode == "off") return;
        if (starMode != "always") {
            Point cursor = PointToClient(Cursor.Position);
            if (cursor.X < x || cursor.X > x + w || cursor.Y < y || cursor.Y > y + h) return;
        }
        string text = "\u2605" + pet.Stars;
        SizeF size = g.MeasureString(text, badgeFont);
        float bw = size.Width + 10f;
        float bh = size.Height + 2f;
        float bx = x + w - bw + 4f;
        float by = y - 2f;
        using (GraphicsPath path = new GraphicsPath()) {
            float r = bh / 2f;
            path.AddArc(bx, by, r * 2, bh, 90, 180);
            path.AddArc(bx + bw - r * 2, by, r * 2, bh, 270, 180);
            path.CloseFigure();
            using (SolidBrush fill = new SolidBrush(Color.FromArgb(215, 24, 26, 32))) g.FillPath(fill, path);
        }
        g.DrawString(text, badgeFont, Brushes.White, bx + 5f, by + 1f);
    }

    private void Report(long now) {
        lastReport = now;
        try {
            List<object> rows = new List<object>();
            foreach (Pet pet in pets.Values) rows.Add(new Dictionary<string, object> {
                { "id", pet.Id }, { "x", (int)Math.Round(pet.X) }, { "y", (int)Math.Round(pet.Y) }
            });
            File.WriteAllText(PositionsFile, json.Serialize(new Dictionary<string, object> {
                { "updatedAt", DateTime.UtcNow.ToString("o") }, { "pets", rows.ToArray() }
            }));
        } catch (Exception) { }
    }

    /// <summary>写一条命令给宿主。x/y 是这只猪**此刻的中心点**（物理像素），宿主用它换算猪圈内的落点。</summary>
    private string Command(string kind, Pet pet) {
        // 中心点必须按**素材自己的**宽高算：高度 = 宽度 × 纵横比，不能拿宽度当高度
        //（2026-11-13 实测：扁猪的落点因此偏低 44px）。
        int height = pet.Sprite == null ? pet.Size : (int)Math.Round(pet.Size * (pet.Sprite.Height / (float)pet.Sprite.Width));
        int cx = (int)Math.Round(pet.X + pet.Size / 2f);
        int cy = (int)Math.Round(pet.Y + height / 2f);
        return "{\"cmd\":\"" + kind + "\",\"id\":\"" + pet.Id.Replace("\"", "")
            + "\",\"x\":" + cx + ",\"y\":" + cy + ",\"at\":\"" + DateTime.UtcNow.ToString("o") + "\"}\n";
    }

    private Pet HitTest(int clientX, int clientY) {
        // 还没画出第一帧时不要把所有点击都判成"透明"，否则窗口在启动瞬间是穿透的。
        if (surface == null) return pets.Count > 0 ? FirstPet() : null;
        int x = clientX, y = clientY;
        if (x < 0 || y < 0 || x >= surface.Width || y >= surface.Height) return null;
        // 气泡不吃鼠标：点在气泡上等于点在桌面上（否则它 6 秒内会悄悄吞掉那块区域的点击）。
        if (bubbleVisible) {
            Rectangle box = new Rectangle(bubbleBox.Left - canvasRect.Left, bubbleBox.Top - canvasRect.Top, bubbleBox.Width, bubbleBox.Height);
            if (bubbleTailUp) box.Y -= bubbleTailSize; else box.Height += bubbleTailSize;
            if (box.Contains(x, y)) return null;
        }
        // 画布是常驻的 DIB：没重画说明画面内容没变，读它做命中测试依然是对的。
        Color pixel = surface.Bitmap.GetPixel(x, y);
        if (pixel.A < 24) return null;
        foreach (Pet pet in pets.Values) {
            if (pet.Sprite == null) continue;
            int w = pet.Size;
            int h = (int)Math.Round(PetHeight(pet));
            int px = (int)Math.Round(pet.X - canvasRect.Left);
            int py = (int)Math.Round(pet.Y - canvasRect.Top);
            if (x >= px && x <= px + w && y >= py && y <= py + h) return pet;
        }
        return null;
    }

    private Pet FirstPet() {
        foreach (Pet pet in pets.Values) return pet;
        return null;
    }

    protected override void WndProc(ref Message m) {
        const int WM_CAPTURECHANGED = 0x0215;
        const int WM_NCHITTEST = 0x0084;
        const int WM_LBUTTONDOWN = 0x0201;
        const int WM_LBUTTONUP = 0x0202;
        const int WM_MOUSEMOVE = 0x0200;
        const int WM_LBUTTONDBLCLK = 0x0203;
        const int WM_RBUTTONUP = 0x0205;
        if (m.Msg == WM_FRAME) {
            // pacer 投来的帧消息：先清 pending 再画 —— 画的过程中新的一条才有地方落。
            Interlocked.Exchange(ref framePending, 0);
            FrameTick();
            return;
        }
        if (m.Msg == WM_NCHITTEST) {
            // 屏幕坐标 → 客户区坐标 → 查 alpha：透明像素让鼠标穿过去。
            int sx = (short)(m.LParam.ToInt64() & 0xFFFF);
            int sy = (short)((m.LParam.ToInt64() >> 16) & 0xFFFF);
            Point screenPoint = PointToClient(new Point(sx, sy));
            m.Result = HitTest(screenPoint.X, screenPoint.Y) == null ? new IntPtr(-1) : new IntPtr(1);
            return;
        }
        // 鼠标消息的 LParam 是**客户区坐标**（只有 WM_NCHITTEST 是屏幕坐标）。
        // 2026-11-13 踩过的坑：这里又做了一次 PointToClient，坐标被窗口原点平移，
        // HitTest 永远落空 —— 表现就是"桌宠拖不动、右键也没反应"。
        Point client = new Point((short)(m.LParam.ToInt64() & 0xFFFF), (short)((m.LParam.ToInt64() >> 16) & 0xFFFF));
        if (m.Msg == WM_LBUTTONDOWN) {
            Pet hit = HitTest(client.X, client.Y);
            if (hit != null) {
                dragging = hit;
                dragDX = hit.X - (client.X + canvasRect.Left);
                dragDY = hit.Y - (client.Y + canvasRect.Top);
                hit.Walking = false;
                // 点击判定的起点：松手时用「位移 + 按下时长」区分『点一下』与『拖动/长按』。
                pressPet = hit;
                pressX = client.X;
                pressY = client.Y;
                pressAtMs = UtcMs();
                pressMoved = false;
                // 抓取期间要把鼠标事件留在本窗口（NOACTIVATE 窗口默认不会自动捕获），
                // 否则指针一离开这个小窗口，WM_MOUSEMOVE 就收不到了。
                Capture = true;
            }
            return;
        }
        if (m.Msg == WM_MOUSEMOVE && dragging != null) {
            dragging.X = client.X + canvasRect.Left + dragDX;
            dragging.Y = client.Y + canvasRect.Top + dragDY;
            dragging.Walking = false;
            // 鼠标按住后只要真的挪过（超过容差×DPI），这一次就不可能是「点一下」。
            if (!pressMoved) {
                float ddx = client.X - pressX;
                float ddy = client.Y - pressY;
                float slop = PetSquish.ClickSlopPx * Math.Max(1f, dpiScale);
                if (ddx * ddx + ddy * ddy > slop * slop) pressMoved = true;
            }
            return;
        }
        if (m.Msg == WM_LBUTTONUP) {
            // 先把引用取出来再释放捕获：`Capture = false` 会同步触发 WM_CAPTURECHANGED，
            // 那里面会把 dragging 清空——顺序反了的话，松手后的"拖回猪圈"判定永远拿不到猪（实测踩过）。
            Pet dropped = dragging;
            /* 必须**先**把点击判定的中间状态存成本地变量：`Capture = false` 会同步触发
             * WM_CAPTURECHANGED，那个分支会把 dragging/pressPet/pressMoved 一起清掉。
             * 2026-11-16 实测：写在后面时 pressPet 已经是 null，`pressPet == dropped` 恒 false ——
             * 表现就是「点了没反应」，而 debug 日志里 hit=pet、press=set 一切正常。 */
            Pet pressed = pressPet;
            bool movedDuringPress = pressMoved;
            long nowUp = UtcMs();
            dragging = null;
            Capture = false;
            if (dropped == null) { pressPet = null; return; }
            dropped.Walking = false;
            dropped.NextDecision = DateTime.UtcNow.Ticks / 10000 + 6000;
            /* 点一下 = 弹性（用户口径 2026-11-16：「猪猪在桌宠状态下没有点击弹性」）。
             * 判定要看三件事：按的是同一只、没挪过、按下到松手不超过 900ms ——
             * 否则一次「拖起来又放回原处」会被误判成点击，反而把它顶掉原来的落点语义。
             * 命中后**提前 return**：点击不该再触发「拖回猪圈」（那只猪可能正压在猪圈矩形上）。
             * 与猪圈里那只一致：不允许运动的猪不响应点击（那边 clickProps 也是按 pigCanMove 挂的）。 */
            float upDx = client.X - pressX;
            float upDy = client.Y - pressY;
            float upSlop = PetSquish.ClickSlopPx * Math.Max(1f, dpiScale);
            bool clicked = pressed == dropped && !movedDuringPress
                && PetSquish.IsClick(upDx, upDy, nowUp - pressAtMs, upSlop);
            pressPet = null;
            pressMoved = false;
            Report(0);
            if (clicked) {
                if (dropped.Motion) dropped.SquishAtMs = nowUp;
                return;
            }
            // 用户口径：支持"拖回猪圈"。猪圈矩形由浏览器半实测后经宿主下发。
            // 判定用**矩形相交**而不是"中心点落在圈里"：用户把猪头一段搭进猪圈就想让它回去，
            // 只测中心会导致"明明拖进去了却没返回"（真机反馈）。
            // 但**矩形必须还在续期**（用户口径 2026-11-17）：换到别的页面时那块屏幕区域不是猪圈，
            // 拖过去不许回圈 —— 没有续期的矩形按过期处理（见 PenTarget）。
            if (PenTarget.Usable(penRect.HasValue, penAtMs, UtcMs())) {
                int petW = dropped.Size;
                int petH = dropped.Sprite == null
                    ? dropped.Size
                    : (int)Math.Round(dropped.Size * (dropped.Sprite.Height / (float)dropped.Sprite.Width));
                Rectangle petBox = new Rectangle((int)Math.Round(dropped.X), (int)Math.Round(dropped.Y), petW, petH);
                if (petBox.IntersectsWith(penRect.Value)) {
                    try { File.AppendAllText(CommandsFile, Command("return", dropped)); } catch (Exception) { }
                }
            }
            return;
        }
        if (m.Msg == WM_LBUTTONDBLCLK) {
            Pet hit = HitTest(client.X, client.Y);
            if (hit != null) { try { File.AppendAllText(CommandsFile, Command("return", hit)); } catch (Exception) { } }
            return;
        }
        if (m.Msg == WM_RBUTTONUP) {
            Pet hit = HitTest(client.X, client.Y);
            if (hit != null) { try { File.AppendAllText(CommandsFile, Command("menu", hit)); } catch (Exception) { } }
            return;
        }
        if (m.Msg == WM_CAPTURECHANGED) {
            // 捕获被抢走（例如别的窗口抢焦点）时把拖拽状态清掉，避免"没按键却跟着鼠标走"。
            if (dragging != null) { dragging.Walking = false; Report(0); dragging = null; }
            pressPet = null;
            pressMoved = false;
            return;
        }
        base.WndProc(ref m);
    }
}

internal static class Program {
    [STAThread]
    private static void Main(string[] args) {
        try { Native.SetProcessDpiAwarenessContext(new IntPtr(-4)); } catch (Exception) { }
        Application.EnableVisualStyles();
        string directory = args.Length > 0 ? args[0] : System.IO.Path.GetTempPath();
        Application.Run(new PetForm(directory));
    }
}
