// 锚点几何探针（临时，_ 前缀）：验证 lib/native/pet-window.cs 的 Render() 里那三行 GDI+ 变换到底做了什么。
//
// 为什么需要它：桌宠是**分层窗口逐帧重绘**，画面上量到的包围盒同时被「位移弧(hop)」和「缩放」影响，
// 而猪走动时位置本身在变，所以从屏幕截图里把「缩放锚点在哪」单独拆出来是不可靠的。
// 这里把同一组调用（Translate(anchor) → Scale(1/scaleY, scaleY) → Translate(−anchor)）搬到离屏位图上，
// 用**同一个 GDI+** 画同一块 192×172 的色块（底部 6px 深色带当「脚」），量缩放后的包围盒：
//   脚底锚点 → 底边必须仍落在盒子底边（y + h）；
//   绕中心   → 底边会被抬起来 (1−scaleY)·h/2 ≈ 4.8px。
// 源码里的两处数字（squashSwing、盒子尺寸）由调用方从 pet-window.cs 读出来传进来，不在这里抄第二遍。
//
// 用法：_pet-anchor-probe.cs <squashSwing> <boxW> <boxH>
using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;

internal static class AnchorProbe {
    private static Bitmap MakeSprite(int w, int h) {
        Bitmap b = new Bitmap(w, h, PixelFormat.Format32bppArgb);
        using (Graphics g = Graphics.FromImage(b)) {
            g.Clear(Color.Transparent);
            using (SolidBrush fill = new SolidBrush(Color.FromArgb(255, 240, 170, 160))) g.FillRectangle(fill, 0, 0, w, h);
            using (SolidBrush foot = new SolidBrush(Color.FromArgb(255, 60, 60, 70))) g.FillRectangle(foot, 0, h - 6, w, 6);
        }
        return b;
    }

    /// <summary>按 pet-window.cs Render() 的调用序列画一次，返回缩放后像素的包围盒。</summary>
    private static int[] Draw(float scaleY, bool feetAnchored, int w, int h) {
        int boxX = w / 2, boxY = h / 2;                      // 盒子左上角，故意给一个非零原点
        using (Bitmap canvas = new Bitmap(w * 2, h * 2 + 40, PixelFormat.Format32bppArgb)) {
            using (Graphics g = Graphics.FromImage(canvas)) {
                g.Clear(Color.Transparent);
                g.InterpolationMode = InterpolationMode.HighQualityBicubic;
                float scaleX = 1f / scaleY;                  // 面积守恒：横向取纵向的倒数
                float footX = boxX + w * 0.5f;
                float footY = feetAnchored ? boxY + h : boxY + h * 0.5f;
                g.TranslateTransform(footX, footY);
                g.ScaleTransform(scaleX, scaleY);
                g.TranslateTransform(-footX, -footY);
                using (Bitmap sprite = MakeSprite(w, h)) g.DrawImage(sprite, new Rectangle(boxX, boxY, w, h));
                g.ResetTransform();
            }
            return Box(canvas);
        }
    }

    private static int[] Box(Bitmap bmp) {
        int left = int.MaxValue, top = int.MaxValue, right = -1, bottom = -1;
        for (int y = 0; y < bmp.Height; y++) {
            for (int x = 0; x < bmp.Width; x++) {
                if (bmp.GetPixel(x, y).A < 8) continue;
                if (x < left) left = x; if (x > right) right = x;
                if (y < top) top = y; if (y > bottom) bottom = y;
            }
        }
        return new int[] { left, top, right, bottom, bottom - top + 1, right - left + 1 };
    }

    private static int Main(string[] args) {
        float swing = float.Parse(args[0], System.Globalization.CultureInfo.InvariantCulture);
        int w = int.Parse(args[1]), h = int.Parse(args[2]);
        int boxBottom = h / 2 + h;
        Console.WriteLine("box: w=" + w + " h=" + h + " bottom=" + boxBottom + " swing=" + swing);
        foreach (float u in new float[] { 0f, 0.5f, 1f }) {           // 触地 / 中间 / 最高点
            float scaleY = 1f + swing * (u - 0.5f);
            int[] feet = Draw(scaleY, true, w, h);
            int[] center = Draw(scaleY, false, w, h);
            Console.WriteLine("u=" + u + " scaleY=" + scaleY.ToString("0.###") +
                " | 脚底锚点 bottom=" + feet[3] + " top=" + feet[1] + " h=" + feet[4] + " w=" + feet[5] +
                " | 绕中心 bottom=" + center[3] + " top=" + center[1] + " h=" + center[4] + " w=" + center[5]);
        }
        return 0;
    }
}
