// 画布几何测试的宿主程序：与 lib/native/pet-window.cs 一起编译（/main:Harness），
// 直接调用产品代码里的 CanvasFit.Fit —— 测的是发出去的那份规则，不是它的 JS 复写。
// 每个场景打印一行 JSON，断言在 test/native-canvas.test.mjs 里。
using System;
using System.Drawing;

internal static class Harness {
    // 与 PetForm.Frame() 里那套算式逐项对应：两只猪的包围盒 + margin
    private static Rectangle Need(float ax, float ay, float bx, float by, float size) {
        float minX = Math.Min(ax, bx);
        float minY = Math.Min(ay, by);
        float maxX = Math.Max(ax, bx) + size;
        float maxY = Math.Max(ay, by) + size;
        int m = CanvasFit.Margin;
        return Rectangle.FromLTRB((int)Math.Floor(minX) - m, (int)Math.Floor(minY) - m,
                                  (int)Math.Ceiling(maxX) + m, (int)Math.Ceiling(maxY) + m);
    }

    // 修之前的策略：画布 = 包围盒裁到屏幕里的那一块（每帧都跟着包围盒走）
    private static int OldChanges(Rectangle[] frames, Rectangle screen) {
        int n = 0;
        Rectangle prev = Rectangle.Empty;
        for (int i = 0; i < frames.Length; i++) {
            Rectangle b = Rectangle.Intersect(frames[i], screen);
            if (prev != Rectangle.Empty && b != prev) n++;
            prev = b;
        }
        return n;
    }

    private static void Run(string name, Rectangle screen, Rectangle[] frames) {
        Rectangle canvas = Rectangle.Empty;
        Rectangle start = Rectangle.Empty;
        int changes = 0;
        bool contained = true;
        bool gridOk = true;
        for (int i = 0; i < frames.Length; i++) {
            Rectangle next = CanvasFit.Fit(canvas, frames[i], screen);
            if (canvas == Rectangle.Empty) { canvas = next; start = next; continue; }
            if (next != canvas) {
                changes++;
                // 网格对齐：每条边的增量都必须是 Grid 的整数倍（否则又会出现 1px 搬家）
                if ((next.Left - canvas.Left) % CanvasFit.Grid != 0) gridOk = false;
                if ((next.Top - canvas.Top) % CanvasFit.Grid != 0) gridOk = false;
                if ((next.Right - canvas.Right) % CanvasFit.Grid != 0) gridOk = false;
                if ((next.Bottom - canvas.Bottom) % CanvasFit.Grid != 0) gridOk = false;
                canvas = next;
            }
            // 不变量：画布永远装得下「必须显示的像素」，否则就是切猪
            Rectangle keep = Rectangle.Intersect(frames[i], screen);
            if (!(canvas.Left <= keep.Left && canvas.Top <= keep.Top && canvas.Right >= keep.Right && canvas.Bottom >= keep.Bottom)) contained = false;
        }
        Console.WriteLine("{\"case\":\"" + name + "\",\"frames\":" + frames.Length + ",\"changes\":" + changes
            + ",\"oldChanges\":" + OldChanges(frames, screen) + ",\"contained\":" + (contained ? "true" : "false")
            + ",\"gridOk\":" + (gridOk ? "true" : "false")
            + ",\"start\":\"" + start.Left + "," + start.Top + "," + start.Width + "," + start.Height + "\""
            + ",\"final\":\"" + canvas.Left + "," + canvas.Top + "," + canvas.Width + "," + canvas.Height + "\"}");
    }

    private static int Main() {
        Rectangle screen = Rectangle.FromLTRB(0, 0, 2560, 1600);
        const float size = 192f;   // 96 CSS px × DPI 2（本机实测 dpi=192）

        // 1) 一只猪向右走 600px，另一只不动 —— 就是用户看到的那一幕
        Rectangle[] walk = new Rectangle[188];
        for (int i = 0; i < walk.Length; i++) walk[i] = Need(300f + i * 3.2f, 300f, 200f, 900f, size);
        Run("walkRight", screen, walk);

        // 2) 全静止：一次都不许搬
        Rectangle[] still = new Rectangle[200];
        for (int i = 0; i < still.Length; i++) still[i] = Need(300f, 300f, 200f, 900f, size);
        Run("still", screen, still);

        // 3) 走出去再走回来：能收，但不能来回抖
        Rectangle[] back = new Rectangle[376];
        for (int i = 0; i < 188; i++) back[i] = Need(300f + i * 3.2f, 300f, 200f, 900f, size);
        for (int i = 0; i < 188; i++) back[188 + i] = Need(900f - i * 3.2f, 300f, 200f, 900f, size);
        Run("walkBack", screen, back);

        // 4) 贴屏幕左上角：need 被屏幕裁掉一截
        Rectangle[] edge = new Rectangle[200];
        for (int i = 0; i < edge.Length; i++) edge[i] = Need(i * 0.4f, 0f, 0f, 0f, size);
        Run("screenEdge", screen, edge);

        // 5) 主屏左边的第二块屏（负坐标）：向外取整必须往负方向走
        Rectangle screen2 = Rectangle.FromLTRB(-1920, 0, 2560, 1600);
        Rectangle[] negative = new Rectangle[120];
        for (int i = 0; i < negative.Length; i++) negative[i] = Need(-500f + i * 3.2f, 300f, -800f, 300f, size);
        Run("negativeScreen", screen2, negative);

        return 0;
    }
}
