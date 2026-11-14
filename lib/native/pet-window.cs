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
using System.Web.Script.Serialization;
using System.Windows.Forms;

internal static class Native {
    [StructLayout(LayoutKind.Sequential)] internal struct Point { public int X, Y; public Point(int x, int y) { X = x; Y = y; } }
    [StructLayout(LayoutKind.Sequential)] internal struct Size { public int X, Y; public Size(int x, int y) { X = x; Y = y; } }
    [StructLayout(LayoutKind.Sequential, Pack = 1)] internal struct Blend { public byte Operation, Flags, Alpha, Format; }
    [StructLayout(LayoutKind.Sequential)] internal struct Rect { public int Left, Top, Right, Bottom; }

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

    internal static void Present(IntPtr hwnd, Bitmap canvas, Point location) {
        IntPtr screen = GetDC(IntPtr.Zero);
        IntPtr mem = CreateCompatibleDC(screen);
        IntPtr hbmp = canvas.GetHbitmap(Color.FromArgb(0));
        IntPtr old = SelectObject(mem, hbmp);
        try {
            Size size = new Size(canvas.Width, canvas.Height);
            Point src = new Point(0, 0);
            Blend blend = new Blend();
            blend.Operation = 0; blend.Flags = 0; blend.Alpha = 255; blend.Format = 1;
            UpdateLayeredWindow(hwnd, IntPtr.Zero, ref location, ref size, mem, ref src, 0, ref blend, 2);
        } finally {
            SelectObject(mem, old);
            DeleteObject(hbmp);
            DeleteDC(mem);
            ReleaseDC(IntPtr.Zero, screen);
        }
    }
}

internal sealed class Pet {
    public string Id;
    public string Path;
    public Bitmap Sprite;
    public float X, Y;          // 屏幕坐标（左上角）
    public int Size;            // 宽度像素
    public long SpriteStamp;
    public bool Motion;
    public int Stars;
    public bool Walking;
    public float TargetX, TargetY;
    public long NextDecision;
    public bool FacingRight;
}

internal sealed class PetForm : Form {
    private readonly string directory;
    private readonly Timer timer;
    private readonly JavaScriptSerializer json = new JavaScriptSerializer();
    private readonly Dictionary<string, Pet> pets = new Dictionary<string, Pet>();
    private Bitmap canvas;
    private long petsStamp;
    private Pet dragging;
    private float dragDX, dragDY;
    private Bitmap cursorMask;
    private long lastReport;
    /// <summary>浏览器半报上来的猪圈矩形（屏幕坐标）：拖到里面松手 = 回猪圈。</summary>
    private Rectangle? penRect;
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
    /// <summary>本帧的气泡布局（**屏幕**坐标；Render 里再减 Bounds 换算成客户区）。</summary>
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
        timer = new Timer();
        timer.Interval = 33;
        timer.Tick += delegate { Frame(); };
        Shown += delegate {
            try {
                int dpi = Native.GetDpiForWindow(Handle);
                if (dpi > 0) dpiScale = dpi / 96f;
            } catch (Exception) { }
            LoadPets();
            Frame();
            timer.Start();
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
                }
            } else {
                penRect = null;
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
                    if (pet.Sprite != null) pet.Sprite.Dispose();
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
            foreach (string id in gone) { if (pets[id].Sprite != null) pets[id].Sprite.Dispose(); pets.Remove(id); }
        } catch (Exception) { /* 文件正在被替换：下一帧再读 */ }
    }

    private void Frame() {
        if (File.Exists(StopFile)) { timer.Stop(); ReleaseBubbleTools(); Close(); return; }
        LoadPets();
        LoadSay();
        long now = DateTime.UtcNow.Ticks / 10000;
        long nowMs = UtcMs();
        float minX = float.MaxValue, minY = float.MaxValue, maxX = float.MinValue, maxY = float.MinValue;
        foreach (Pet pet in pets.Values) {
            float height = pet.Sprite == null ? pet.Size : pet.Size * (pet.Sprite.Height / (float)pet.Sprite.Width);
            if (pet != dragging) Step(pet, now);
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
        const int margin = 80;
        Rectangle bounds = Rectangle.FromLTRB(
            (int)Math.Floor(minX) - margin, (int)Math.Floor(minY) - margin,
            (int)Math.Ceiling(maxX) + margin, (int)Math.Ceiling(maxY) + margin);
        Rectangle screen = SystemInformation.VirtualScreen;
        bounds = Rectangle.Intersect(bounds, screen);
        if (bounds.Width < 64 || bounds.Height < 64) return;
        if (Bounds != bounds) {
            Bounds = bounds;
            if (canvas != null) canvas.Dispose();
            canvas = new Bitmap(bounds.Width, bounds.Height, PixelFormat.Format32bppArgb);
        }
        Render();
        Native.Present(Handle, canvas, new Native.Point(bounds.Left, bounds.Top));
        if (now - lastReport > 400) Report(now);
    }

    private void Step(Pet pet, long now) {
        if (!pet.Motion || pet == dragging) { pet.Walking = false; return; }
        if (now >= pet.NextDecision) {
            pet.NextDecision = now + 1700;
            // 发呆权重 0.72，与插件内一致；走动时一步最多 3 个身位。
            if (Unity < 0.72) { pet.Walking = false; return; }
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
        // 移动速度（像素/毫秒×尺寸）：1.6 → 1.0，用户口径 2026-11-13「运动的速度减慢」。
        float speed = pet.Size * 1.0f * (33f / 1000f);
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

    private void Render() {
        using (Graphics g = Graphics.FromImage(canvas)) {
            g.Clear(Color.Transparent);
            g.InterpolationMode = InterpolationMode.HighQualityBicubic;
            g.PixelOffsetMode = PixelOffsetMode.HighQuality;
            // 气泡先画：它按构造落在猪头顶之外，但"先画猪"会让任何一次几何失误直接盖住猪脸，
            // 而"不遮脸"是这条功能的硬要求 —— 让结构上做不到，而不是靠算术凑对。
            DrawBubble(g);
            foreach (Pet pet in pets.Values) {
                if (pet.Sprite == null) continue;
                int w = pet.Size;
                int h = (int)Math.Round(pet.Size * (pet.Sprite.Height / (float)pet.Sprite.Width));
                // 走动节拍：|sin(tick/90)| 的周期 = π × 90ms ≈ 283ms（触地 → 最高点 → 触地），
                // hopUnit = 0 触地、1 最高点。位移弧与下面的 squash & stretch 共用这一个相位，天然同相。
                float hopUnit = (float)Math.Abs(Math.Sin(Environment.TickCount % 100000 / 90.0));
                float hop = pet.Walking ? hopUnit * pet.Size * 0.12f : 0f;
                int x = (int)Math.Round(pet.X - Bounds.Left);
                int y = (int)Math.Round(pet.Y - Bounds.Top - hop);
                // squash & stretch：与猪圈 .pighub-actor.is-walk 的 pighub-hop 同一套口径（纵向 .94 ↔ 1.06）。
                // 触地压扁（矮而宽）、最高点拉长（高而窄），横向取纵向的倒数 —— 面积守恒。
                // **锚点是脚底中点，不是盒子中心**：围绕中心缩会让脚在触地时往上收、起跳时往下探，
                // 读起来像「原地往上飘一下」；钉在脚底，地面那一条线才不动。
                const float squashSwing = 0.12f;   // 纵向总摆幅 = 0.12 → 0.94 … 1.06
                bool squashing = pet.Walking;
                if (squashing) {
                    float scaleY = 1f + squashSwing * (hopUnit - 0.5f);
                    float footX = x + w * 0.5f;
                    float footY = y + h;           // 未缩放盒子的底边 = 脚底
                    g.TranslateTransform(footX, footY);
                    g.ScaleTransform(1f / scaleY, scaleY);
                    g.TranslateTransform(-footX, -footY);
                }
                if (pet.FacingRight) {
                    g.DrawImage(pet.Sprite, new Rectangle(x + w, y, -w, h));
                } else {
                    g.DrawImage(pet.Sprite, new Rectangle(x, y, w, h));
                }
                // 星级胶囊不跟着压扁（文字被缩放会发虚），所以先把变换还原再画它。
                if (squashing) g.ResetTransform();
                DrawBadge(g, pet, x, y, w, h);
            }
        }
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
        Rectangle box = new Rectangle(bubbleBox.Left - Bounds.Left, bubbleBox.Top - Bounds.Top, bubbleBox.Width, bubbleBox.Height);
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
        if (canvas == null) return pets.Count > 0 ? FirstPet() : null;
        int x = clientX, y = clientY;
        if (x < 0 || y < 0 || x >= canvas.Width || y >= canvas.Height) return null;
        // 气泡不吃鼠标：点在气泡上等于点在桌面上（否则它 6 秒内会悄悄吞掉那块区域的点击）。
        if (bubbleVisible) {
            Rectangle box = new Rectangle(bubbleBox.Left - Bounds.Left, bubbleBox.Top - Bounds.Top, bubbleBox.Width, bubbleBox.Height);
            if (bubbleTailUp) box.Y -= bubbleTailSize; else box.Height += bubbleTailSize;
            if (box.Contains(x, y)) return null;
        }
        Color pixel = canvas.GetPixel(x, y);
        if (pixel.A < 24) return null;
        foreach (Pet pet in pets.Values) {
            if (pet.Sprite == null) continue;
            int w = pet.Size;
            int h = (int)Math.Round(pet.Size * (pet.Sprite.Height / (float)pet.Sprite.Width));
            int px = (int)Math.Round(pet.X - Bounds.Left);
            int py = (int)Math.Round(pet.Y - Bounds.Top);
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
                dragDX = hit.X - (client.X + Bounds.Left);
                dragDY = hit.Y - (client.Y + Bounds.Top);
                hit.Walking = false;
                // 抓取期间要把鼠标事件留在本窗口（NOACTIVATE 窗口默认不会自动捕获），
                // 否则指针一离开这个小窗口，WM_MOUSEMOVE 就收不到了。
                Capture = true;
            }
            return;
        }
        if (m.Msg == WM_MOUSEMOVE && dragging != null) {
            dragging.X = client.X + Bounds.Left + dragDX;
            dragging.Y = client.Y + Bounds.Top + dragDY;
            dragging.Walking = false;
            return;
        }
        if (m.Msg == WM_LBUTTONUP) {
            // 先把引用取出来再释放捕获：`Capture = false` 会同步触发 WM_CAPTURECHANGED，
            // 那里面会把 dragging 清空——顺序反了的话，松手后的"拖回猪圈"判定永远拿不到猪（实测踩过）。
            Pet dropped = dragging;
            dragging = null;
            Capture = false;
            if (dropped == null) return;
            dropped.Walking = false;
            dropped.NextDecision = DateTime.UtcNow.Ticks / 10000 + 6000;
            Report(0);
            // 用户口径：支持"拖回猪圈"。猪圈矩形由浏览器半实测后经宿主下发。
            // 判定用**矩形相交**而不是"中心点落在圈里"：用户把猪头一段搭进猪圈就想让它回去，
            // 只测中心会导致"明明拖进去了却没返回"（真机反馈）。
            if (penRect.HasValue) {
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
