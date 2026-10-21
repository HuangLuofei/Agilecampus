import { describe, it, expect } from "vitest";
import {
  getAssetIcon,
  getAssetTypeLabel,
  getAssetKind,
} from "@/app/(app)/projects/[projectId]/assets/asset-types";

describe("getAssetIcon / getAssetTypeLabel", () => {
  it("PDF：按 MIME 判定", () => {
    expect(getAssetKind("application/pdf", "报告", "file")).toBe("pdf");
    expect(getAssetIcon("application/pdf", "报告", "file")).toBe("📕");
    expect(getAssetTypeLabel("application/pdf", "报告", "file")).toBe("PDF");
  });

  it("xlsx：MIME 与扩展名两条路径都命中「表格」", () => {
    expect(
      getAssetTypeLabel(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "data",
        "file",
      ),
    ).toBe("表格");
    expect(getAssetTypeLabel(null, "data.xlsx", "file")).toBe("表格");
    expect(getAssetIcon(null, "data.xlsx", "file")).toBe("📊");
  });

  it("docx：命中「文档」", () => {
    expect(
      getAssetTypeLabel(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "spec",
        "file",
      ),
    ).toBe("文档");
    expect(getAssetTypeLabel(null, "spec.docx", "file")).toBe("文档");
  });

  it("pptx：命中「演示」", () => {
    expect(getAssetTypeLabel(null, "slides.pptx", "file")).toBe("演示");
    expect(getAssetIcon(null, "slides.pptx", "file")).toBe("📽️");
  });

  it("png：命中「图片」", () => {
    expect(getAssetTypeLabel("image/png", "pic", "file")).toBe("图片");
    expect(getAssetTypeLabel(null, "pic.png", "file")).toBe("图片");
    expect(getAssetIcon("image/png", "pic", "file")).toBe("🖼️");
  });

  it("zip：命中「压缩包」", () => {
    expect(getAssetTypeLabel("application/zip", "pack", "file")).toBe("压缩包");
    expect(getAssetTypeLabel(null, "pack.zip", "file")).toBe("压缩包");
    expect(getAssetIcon(null, "pack.zip", "file")).toBe("📦");
  });

  it("mp4：命中「视频」", () => {
    expect(getAssetTypeLabel("video/mp4", "movie", "file")).toBe("视频");
    expect(getAssetTypeLabel(null, "movie.mp4", "file")).toBe("视频");
    expect(getAssetIcon(null, "movie.mp4", "file")).toBe("🎬");
  });

  it("未知类型稳定归「其他」", () => {
    expect(getAssetKind("application/octet-stream", "mystery.xyz", "file")).toBe("other");
    expect(getAssetIcon("application/octet-stream", "mystery.xyz", "file")).toBe("📎");
    expect(getAssetTypeLabel("application/octet-stream", "mystery.xyz", "file")).toBe("其他");
    expect(getAssetTypeLabel(null, "noext", "file")).toBe("其他");
    expect(getAssetTypeLabel(null, "", "file")).toBe("其他");
  });

  it("大小写不影响判断（MIME 与扩展名）", () => {
    expect(getAssetTypeLabel("APPLICATION/PDF", "R.PDF", "file")).toBe("PDF");
    expect(getAssetTypeLabel("Image/PNG", "PIC", "file")).toBe("图片");
    expect(getAssetTypeLabel(null, "DATA.XLSX", "file")).toBe("表格");
    expect(getAssetTypeLabel(null, "Movie.MP4", "file")).toBe("视频");
    expect(getAssetTypeLabel(null, "Pack.ZIP", "file")).toBe("压缩包");
    expect(getAssetTypeLabel(null, "SPEC.DOCX", "file")).toBe("文档");
    expect(getAssetTypeLabel(null, "SLIDES.PPTX", "file")).toBe("演示");
  });

  it("MIME 优先于扩展名", () => {
    // MIME 是 PDF、扩展名是 .xlsx → 按 MIME 归 PDF
    expect(getAssetKind("application/pdf", "weird.xlsx", "file")).toBe("pdf");
    // MIME 无法识别 → 回退扩展名
    expect(getAssetKind("application/octet-stream", "weird.xlsx", "file")).toBe("sheet");
    // MIME 缺失 → 扩展名
    expect(getAssetKind(null, "weird.xlsx", "file")).toBe("sheet");
    expect(getAssetKind(undefined, "weird.xlsx", "file")).toBe("sheet");
  });

  it("链接型资产归「链接」，不受 MIME/扩展名影响", () => {
    expect(getAssetKind("application/pdf", "doc.pdf", "link")).toBe("link");
    expect(getAssetIcon(null, "首页", "link")).toBe("🔗");
    expect(getAssetTypeLabel("image/png", "a.png", "link")).toBe("链接");
  });

  it("图标/标签稳定：同输入多次调用结果一致", () => {
    const cases: [string | null, string, "file" | "link"][] = [
      ["application/pdf", "a", "file"],
      [null, "b.xlsx", "file"],
      [null, "c.docx", "file"],
      [null, "d.pptx", "file"],
      ["image/png", "e", "file"],
      [null, "f.zip", "file"],
      ["video/mp4", "g", "file"],
      [null, "h.unknown", "file"],
      [null, "i", "link"],
    ];
    for (const [mime, name, type] of cases) {
      expect(getAssetIcon(mime, name, type)).toBe(getAssetIcon(mime, name, type));
      expect(getAssetTypeLabel(mime, name, type)).toBe(getAssetTypeLabel(mime, name, type));
    }
  });
});
