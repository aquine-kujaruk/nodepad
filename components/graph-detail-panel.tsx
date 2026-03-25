"use client"

import * as React from "react"
import { CONTENT_TYPE_CONFIG } from "@/lib/content-types"
import type { TextBlock } from "@/components/tile-card"
import { ExternalLink, Pin, RefreshCw, X } from "lucide-react"

interface GraphDetailPanelProps {
  block: TextBlock | null
  allBlocks: TextBlock[]
  onClose: () => void
  onSelectNode: (id: string) => void
  onReEnrich: (id: string) => void
  onTogglePin: (id: string) => void
  onEdit: (id: string, text: string) => void
  onEditAnnotation: (id: string, annotation: string) => void
}

export function GraphDetailPanel({
  block,
  allBlocks,
  onClose,
  onSelectNode,
  onReEnrich,
  onTogglePin,
  onEdit,
  onEditAnnotation,
}: GraphDetailPanelProps) {
  const [editingText, setEditingText] = React.useState(false)
  const [editingAnnotation, setEditingAnnotation] = React.useState(false)
  const [draftText, setDraftText] = React.useState("")
  const [draftAnnotation, setDraftAnnotation] = React.useState("")
  const textareaRef = React.useRef<HTMLTextAreaElement>(null)
  const annotationRef = React.useRef<HTMLTextAreaElement>(null)

  // Reset edit state when block changes
  React.useEffect(() => {
    setEditingText(false)
    setEditingAnnotation(false)
  }, [block?.id])

  // Auto-focus textarea when editing starts
  React.useEffect(() => {
    if (editingText) {
      textareaRef.current?.focus()
      textareaRef.current?.select()
    }
  }, [editingText])

  React.useEffect(() => {
    if (editingAnnotation) {
      annotationRef.current?.focus()
      annotationRef.current?.select()
    }
  }, [editingAnnotation])

  if (!block) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center border-l border-border/60 bg-card/60">
        <div className="flex items-center gap-0.5 opacity-20">
          <span className="inline-block h-2 w-2 rounded-sm bg-foreground" />
          <span className="inline-block h-2 w-2 rounded-sm bg-foreground opacity-60" />
          <span className="inline-block h-2 w-2 rounded-sm bg-foreground opacity-30" />
        </div>
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground/40">
          Select a node to inspect
        </p>
      </div>
    )
  }

  const config = CONTENT_TYPE_CONFIG[block.contentType]
  const Icon   = config.icon
  const accent = config.accentVar

  // Header colour — same logic as tile-card
  const headerBg = block.contentType === "thesis"
    ? "var(--thesis-gradient)"
    : block.isPinned
      ? `linear-gradient(to right, ${accent}, color-mix(in oklch, ${accent} 80%, white 10%))`
      : accent
  const headerColor = block.contentType === "thesis" ? "var(--thesis-foreground)" : "black"

  const connectedBlocks = allBlocks.filter(
    b => b.id !== block.id && (
      block.influencedBy?.includes(b.id) ||
      b.influencedBy?.includes(block.id)
    )
  )

  const date = new Date(block.timestamp).toLocaleDateString([], {
    month: "short", day: "numeric", year: "numeric",
  })

  const commitText = () => {
    const trimmed = draftText.trim()
    if (trimmed && trimmed !== block.text) onEdit(block.id, trimmed)
    setEditingText(false)
  }

  const commitAnnotation = () => {
    const trimmed = draftAnnotation.trim()
    if (trimmed !== (block.annotation ?? "")) onEditAnnotation(block.id, trimmed)
    setEditingAnnotation(false)
  }

  return (
    <div className="flex h-full flex-col overflow-hidden border-l border-border/60 bg-card">

      {/* ── Header bar — matches tile-card style ───────────────────────── */}
      <div
        className="flex flex-shrink-0 items-center justify-between px-3 py-2"
        style={{ background: headerBg, color: headerColor, borderBottom: "1px solid var(--border)" }}
      >
        <div className="flex items-center gap-2 overflow-hidden" style={{ color: "inherit" }}>
          <Icon className="h-3 w-3 flex-shrink-0" />
          <span className="font-mono text-[10px] font-bold uppercase tracking-wider">
            {config.label}
          </span>
          {block.category && (
            <span className="rounded-sm bg-black/10 px-1.5 py-0.5 font-mono text-[8px] font-black uppercase tracking-tighter opacity-60">
              {block.category}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0" style={{ color: "inherit" }}>
          <span className="font-mono text-[9px] opacity-60">{date}</span>
          <button
            onClick={() => onTogglePin(block.id)}
            className={`p-1 rounded-sm transition-opacity ${block.isPinned ? "opacity-100" : "opacity-40 hover:opacity-90"}`}
            title={block.isPinned ? "Unpin" : "Pin"}
          >
            <Pin className="h-3 w-3" />
          </button>
          <button
            onClick={() => onReEnrich(block.id)}
            className="p-1 rounded-sm opacity-40 hover:opacity-90 transition-opacity"
            title="Re-enrich"
          >
            <RefreshCw className="h-3 w-3" />
          </button>
          <button
            onClick={onClose}
            className="p-1 rounded-sm opacity-40 hover:opacity-90 transition-opacity"
            title="Close"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* ── Scrollable body ─────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto custom-scrollbar">

        {/* Note text — double-click to edit */}
        <div className="px-4 pt-4 pb-3">
          {editingText ? (
            <textarea
              ref={textareaRef}
              value={draftText}
              onChange={e => setDraftText(e.target.value)}
              onBlur={commitText}
              onKeyDown={e => {
                if (e.key === "Escape") { setEditingText(false) }
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) commitText()
              }}
              rows={4}
              className={`w-full resize-none rounded-sm bg-secondary/30 px-2 py-1.5 text-base font-bold leading-relaxed text-foreground focus:outline-none focus:ring-1 focus:ring-primary/30 border border-primary/30`}
            />
          ) : (
            <p
              className={`text-base font-bold leading-relaxed text-foreground cursor-text hover:bg-secondary/20 rounded-sm px-2 py-1 -mx-2 transition-colors ${block.isEnriching ? "shimmer-text" : ""}`}
              onDoubleClick={() => { setDraftText(block.text); setEditingText(true) }}
              title="Double-click to edit"
            >
              {block.text}
            </p>
          )}
        </div>

        {/* Confidence bar */}
        {block.confidence != null && (
          <div className="px-4 pb-3 space-y-1">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[8px] uppercase tracking-widest text-muted-foreground/50">Confidence</span>
              <span className="font-mono text-[10px] font-bold" style={{ color: accent }}>{block.confidence}%</span>
            </div>
            <div className="h-1 w-full rounded-full bg-secondary overflow-hidden">
              <div className="h-full rounded-full transition-all duration-500" style={{ width: `${block.confidence}%`, background: accent }} />
            </div>
          </div>
        )}

        {/* Separator */}
        {block.annotation && <div className="mx-4 h-px bg-border/40 mb-3" />}

        {/* Annotation — double-click to edit */}
        {(block.annotation || editingAnnotation) && (
          <div className="px-4 pb-3 space-y-1.5">
            <p className="font-mono text-[8px] uppercase tracking-widest text-muted-foreground/40">AI Annotation</p>
            {editingAnnotation ? (
              <textarea
                ref={annotationRef}
                value={draftAnnotation}
                onChange={e => setDraftAnnotation(e.target.value)}
                onBlur={commitAnnotation}
                onKeyDown={e => {
                  if (e.key === "Escape") setEditingAnnotation(false)
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) commitAnnotation()
                }}
                rows={5}
                className="w-full resize-none rounded-sm bg-secondary/20 px-2 py-1.5 text-sm leading-relaxed text-foreground border border-primary/30 focus:outline-none focus:ring-1 focus:ring-primary/40"
              />
            ) : (
              <p
                className="text-sm leading-relaxed text-muted-foreground cursor-text hover:bg-secondary/20 rounded-sm px-2 py-1 -mx-2 transition-colors border-l-2 pl-3"
                style={{ borderColor: accent + "60" }}
                onDoubleClick={() => { setDraftAnnotation(block.annotation ?? ""); setEditingAnnotation(true) }}
                title="Double-click to edit"
              >
                {block.annotation}
              </p>
            )}
          </div>
        )}

        {/* Sources */}
        {block.sources && block.sources.length > 0 && (
          <div className="px-4 pb-3 space-y-1.5">
            <div className="h-px bg-border/40 mb-3" />
            <p className="font-mono text-[8px] uppercase tracking-widest text-muted-foreground/40">Sources</p>
            <div className="space-y-1">
              {block.sources.map((src, i) => (
                <a
                  key={i}
                  href={src.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 rounded-sm bg-secondary/40 px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors group"
                >
                  <ExternalLink className="h-3 w-3 flex-shrink-0 opacity-50 group-hover:opacity-80" />
                  <span className="truncate">{src.title || src.siteName || src.url}</span>
                </a>
              ))}
            </div>
          </div>
        )}

        {/* Connected nodes */}
        {connectedBlocks.length > 0 && (
          <div className="px-4 pb-4 space-y-1.5">
            <div className="h-px bg-border/40 mb-3" />
            <p className="font-mono text-[8px] uppercase tracking-widest text-muted-foreground/40">
              Connected · {connectedBlocks.length}
            </p>
            <div className="space-y-1">
              {connectedBlocks.map(b => {
                const bConfig = CONTENT_TYPE_CONFIG[b.contentType]
                const BIcon   = bConfig.icon
                return (
                  <button
                    key={b.id}
                    onClick={() => onSelectNode(b.id)}
                    className="flex w-full items-start gap-2.5 rounded-sm bg-secondary/30 px-2.5 py-2 text-left hover:bg-secondary/60 transition-colors group"
                  >
                    <BIcon className="mt-0.5 h-3 w-3 flex-shrink-0" style={{ color: bConfig.accentVar }} />
                    <span className="text-xs text-muted-foreground group-hover:text-foreground line-clamp-2 leading-relaxed transition-colors">
                      {b.text}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
