"use client"

import * as React from "react"
import * as d3 from "d3"
import { CONTENT_TYPE_CONFIG } from "@/lib/content-types"
import type { TextBlock } from "@/components/tile-card"
import { GraphDetailPanel } from "./graph-detail-panel"

// ─── Types ────────────────────────────────────────────────────────────────────

interface SimNode extends d3.SimulationNodeDatum {
  id: string
  block?: TextBlock
  isSynthesis?: boolean
  synthesisText?: string
  synthesisGenerating?: boolean
}

interface SimLink extends d3.SimulationLinkDatum<SimNode> {
  isSynthesisLink?: boolean
}

interface GraphAreaProps {
  blocks: TextBlock[]
  ghostNote?: { id: string; text: string; category: string; isGenerating: boolean }
  onReEnrich:        (id: string) => void
  onTogglePin:       (id: string) => void
  onEdit:            (id: string, text: string) => void
  onEditAnnotation:  (id: string, annotation: string) => void
  hasApiKey: boolean
  onOpenSidebar: () => void
}

interface ZoomTransform { x: number; y: number; k: number }

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getNodeRadius(node: SimNode): number {
  if (node.isSynthesis) return 34
  return 26
}

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) + "…" : text
}

function buildGraph(
  blocks: TextBlock[],
  ghostNote?: { id: string; text: string; category: string; isGenerating: boolean },
  existingNodes: SimNode[] = []
) {
  const blockIds = new Set(blocks.map(b => b.id))

  // Preserve positions for existing nodes
  const posMap = new Map<string, { x?: number; y?: number; vx?: number; vy?: number }>()
  for (const n of existingNodes) {
    posMap.set(n.id, { x: n.x, y: n.y, vx: n.vx, vy: n.vy })
  }

  const nodes: SimNode[] = blocks.map(b => {
    const prev = posMap.get(b.id)
    return { id: b.id, block: b, ...prev }
  })

  if (ghostNote) {
    const prev = posMap.get(ghostNote.id)
    nodes.push({
      id: ghostNote.id,
      isSynthesis: true,
      synthesisText: ghostNote.text,
      synthesisGenerating: ghostNote.isGenerating,
      ...prev,
    })
  }

  const links: SimLink[] = []
  const edgeSet = new Set<string>()

  for (const block of blocks) {
    if (!block.influencedBy?.length) continue
    for (const targetId of block.influencedBy) {
      if (!blockIds.has(targetId)) continue
      const edgeKey = [block.id, targetId].sort().join("§")
      if (!edgeSet.has(edgeKey)) {
        edgeSet.add(edgeKey)
        links.push({ source: block.id, target: targetId })
      }
    }
  }

  if (ghostNote) {
    for (const block of blocks) {
      links.push({ source: ghostNote.id, target: block.id, isSynthesisLink: true })
    }
  }

  return { nodes, links }
}

// ─── Component ───────────────────────────────────────────────────────────────

export function GraphArea({
  blocks,
  ghostNote,
  onReEnrich,
  onTogglePin,
  onEdit,
  onEditAnnotation,
  hasApiKey,
  onOpenSidebar,
}: GraphAreaProps) {
  const containerRef = React.useRef<HTMLDivElement>(null)
  const svgRef       = React.useRef<SVGSVGElement>(null)
  const simRef       = React.useRef<d3.Simulation<SimNode, SimLink> | null>(null)
  const nodesRef     = React.useRef<SimNode[]>([])
  const linksRef     = React.useRef<SimLink[]>([])

  const [, forceUpdate] = React.useReducer(x => x + 1, 0)
  const [dims, setDims]           = React.useState({ w: 900, h: 600 })
  const dimsRef = React.useRef({ w: 900, h: 600 })
  const [selectedId, setSelectedId]   = React.useState<string | null>(null)
  const [hoveredId, setHoveredId]     = React.useState<string | null>(null)
  const [tooltip, setTooltip]     = React.useState<{ id: string; x: number; y: number } | null>(null)
  const [transform, setTransform] = React.useState<ZoomTransform>({ x: 0, y: 0, k: 1 })

  // Refs for pan / drag
  const isPanning  = React.useRef(false)
  const panStart   = React.useRef({ mx: 0, my: 0, tx: 0, ty: 0 })
  const draggedNode = React.useRef<SimNode | null>(null)

  // ── Measure container ───────────────────────────────────────────────────
  React.useEffect(() => {
    if (!containerRef.current) return
    const obs = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect
      dimsRef.current = { w: width, h: height }
      setDims({ w: width, h: height })
    })
    obs.observe(containerRef.current)
    return () => obs.disconnect()
  }, [])

  // ── Initialise simulation once ──────────────────────────────────────────
  React.useEffect(() => {
    const { w, h } = dimsRef.current
    simRef.current = d3
      .forceSimulation<SimNode>([])
      .force(
        "link",
        d3.forceLink<SimNode, SimLink>([])
          .id(d => d.id)
          .distance(d => (d as SimLink).isSynthesisLink ? 280 : 190)
          .strength(d => (d as SimLink).isSynthesisLink ? 0.03 : 0.25)
      )
      .force("charge", d3.forceManyBody<SimNode>().strength(d => d.isSynthesis ? -800 : -500))
      .force("center",  d3.forceCenter(w / 2, h / 2).strength(0.03))
      .force("collide", d3.forceCollide<SimNode>().radius(d => getNodeRadius(d) + 40).strength(0.8))
      .alphaDecay(0.015)
      .velocityDecay(0.35)
      .on("tick", () => forceUpdate())
      .stop()
    return () => { simRef.current?.stop() }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Update nodes/links when blocks change (no full restart) ────────────
  React.useEffect(() => {
    const sim = simRef.current
    if (!sim) return

    const cx = dimsRef.current.w / 2
    const cy = dimsRef.current.h / 2
    const prevCount = nodesRef.current.length

    const { nodes, links } = buildGraph(blocks, ghostNote, nodesRef.current)

    for (const n of nodes) {
      // Seed position for brand-new nodes
      if (n.x === undefined) {
        n.x = cx + (Math.random() - 0.5) * 100
        n.y = cy + (Math.random() - 0.5) * 100
      }
      // Fix enriching nodes at a stable staging position near center
      // so they don't fly around while awaiting AI results
      if (n.block?.isEnriching) {
        if (n.fx == null) {
          n.fx = cx + (Math.random() - 0.5) * 50
          n.fy = cy + (Math.random() - 0.5) * 50
        }
        // Keep velocity zeroed so the node is truly still
        n.vx = 0
        n.vy = 0
      } else {
        // Enrichment finished — release the fix so it can integrate gracefully
        n.fx = null
        n.fy = null
      }
    }

    nodesRef.current = nodes
    linksRef.current = links

    // Update simulation in-place — no full restart
    sim.nodes(nodesRef.current)
    ;(sim.force("link") as d3.ForceLink<SimNode, SimLink>).links(linksRef.current)

    // New node added → moderate energy; enrichment completed → gentle reheat
    const isNewNode = nodes.length > prevCount
    sim.alpha(isNewNode ? 0.4 : 0.2).restart()

  }, [blocks, ghostNote]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Re-centre force when container resizes ──────────────────────────────
  React.useEffect(() => {
    const cf = simRef.current?.force<d3.ForceCenter<SimNode>>("center")
    if (cf) cf.x(dims.w / 2).y(dims.h / 2)
  }, [dims])

  // ── Zoom (wheel) ────────────────────────────────────────────────────────
  const handleWheel = React.useCallback((e: React.WheelEvent) => {
    e.preventDefault()
    const factor = e.deltaY < 0 ? 1.1 : 0.9
    const rect   = svgRef.current!.getBoundingClientRect()
    const cx     = e.clientX - rect.left
    const cy     = e.clientY - rect.top
    setTransform(t => {
      const k = Math.max(0.25, Math.min(4, t.k * factor))
      return { x: cx - (cx - t.x) * (k / t.k), y: cy - (cy - t.y) * (k / t.k), k }
    })
  }, [])

  // ── Pan ─────────────────────────────────────────────────────────────────
  const handleSvgMouseDown = React.useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if ((e.target as Element).closest(".graph-node")) return
    isPanning.current = true
    panStart.current = { mx: e.clientX, my: e.clientY, tx: transform.x, ty: transform.y }
  }, [transform])

  const handleSvgMouseMove = React.useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (draggedNode.current && simRef.current) {
      const rect = svgRef.current!.getBoundingClientRect()
      const wx   = (e.clientX - rect.left - transform.x) / transform.k
      const wy   = (e.clientY - rect.top  - transform.y) / transform.k
      draggedNode.current.fx = wx
      draggedNode.current.fy = wy
      simRef.current.alphaTarget(0.3).restart()
      return
    }
    if (!isPanning.current) return
    const dx = e.clientX - panStart.current.mx
    const dy = e.clientY - panStart.current.my
    setTransform(t => ({ ...t, x: panStart.current.tx + dx, y: panStart.current.ty + dy }))
  }, [transform])

  const handleSvgMouseUp = React.useCallback(() => {
    isPanning.current = false
    if (draggedNode.current && simRef.current) {
      draggedNode.current.fx = null
      draggedNode.current.fy = null
      simRef.current.alphaTarget(0)
      draggedNode.current = null
    }
  }, [])

  // ── Node drag start ─────────────────────────────────────────────────────
  const handleNodeMouseDown = React.useCallback((e: React.MouseEvent, node: SimNode) => {
    e.stopPropagation()
    draggedNode.current = node
    if (simRef.current) simRef.current.alphaTarget(0.3).restart()
  }, [])

  // ── Node click (select) ─────────────────────────────────────────────────
  const handleNodeClick = React.useCallback((e: React.MouseEvent, node: SimNode) => {
    e.stopPropagation()
    setSelectedId(prev => prev === node.id ? null : node.id)
  }, [])

  const handleSvgClick = React.useCallback(() => {
    setSelectedId(null)
  }, [])

  // ── Derived state ────────────────────────────────────────────────────────
  const selectedBlock  = React.useMemo(
    () => blocks.find(b => b.id === selectedId) ?? null,
    [blocks, selectedId]
  )

  // IDs that are connected to the hovered node (for dimming)
  const connectedToHovered = React.useMemo(() => {
    if (!hoveredId) return null
    const ids = new Set<string>([hoveredId])
    for (const l of linksRef.current) {
      const s = typeof l.source === "object" ? (l.source as SimNode).id : l.source as string
      const t = typeof l.target === "object" ? (l.target as SimNode).id : l.target as string
      if (s === hoveredId) ids.add(t)
      if (t === hoveredId) ids.add(s)
    }
    return ids
  }, [hoveredId])

  // ── Render ───────────────────────────────────────────────────────────────

  const graphWidth = selectedId ? "70%" : "100%"

  const { x: tx, y: ty, k: tk } = transform

  return (
    <div className="flex h-full w-full overflow-hidden bg-background">

      {/* ── Graph canvas ───────────────────────────────────────────────── */}
      <div
        ref={containerRef}
        style={{ width: graphWidth }}
        className="relative h-full transition-all duration-300 overflow-hidden"
      >
        {/* Empty state */}
        {blocks.length === 0 && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 pointer-events-none">
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground/30">
              No nodes yet — add notes to see the graph
            </p>
          </div>
        )}

        <svg
          ref={svgRef}
          width="100%"
          height="100%"
          className="select-none"
          style={{ cursor: isPanning.current ? "grabbing" : "grab" }}
          onWheel={handleWheel}
          onMouseDown={handleSvgMouseDown}
          onMouseMove={handleSvgMouseMove}
          onMouseUp={handleSvgMouseUp}
          onMouseLeave={handleSvgMouseUp}
          onClick={handleSvgClick}
        >
          <defs>
            {/* Synthesis glow filter */}
            <filter id="glow-synthesis" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="6" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            {/* Enriching pulse filter */}
            <filter id="glow-enrich" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            {/* Synthesis gradient */}
            <radialGradient id="synthesis-gradient" cx="50%" cy="50%" r="50%">
              <stop offset="0%"   stopColor="var(--type-thesis)" stopOpacity="1" />
              <stop offset="100%" stopColor="var(--type-claim)"  stopOpacity="0.8" />
            </radialGradient>
          </defs>

          <g transform={`translate(${tx},${ty}) scale(${tk})`}>

            {/* ── Links ──────────────────────────────────────────────────── */}
            <g>
              {linksRef.current.map((link, i) => {
                const s = link.source as SimNode
                const t = link.target as SimNode
                if (s.x == null || t.x == null) return null

                const isSynthLink = link.isSynthesisLink
                const isHighlighted = hoveredId && connectedToHovered &&
                  connectedToHovered.has(s.id) && connectedToHovered.has(t.id)
                const isDimmed = hoveredId && !isHighlighted

                return (
                  <line
                    key={i}
                    x1={s.x} y1={s.y}
                    x2={t.x} y2={t.y}
                    stroke="white"
                    strokeWidth={isSynthLink ? 0.5 : 1.2}
                    strokeDasharray={isSynthLink ? "3 5" : undefined}
                    strokeOpacity={
                      isSynthLink
                        ? (isDimmed ? 0.02 : 0.06)
                        : (isDimmed ? 0.04 : isHighlighted ? 0.6 : 0.18)
                    }
                    style={{ transition: "stroke-opacity 0.2s" }}
                  />
                )
              })}
            </g>

            {/* ── Nodes ──────────────────────────────────────────────────── */}
            <g>
              {nodesRef.current.map(node => {
                if (node.x == null || node.y == null) return null

                const isSelected  = node.id === selectedId
                const isHovered   = node.id === hoveredId
                const isDimmed    = hoveredId != null && !isHovered &&
                  (!connectedToHovered || !connectedToHovered.has(node.id))
                const r = getNodeRadius(node)

                // Color
                let fillColor: string
                if (node.isSynthesis) {
                  fillColor = "url(#synthesis-gradient)"
                } else {
                  const config = CONTENT_TYPE_CONFIG[node.block!.contentType]
                  fillColor = config.accentVar
                }

                const isEnriching = node.block?.isEnriching

                const config = node.block ? CONTENT_TYPE_CONFIG[node.block.contentType] : null
                const Icon   = config?.icon ?? null

                // Hover label: first ~40 chars of text
                const labelText = node.isSynthesis
                  ? truncate(node.synthesisText ?? "Synthesis", 44)
                  : truncate(node.block?.text ?? "", 44)

                return (
                  <g
                    key={node.id}
                    transform={`translate(${node.x},${node.y})`}
                    className="graph-node"
                    style={{
                      opacity: isDimmed ? 0.15 : 1,
                      filter: isEnriching ? "url(#glow-enrich)" : node.isSynthesis ? "url(#glow-synthesis)" : undefined,
                      transition: "opacity 0.2s",
                      cursor: "pointer",
                    }}
                    onMouseDown={e => handleNodeMouseDown(e, node)}
                    onClick={e => handleNodeClick(e, node)}
                    onMouseEnter={e => {
                      setHoveredId(node.id)
                      const rect = svgRef.current!.getBoundingClientRect()
                      setTooltip({ id: node.id, x: e.clientX - rect.left, y: e.clientY - rect.top })
                    }}
                    onMouseMove={e => {
                      const rect = svgRef.current!.getBoundingClientRect()
                      setTooltip({ id: node.id, x: e.clientX - rect.left, y: e.clientY - rect.top })
                    }}
                    onMouseLeave={() => { setHoveredId(null); setTooltip(null) }}
                  >
                    {/* Selected / hovered outer ring */}
                    {(isSelected || isHovered) && (
                      <circle
                        r={r + 7}
                        fill="none"
                        stroke={node.isSynthesis ? "var(--type-thesis)" : config?.accentVar ?? "white"}
                        strokeWidth={isSelected ? 1.5 : 1}
                        strokeOpacity={isSelected ? 0.7 : 0.3}
                      />
                    )}

                    {/* Enriching ring animation */}
                    {isEnriching && (
                      <circle
                        r={r + 12}
                        fill="none"
                        stroke={config?.accentVar ?? "white"}
                        strokeWidth={1}
                        strokeDasharray="3 4"
                        strokeOpacity={0.45}
                        style={{ animation: "spin 3s linear infinite", transformOrigin: "center" }}
                      />
                    )}

                    {/* Synthesis pulse rings */}
                    {node.isSynthesis && (
                      <>
                        <circle r={r + 14} fill="none" stroke="var(--type-thesis)" strokeWidth={0.5} strokeOpacity={0.15} />
                        <circle r={r + 22} fill="none" stroke="var(--type-thesis)" strokeWidth={0.5} strokeOpacity={0.07} />
                      </>
                    )}

                    {/* Main circle */}
                    <circle
                      r={r}
                      fill={fillColor}
                      fillOpacity={isSelected ? 1 : isHovered ? 0.95 : 0.9}
                      stroke={isSelected ? (node.isSynthesis ? "var(--type-thesis)" : config?.accentVar ?? "white") : "none"}
                      strokeWidth={isSelected ? 1.5 : 0}
                    />

                    {/* Icon inside node via foreignObject */}
                    {Icon && (
                      <foreignObject
                        x={-13} y={-13}
                        width={26} height={26}
                        style={{ pointerEvents: "none", overflow: "visible" }}
                      >
                        <div
                          // @ts-ignore – xmlns required for foreignObject HTML
                          xmlns="http://www.w3.org/1999/xhtml"
                          style={{
                            width: 26, height: 26,
                            display: "flex", alignItems: "center", justifyContent: "center",
                          }}
                        >
                          <Icon style={{ width: 14, height: 14, color: "white", opacity: 0.95 }} />
                        </div>
                      </foreignObject>
                    )}

                    {/* Synthesis "S" label */}
                    {node.isSynthesis && (
                      <text
                        textAnchor="middle"
                        dominantBaseline="central"
                        fontSize={11}
                        fontFamily="monospace"
                        fontWeight="bold"
                        fill="white"
                        fillOpacity={0.9}
                        style={{ pointerEvents: "none" }}
                      >
                        ✦
                      </text>
                    )}

                  </g>
                )
              })}
            </g>

          </g>
        </svg>

        {/* ── Floating tooltip ──────────────────────────────────────────── */}
        {tooltip && (() => {
          const node = nodesRef.current.find(n => n.id === tooltip.id)
          if (!node) return null
          const label = node.isSynthesis
            ? (node.synthesisText ?? "Synthesis")
            : (node.block?.text ?? "")
          const config = node.block ? CONTENT_TYPE_CONFIG[node.block.contentType] : null
          const accent = config?.accentVar ?? "var(--type-thesis)"
          // Position tooltip above cursor, shift left if near right edge
          const tipX = Math.min(tooltip.x + 12, (selectedId ? dims.w * 0.7 : dims.w) - 280)
          const tipY = tooltip.y - 16
          return (
            <div
              className="absolute z-50 pointer-events-none"
              style={{ left: tipX, top: tipY, transform: "translateY(-100%)" }}
            >
              <div
                className="rounded-sm shadow-[0_4px_24px_rgba(0,0,0,0.5)] border border-white/10 overflow-hidden"
                style={{ minWidth: 180, maxWidth: 280 }}
              >
                {/* Coloured header bar */}
                <div
                  className="flex items-center gap-2 px-2.5 py-1.5"
                  style={{ background: accent }}
                >
                  {config?.icon && React.createElement(config.icon, {
                    className: "h-3 w-3 flex-shrink-0",
                    style: { color: "black", opacity: 0.7 }
                  })}
                  <span className="font-mono text-[9px] font-black uppercase tracking-widest text-black/70">
                    {node.isSynthesis ? "Synthesis" : config?.label}
                  </span>
                  {node.block?.category && (
                    <span className="ml-auto font-mono text-[8px] text-black/50 truncate max-w-[80px]">
                      {node.block.category}
                    </span>
                  )}
                </div>
                {/* Full text body */}
                <div className="bg-card/95 backdrop-blur-sm px-3 py-2">
                  <p className="text-sm font-semibold leading-relaxed text-foreground">
                    {label}
                  </p>
                </div>
              </div>
              {/* Arrow tip */}
              <div
                className="mx-4 h-2 w-2 rotate-45 border-b border-r border-white/10 bg-card/95"
                style={{ marginTop: -1 }}
              />
            </div>
          )
        })()}

        {/* Zoom hints */}
        <div className="absolute bottom-4 left-4 flex items-center gap-2 pointer-events-none">
          <span className="font-mono text-[8px] text-muted-foreground/25 uppercase tracking-widest">
            scroll to zoom · drag to pan · click node to inspect
          </span>
        </div>

        {/* Node count */}
        {blocks.length > 0 && (
          <div className="absolute top-4 left-4 pointer-events-none">
            <span className="font-mono text-[8px] text-muted-foreground/25 uppercase tracking-widest">
              {blocks.length} node{blocks.length !== 1 ? "s" : ""}
              {ghostNote ? " · synthesis active" : ""}
            </span>
          </div>
        )}
      </div>

      {/* ── Detail panel (30%) ─────────────────────────────────────────────── */}
      {selectedId && (
        <div className="h-full overflow-hidden transition-all duration-300" style={{ width: "30%" }}>
          <GraphDetailPanel
            block={selectedBlock}
            allBlocks={blocks}
            onClose={() => setSelectedId(null)}
            onSelectNode={id => setSelectedId(id)}
            onReEnrich={onReEnrich}
            onTogglePin={onTogglePin}
            onEdit={onEdit}
            onEditAnnotation={onEditAnnotation}
          />
        </div>
      )}

    </div>
  )
}
