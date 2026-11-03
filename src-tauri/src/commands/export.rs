//! 导出相关命令：写文件、生成 PDF。
//!
//! 放 Rust 的理由和存储一样：导出路径是用户随便选的，fs 插件没有那个 scope。
//! 另外 PDF 要在字节层面拼结构，放前端反而更绕。
//!
//! 各导出格式的**分派在前端**（`lib/report-export.ts` 的 `exportReport`：
//! PDF / PNG / JPEG / 长图 / HTML 包 各有一个函数）。这里只提供两种底层能力：
//! 写文件，以及 PDF 的字节级装配。

use std::path::Path;

use crate::base64;
use crate::path::ensure_parent;

#[tauri::command]
pub fn write_file_base64(path: String, data: String) -> Result<(), String> {
    let bytes = base64::decode(&data)?;
    let target = Path::new(&path);
    ensure_parent(target)?;
    std::fs::write(target, bytes).map_err(|e| format!("写入失败：{e}"))
}

#[tauri::command]
pub fn write_text_file(path: String, content: String) -> Result<(), String> {
    let target = Path::new(&path);
    ensure_parent(target)?;
    std::fs::write(target, content).map_err(|e| format!("写入失败：{e}"))
}

/// 复制一个绝对路径的文件到另一个绝对路径（导出 HTML 包时搬媒体用）
#[tauri::command]
pub fn copy_file(from: String, to: String) -> Result<(), String> {
    let source = Path::new(&from);
    if !source.exists() {
        return Err(format!("源文件不存在：{from}"));
    }
    let target = Path::new(&to);
    ensure_parent(target)?;
    std::fs::copy(source, target).map_err(|e| format!("复制失败：{e}"))?;
    Ok(())
}

// ---------------------------------------------------------------------------
// PDF 装配
//
// 只支持 DCTDecode（JPEG）是刻意的：栅格页图用 JPEG 体积最小，
// 而且 PDF 对 JPEG 是直接嵌入，不需要再压缩一遍。
// ---------------------------------------------------------------------------

/// PDF 里的一页：已经编码好的 JPEG + 像素尺寸
#[derive(serde::Deserialize)]
pub struct PdfPage {
    data: String,
    width: u32,
    height: u32,
}

/// 附件在 PDF 里的名字
const ATTACHMENT_NAME: &str = "report.json";

/// 对象编号表。
///
/// 编号是固定的：1 = Catalog，2 = Pages，之后每页占 3 个（Page / Image / Contents），
/// 附件再占 2 个（Filespec / EmbeddedFile）。定死编号是为了互相引用时不用回填。
struct PdfLayout {
    catalog: usize,
    pages: usize,
    page: Vec<usize>,
    image: Vec<usize>,
    content: Vec<usize>,
    filespec: Option<usize>,
    embedded: Option<usize>,
}

impl PdfLayout {
    fn new(page_count: usize, has_attachment: bool) -> Self {
        let page = (0..page_count).map(|index| 3 + index * 3).collect();
        let image = (0..page_count).map(|index| 4 + index * 3).collect();
        let content = (0..page_count).map(|index| 5 + index * 3).collect();
        let mut next = 3 + page_count * 3;
        let (filespec, embedded) = if has_attachment {
            let filespec = next;
            next += 1;
            (Some(filespec), Some(next))
        } else {
            (None, None)
        };
        Self {
            catalog: 1,
            pages: 2,
            page,
            image,
            content,
            filespec,
            embedded,
        }
    }
}

/// 按顺序写对象，并记录每个对象的字节偏移（xref 要用）
struct PdfWriter {
    out: Vec<u8>,
    /// 下标 = 对象号；0 号是占位的 free 对象
    offsets: Vec<usize>,
}

impl PdfWriter {
    fn new() -> Self {
        let mut out = Vec::new();
        out.extend_from_slice(b"%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");
        Self {
            out,
            offsets: vec![0],
        }
    }

    /// 写一个普通对象（`N 0 obj … endobj`）
    fn object(&mut self, number: usize, body: &str) {
        self.offsets.push(self.out.len());
        self.out
            .extend_from_slice(format!("{number} 0 obj\n{body}\nendobj\n").as_bytes());
    }

    /// 写一个带 stream 的对象（图片、附件、内容流）
    fn stream_object(&mut self, number: usize, head: &str, data: &[u8]) {
        self.offsets.push(self.out.len());
        self.out
            .extend_from_slice(format!("{number} 0 obj\n{head}\nstream\n").as_bytes());
        self.out.extend_from_slice(data);
        self.out.extend_from_slice(b"\nendstream\nendobj\n");
    }

    /// 写交叉引用表 + trailer，然后落盘
    fn finish(self, path: &str) -> Result<(), String> {
        let mut out = self.out;
        let xref_offset = out.len();
        let object_count = self.offsets.len(); // 含 0 号占位

        out.extend_from_slice(format!("xref\n0 {object_count}\n").as_bytes());
        out.extend_from_slice(b"0000000000 65535 f \n");
        // 每条必须**正好 20 字节**
        for offset in self.offsets.iter().skip(1) {
            out.extend_from_slice(format!("{offset:010} 00000 n \n").as_bytes());
        }
        out.extend_from_slice(
            format!(
                "trailer\n<< /Size {object_count} /Root 1 0 R >>\nstartxref\n{xref_offset}\n%%EOF\n"
            )
            .as_bytes(),
        );

        let target = Path::new(path);
        ensure_parent(target)?;
        std::fs::write(target, out).map_err(|e| format!("写入 PDF 失败：{e}"))
    }
}

fn catalog_body(layout: &PdfLayout) -> String {
    let names = match layout.filespec {
        Some(filespec) => format!(
            " /Names << /EmbeddedFiles << /Names [({ATTACHMENT_NAME}) {filespec} 0 R] >> >>"
        ),
        None => String::new(),
    };
    format!(
        "<< /Type /Catalog /Pages {} 0 R{names} >>",
        layout.pages
    )
}

fn pages_body(layout: &PdfLayout) -> String {
    let kids: Vec<String> = layout.page.iter().map(|number| format!("{number} 0 R")).collect();
    format!(
        "<< /Type /Pages /Kids [{}] /Count {} >>",
        kids.join(" "),
        layout.page.len()
    )
}

fn page_body(image: usize, content: usize, width: f64, height: f64) -> String {
    format!(
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {width:.2} {height:.2}] \
         /Resources << /XObject << /Im0 {image} 0 R >> >> /Contents {content} 0 R >>"
    )
}

fn image_head(width: u32, height: u32, length: usize) -> String {
    format!(
        "<< /Type /XObject /Subtype /Image /Width {width} /Height {height} \
         /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length {length} >>"
    )
}

/// 内容流：cm 矩阵把 1×1 的图形空间拉伸成整页
fn content_stream(width: f64, height: f64) -> String {
    format!("q\n{width:.2} 0 0 {height:.2} 0 0 cm\n/Im0 Do\nQ\n")
}

fn attachment_bodies(layout: &PdfLayout, json: &[u8]) -> Option<(usize, String, usize, String)> {
    let filespec = layout.filespec?;
    let embedded = layout.embedded?;
    let spec = format!(
        "<< /Type /Filespec /F ({ATTACHMENT_NAME}) /UF ({ATTACHMENT_NAME}) /EF << /F {embedded} 0 R >> >>"
    );
    // Subtype 里的 `/` 必须写成 #2F
    let head = format!(
        "<< /Type /EmbeddedFile /Subtype /application#2Fjson /Length {} >>",
        json.len()
    );
    Some((filespec, spec, embedded, head))
}

/// 导出一份 PDF：每页一张满版 JPEG。
///
/// `report_json` 不为空时作为**附件**嵌进 PDF（`/EmbeddedFiles`）：
/// 栅格 PDF 本身没有元素结构，把源文件挂在旁边，导出的 PDF 就同时是"成品"和"源文件"，
/// 以后要做"从 PDF 解析回 JSON"直接读这个附件即可，无损。
#[tauri::command]
pub fn export_pdf(
    path: String,
    pages: Vec<PdfPage>,
    width: f64,
    height: f64,
    report_json: Option<String>,
) -> Result<(), String> {
    if pages.is_empty() {
        return Err("没有可导出的页面".into());
    }
    let layout = PdfLayout::new(pages.len(), report_json.is_some());
    let mut writer = PdfWriter::new();

    writer.object(layout.catalog, &catalog_body(&layout));
    writer.object(layout.pages, &pages_body(&layout));

    for (index, page) in pages.iter().enumerate() {
        let bytes = base64::decode(&page.data)?;
        let content = content_stream(width, height);
        writer.object(
            layout.page[index],
            &page_body(layout.image[index], layout.content[index], width, height),
        );
        writer.stream_object(
            layout.image[index],
            &image_head(page.width, page.height, bytes.len()),
            &bytes,
        );
        writer.stream_object(
            layout.content[index],
            &format!("<< /Length {} >>", content.len()),
            content.as_bytes(),
        );
    }

    if let Some(json) = report_json {
        let (filespec, spec, embedded, head) = attachment_bodies(&layout, json.as_bytes())
            .ok_or_else(|| "附件编号缺失".to_string())?;
        writer.object(filespec, &spec);
        writer.stream_object(embedded, &head, json.as_bytes());
    }

    writer.finish(&path)
}
