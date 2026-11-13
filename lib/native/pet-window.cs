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
            petsStamp = stamp;
            object raw = json.DeserializeObject(File.ReadAllText(PetsFile));
            Dictionary<string, object> root = raw as Dictionary<string, object>;
            if (root == null) return;
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
        if (File.Exists(StopFile)) { timer.Stop(); Close(); return; }
        LoadPets();
        long now = DateTime.UtcNow.Ticks / 10000;
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
