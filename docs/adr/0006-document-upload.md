# 文档上传：分批摘要（map-reduce）与零依赖解析

2026-11-21 增加文档上传能力。决定：支持文本/代码文件、PDF、DOCX、XLSX（单文件 ≤1 MiB），选择后立即自动开始分批摘要；长文档按段落分批（≤1500 字符/批），逐批生成部分摘要再汇总成完整摘要，显示批次进度、可停止；原文与提取文本保存在 `data/documents/`，可查看。

解析方案采用用户确认的 A：PDF 调用系统 `pdftotext`（本机已有，macOS 用 `brew install poppler`），DOCX/XLSX 用 Node 内置 zlib 手写 zip+XML 提取，**保持零 npm 依赖**。B（引入 pdfjs/mammoth/xlsx 库）被否：会打破零依赖约束。

## Consequences

- 汇总（reduce）输入必须受 numCtx 预算约束：`buildSummaryPrompt` 按批次数截断各片段摘要并标注"有删节"，避免长文档汇总超 2048。
- zip 解析加 8 MiB 解压上限与异常包装（防 zip 炸弹和畸形文件 500）；`X-Document-Name` 解码失败返回 400；Office 原文按正确 MIME 返回（PDF 可预览，Office 下载）。
- XLSX 解析先剔除自闭合空单元格/空行，避免跨标签吞并错列。
- 客户端断开时摘要循环立即中止（不再继续后续批次）。
- 文档与图片选择互斥；摘要会话标题取"文档：<文件名>"。
