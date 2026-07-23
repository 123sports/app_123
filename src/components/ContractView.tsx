import { useMemo } from "react";

/** Very small markdown renderer for our contract body (headings, bold, lists, paragraphs, italics). */
export function ContractView({ markdown }: { markdown: string }) {
  const html = useMemo(() => mdToHtml(markdown), [markdown]);
  return (
    <div
      className="prose prose-sm max-w-none dark:prose-invert
                 prose-headings:font-bold prose-h1:text-xl prose-h2:text-base
                 prose-p:my-2 prose-li:my-0 prose-ul:my-2"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function esc(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function inline(s: string) {
  return esc(s)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/_([^_]+)_/g, "<em>$1</em>");
}

function mdToHtml(md: string): string {
  const lines = md.split(/\r?\n/);
  const out: string[] = [];
  let inList = false;
  const closeList = () => { if (inList) { out.push("</ul>"); inList = false; } };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) { closeList(); continue; }
    if (line.startsWith("# ")) { closeList(); out.push(`<h1>${inline(line.slice(2))}</h1>`); continue; }
    if (line.startsWith("## ")) { closeList(); out.push(`<h2>${inline(line.slice(3))}</h2>`); continue; }
    if (line.startsWith("### ")) { closeList(); out.push(`<h3>${inline(line.slice(4))}</h3>`); continue; }
    if (line.startsWith("- ")) {
      if (!inList) { out.push("<ul>"); inList = true; }
      out.push(`<li>${inline(line.slice(2))}</li>`);
      continue;
    }
    closeList();
    out.push(`<p>${inline(line)}</p>`);
  }
  closeList();
  return out.join("\n");
}
