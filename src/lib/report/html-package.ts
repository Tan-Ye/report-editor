/**
 * 生成自包含的 HTML 包：一个 index.html + 每页一张图。
 *
 * 为什么要有这个格式：PDF 和图片都是静态的，视频元素进去只能当封面帧。
 * HTML 里可以用 `<video>` 真播 —— 等视频元素落地后，按元素坐标叠一层即可，
 * 底图仍然是这一页的截图。
 */

export interface HtmlPackagePage {
	/** 相对 index.html 的图片路径，例如 "pages/01.jpg" */
	image: string;
}

export interface HtmlPackageOptions {
	title: string;
	pages: HtmlPackagePage[];
	/** 单页像素尺寸，用来给 <img> 标注宽高比、避免加载时跳动 */
	width: number;
	height: number;
}

/** 转义 HTML 文本，报告名是用户输入，必须转义 */
function escapeHtml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

/**
 * 生成 index.html。
 *
 * 保持单文件、零依赖：打开即看，不需要起服务器，也不需要联网。
 * 翻页支持 ←/→/空格/PageUp/PageDown 和点击左右半屏。
 */
export function buildHtmlDocument(options: HtmlPackageOptions): string {
	const title = escapeHtml(options.title || "报告");
	const slides = options.pages
		.map(
			(page, index) =>
				`    <figure class="slide${index === 0 ? " is-active" : ""}" data-index="${index}">` +
				`<img src="${escapeHtml(page.image)}" alt="第 ${index + 1} 页" width="${options.width}" height="${options.height}" />` +
				`</figure>`,
		)
		.join("\n");

	return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title}</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  html, body { height: 100%; margin: 0; }
  body {
    background: #14161a;
    color: #e5e7eb;
    font-family: Inter, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  #stage {
    position: relative;
    flex: 1;
    min-height: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
  }
  .slide { margin: 0; display: none; max-width: 100%; max-height: 100%; }
  .slide.is-active { display: block; }
  .slide img {
    display: block;
    max-width: 100%;
    max-height: calc(100vh - 120px);
    width: auto;
    height: auto;
    background: #fff;
    box-shadow: 0 18px 48px rgba(0, 0, 0, 0.45);
    border-radius: 2px;
  }
  #bar {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
    padding: 10px 16px 16px;
    font-size: 13px;
    color: #9ca3af;
  }
  #bar button {
    appearance: none;
    border: 1px solid #2f343d;
    background: #1c1f25;
    color: #e5e7eb;
    border-radius: 8px;
    padding: 6px 12px;
    font-size: 13px;
    cursor: pointer;
    transition: background 0.15s ease, border-color 0.15s ease;
  }
  #bar button:hover { background: #262b33; border-color: #3b424d; }
  #bar button:disabled { opacity: 0.4; cursor: default; }
  #counter { font-variant-numeric: tabular-nums; min-width: 72px; text-align: center; }
  @media print {
    body { background: #fff; }
    #bar { display: none; }
    #stage { padding: 0; }
    .slide { display: block; page-break-after: always; }
    .slide img { max-height: none; box-shadow: none; width: 100%; }
  }
</style>
</head>
<body>
  <div id="stage">
${slides}
  </div>
  <div id="bar">
    <button type="button" id="prev" aria-label="上一页">‹</button>
    <span id="counter">1 / ${options.pages.length}</span>
    <button type="button" id="next" aria-label="下一页">›</button>
    <button type="button" id="full" aria-label="全屏">全屏</button>
  </div>
<script>
(function () {
  var slides = Array.prototype.slice.call(document.querySelectorAll(".slide"));
  var counter = document.getElementById("counter");
  var prev = document.getElementById("prev");
  var next = document.getElementById("next");
  var full = document.getElementById("full");
  var index = 0;

  function show(nextIndex) {
    if (nextIndex < 0 || nextIndex >= slides.length || nextIndex === index) return;
    slides[index].classList.remove("is-active");
    index = nextIndex;
    slides[index].classList.add("is-active");
    counter.textContent = (index + 1) + " / " + slides.length;
    prev.disabled = index === 0;
    next.disabled = index === slides.length - 1;
  }

  prev.addEventListener("click", function () { show(index - 1); });
  next.addEventListener("click", function () { show(index + 1); });
  full.addEventListener("click", function () {
    if (document.fullscreenElement) { document.exitFullscreen(); }
    else if (document.documentElement.requestFullscreen) { document.documentElement.requestFullscreen(); }
  });

  document.addEventListener("keydown", function (event) {
    var key = event.key;
    if (key === "ArrowLeft" || key === "PageUp") { event.preventDefault(); show(index - 1); }
    else if (key === "ArrowRight" || key === "PageDown" || key === " ") { event.preventDefault(); show(index + 1); }
    else if (key === "Home") { event.preventDefault(); show(0); }
    else if (key === "End") { event.preventDefault(); show(slides.length - 1); }
  });

  // 点左半屏上一页、右半屏下一页
  document.getElementById("stage").addEventListener("click", function (event) {
    var rect = event.currentTarget.getBoundingClientRect();
    show(event.clientX - rect.left < rect.width / 2 ? index - 1 : index + 1);
  });

  prev.disabled = true;
  next.disabled = slides.length <= 1;
})();
</script>
</body>
</html>
`;
}
