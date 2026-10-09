import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

// 项目内共享的 Markdown 渲染器：默认转义原始 HTML，无 XSS 风险。
// remark-gfm 补齐表格/任务列表/删除线。样式见 globals.css 的 .md-body。
export function MarkdownBody({ content }: { content: string }) {
  return (
    <div className="md-body">
      <Markdown remarkPlugins={[remarkGfm]}>{content}</Markdown>
    </div>
  );
}
