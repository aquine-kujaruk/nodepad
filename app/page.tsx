"use client"

import { useState, useCallback, useEffect, useRef, useMemo } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { TilingArea } from "@/components/tiling-area"
import { KanbanArea } from "@/components/kanban-area"
import { GraphArea } from "@/components/graph-area"
import { ProjectSidebar } from "@/components/project-sidebar"
import { StatusBar } from "@/components/status-bar"
import { GhostPanel, type GhostNote } from "@/components/ghost-panel"
import { VimInput } from "@/components/vim-input"
import type { TextBlock } from "@/components/tile-card"
import type { ContentType } from "@/lib/content-types"
import { INITIAL_PROJECTS } from "@/lib/initial-data"
import { useAISettings, getAIHeaders } from "@/lib/ai-settings"
import { exportToMarkdown, downloadMarkdown, copyToClipboard } from "@/lib/export"
import { downloadNodepadFile, parseNodepadFile, NodepadParseError } from "@/lib/nodepad-format"

function generateId() {
  return Math.random().toString(36).substring(2, 10)
}

export interface Project {
  id: string
  name: string
  blocks: TextBlock[]
  collapsedIds: string[]
  ghostNotes: GhostNote[]
  lastGhostBlockCount?: number
  lastGhostTimestamp?: number
  /** Texts of recently generated ghost notes — passed back to the API to prevent near-duplicates */
  lastGhostTexts?: string[]
}

import { TileIndex } from "@/components/tile-index"

export default function Page() {
  const [projects, setProjects] = useState<Project[]>([])
  const [activeProjectId, setActiveProjectId] = useState<string>("")
  const [highlightedBlockId, setHighlightedBlockId] = useState<string | null>(null)
  const [isLoaded, setIsLoaded] = useState(false)
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  const [isIndexOpen, setIsIndexOpen] = useState(false)
  const [isGhostPanelOpen, setIsGhostPanelOpen] = useState(false)
  const [viewMode, setViewMode] = useState<"tiling" | "kanban" | "graph">("tiling")
  const [isCommandKOpen, setIsCommandKOpen] = useState(false)
  const [jumpToSettings, setJumpToSettings] = useState(false)
  const { settings, updateSettings, resolvedModelId, currentModel } = useAISettings()
  const debounceTimers = useRef<Record<string, Record<string, NodeJS.Timeout>>>({})

  // ── Undo history ring (max 20 block snapshots per project) ───────────────
  const blockHistoryRef = useRef<Record<string, TextBlock[][]>>({})
  const [undoToast, setUndoToast] = useState<string | null>(null)
  const undoToastTimer = useRef<NodeJS.Timeout | null>(null)

  const pushHistory = useCallback((projectId: string, currentBlocks: TextBlock[]) => {
    if (!blockHistoryRef.current[projectId]) blockHistoryRef.current[projectId] = []
    const stack = blockHistoryRef.current[projectId]
    stack.push(currentBlocks.map(b => ({ ...b })))
    if (stack.length > 20) stack.shift()
  }, [])

  const showUndoToast = useCallback((msg: string) => {
    if (undoToastTimer.current) clearTimeout(undoToastTimer.current)
    setUndoToast(msg)
    undoToastTimer.current = setTimeout(() => setUndoToast(null), 2200)
  }, [])

  const undo = useCallback(() => {
    const stack = blockHistoryRef.current[activeProjectId]
    if (!stack || stack.length === 0) {
      showUndoToast("Nothing to undo")
      return
    }
    const previousBlocks = stack.pop()!
    setProjects(prev => prev.map(p => p.id === activeProjectId
      ? { ...p, blocks: previousBlocks }
      : p
    ))
    showUndoToast("↩ Undone")
  }, [activeProjectId, showUndoToast])

  const activeProject = useMemo(() =>
    projects.find(p => p.id === activeProjectId) || projects[0],
  [projects, activeProjectId])

  const blocks = activeProject?.blocks || []
  const ghostNotes = activeProject?.ghostNotes || []

  const updateActiveProject = useCallback((updater: (p: Project) => Project) => {
    setProjects(prev => prev.map(p => p.id === activeProjectId ? updater(p) : p))
  }, [activeProjectId])

  // 1. Persistence: Initial Load & Migration
  useEffect(() => {
    const savedProjects = localStorage.getItem("nodepad-projects")
    const savedActiveId = localStorage.getItem("nodepad-active-project")
    
    const oldBlocks = localStorage.getItem("nodepad-blocks")
    const oldCollapsed = localStorage.getItem("nodepad-collapsed")

    let initialProjects: Project[] = []
    let initialActiveId = ""

    const backupProjects = localStorage.getItem("nodepad-backup")

    if (savedProjects) {
      try {
        initialProjects = JSON.parse(savedProjects)
        initialActiveId = savedActiveId || initialProjects[0]?.id || ""
      } catch (e) {
        console.error("Failed to parse saved projects — trying backup", e)
        // Fall through to backup attempt below
      }
    }

    // Fallback: restore from silent backup if primary key was absent or corrupt
    if (initialProjects.length === 0 && backupProjects) {
      try {
        initialProjects = JSON.parse(backupProjects)
        initialActiveId = initialProjects[0]?.id || ""
        console.info("Restored from nodepad-backup")
      } catch (e) {
        console.error("Backup restore also failed", e)
      }
    }

    if (initialProjects.length === 0 && oldBlocks) {
      try {
        const blks = JSON.parse(oldBlocks)
        const collapsed = oldCollapsed ? JSON.parse(oldCollapsed) : []
        const defaultProject: Project = {
          id: "default",
          name: "Default Space",
          blocks: blks,
          collapsedIds: collapsed,
          ghostNotes: [],
        }
        initialProjects = [defaultProject]
        initialActiveId = "default"
      } catch (e) {
        console.error("Migration failed", e)
      }
    }

    if (initialProjects.length === 0) {
      initialProjects = INITIAL_PROJECTS
      initialActiveId = INITIAL_PROJECTS[0].id
    }

    setProjects(initialProjects)
    setActiveProjectId(initialActiveId)
    setIsLoaded(true)

  }, [])

  // 2. Persistence: Save on Change
  useEffect(() => {
    if (!isLoaded) return
    localStorage.setItem("nodepad-projects", JSON.stringify(projects))
    localStorage.setItem("nodepad-active-project", activeProjectId)
  }, [projects, activeProjectId, isLoaded])

  // 3. Silent rolling backup — written on every change, separate key.
  //    If nodepad-projects is ever wiped, the load effect can fall back to this.
  useEffect(() => {
    if (!isLoaded || projects.length === 0) return
    try {
      localStorage.setItem("nodepad-backup", JSON.stringify(projects))
    } catch { /* quota exceeded — skip silently */ }
  }, [projects, isLoaded])

  // Hidden file input for .nodepad import — triggered from sidebar or ⌘K
  const importInputRef = useRef<HTMLInputElement>(null)

  const handleImportFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const raw = ev.target?.result as string
        const names = projectsRef.current.map(p => p.name)
        const imported = parseNodepadFile(raw, names) as Project
        setProjects(prev => [...prev, imported])
        setActiveProjectId(imported.id)
        setIsSidebarOpen(false)
      } catch (err) {
        if (err instanceof NodepadParseError) {
          alert(err.message)
        } else {
          alert("Could not import file — make sure it's a valid .nodepad file.")
        }
      }
    }
    reader.readAsText(file)
    // Reset input so the same file can be re-imported if needed
    e.target.value = ""
  }, [])

  // A ref to read current projects without causing re-renders or stale closures
  const projectsRef = useRef(projects)
  useEffect(() => { projectsRef.current = projects }, [projects])

  // Tracks which project IDs currently have a ghost generation in-flight
  const generatingRef = useRef<Set<string>>(new Set())

  /**
   * Builds a recency-biased, category-diverse context window for ghost generation.
   * Strategy:
   *   1. Always include the 4 most recently added blocks (freshest thinking).
   *   2. Then add the single most-recent block from every category not yet represented.
   *   3. Fill remaining slots (up to 10 total) with the next most-recent blocks.
   * This forces the model to see cross-category material rather than a wall of the
   * dominant theme.
   */
  function buildGhostContext(enrichedBlocks: TextBlock[]) {
    if (enrichedBlocks.length <= 8) return enrichedBlocks

    const sorted = [...enrichedBlocks].sort((a, b) => b.timestamp - a.timestamp)
    const selected = new Set<string>()
    const result: TextBlock[] = []

    // Step 1 — most recent 4
    sorted.slice(0, 4).forEach(b => { selected.add(b.id); result.push(b) })

    // Step 2 — one representative per missing category
    const representedCats = new Set(result.map(b => b.category))
    const byCat = new Map<string, TextBlock>()
    sorted.forEach(b => {
      if (b.category && !byCat.has(b.category)) byCat.set(b.category, b)
    })
    for (const [cat, block] of byCat) {
      if (result.length >= 10) break
      if (!representedCats.has(cat) && !selected.has(block.id)) {
        selected.add(block.id)
        result.push(block)
        representedCats.add(cat)
      }
    }

    // Step 3 — fill to 10 with remaining recent blocks
    for (const b of sorted) {
      if (result.length >= 10) break
      if (!selected.has(b.id)) { selected.add(b.id); result.push(b) }
    }

    return result
  }

  const generateGhostNote = useCallback(async (projectId: string) => {
    const targetProject = projectsRef.current.find(p => p.id === projectId)

    if (!targetProject) return

    // Require at least 5 enriched blocks
    const enrichedBlocks = targetProject.blocks.filter(b => !b.isEnriching && b.category)
    if (enrichedBlocks.length < 5) return

    // Cap panel at 5 ghost notes
    if ((targetProject.ghostNotes || []).length >= 5) return

    // No concurrent generation for this project
    if (generatingRef.current.has(projectId)) return

    // Require at least 5 new blocks since last generation
    const lastCount = targetProject.lastGhostBlockCount || 0
    if (enrichedBlocks.length < lastCount + 5) return

    // Require at least 5 minutes since last generation
    const lastTime = targetProject.lastGhostTimestamp || 0
    const fiveMinutes = 5 * 60 * 1000
    if (Date.now() - lastTime < fiveMinutes) return

    // Require at least 2 distinct categories (meaningful diversity)
    const categories = new Set(enrichedBlocks.map(b => b.category).filter(Boolean))
    if (categories.size < 2) return

    generatingRef.current.add(projectId)
    const ghostId = "ghost-" + generateId()

    setProjects(prev => prev.map(p => p.id === projectId ? {
      ...p,
      ghostNotes: [...(p.ghostNotes || []), { id: ghostId, text: "", category: "thesis", isGenerating: true }],
      lastGhostBlockCount: enrichedBlocks.length,
      lastGhostTimestamp: Date.now()
    } : p))

    try {
      const curated = buildGhostContext(enrichedBlocks)
      const context = curated.map(b => ({
        text: b.text,
        category: b.category,
        contentType: b.contentType,
      }))

      // Pass the last 5 generated ghost texts so the model can avoid near-duplicates
      const previousSyntheses = (targetProject.lastGhostTexts || []).slice(-5)

      const res = await fetch("/api/ghost", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getAIHeaders()
        },
        body: JSON.stringify({ context, previousSyntheses })
      })

      if (res.ok) {
        const data = await res.json()
        setProjects(prev => prev.map(p => {
          if (p.id !== projectId) return p
          return {
            ...p,
            ghostNotes: (p.ghostNotes || []).map(n =>
              n.id === ghostId ? { ...n, text: data.text, category: data.category, isGenerating: false } : n
            ),
            // Accumulate ghost texts for dedup (keep last 10)
            lastGhostTexts: [...(p.lastGhostTexts || []), data.text].slice(-10),
          }
        }))
      } else {
        setProjects(prev => prev.map(p => p.id === projectId
          ? { ...p, ghostNotes: (p.ghostNotes || []).filter(n => n.id !== ghostId) }
          : p
        ))
      }
    } catch (e) {
      console.error("Ghost note generation failed", e)
      setProjects(prev => prev.map(p => p.id === projectId
        ? { ...p, ghostNotes: (p.ghostNotes || []).filter(n => n.id !== ghostId) }
        : p
      ))
    } finally {
      generatingRef.current.delete(projectId)
    }
  }, [])

  const enrichBlock = useCallback(async (projectId: string, id: string, text: string, category?: string, forcedType?: string) => {
    setProjects(prevProjects => {
      const targetProject = prevProjects.find(p => p.id === projectId)
      if (!targetProject) return prevProjects

      const context = targetProject.blocks
        .filter((b) => b.id !== id && !b.isEnriching)
        .map((b) => ({
          id: b.id,
          text: b.text,
          category: b.category,
          annotation: b.annotation,
        }))
        .slice(-15)

      const performEnrich = async () => {
        try {
          const res = await fetch("/api/enrich", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...getAIHeaders()
            },
            body: JSON.stringify({ 
              text, 
              category, 
              context: context.map(({ id, ...rest }) => rest), 
              forcedType 
            }),
          })
          
          if (res.ok) {
            const data = await res.json()
            // Map indices back to stable block IDs — the context array carries
            // the original block IDs so we get exact, rename-proof references.
            const influencedBy = data.influencedByIndices
              ? (data.influencedByIndices as number[])
                  .map((idx) => context[idx]?.id)
                  .filter(Boolean) as string[]
              : []

            setProjects((current: Project[]) => {
              const mergeTargetIdx = data.mergeWithIndex
              const mergeTargetId = mergeTargetIdx !== null && context[mergeTargetIdx] ? context[mergeTargetIdx].id : null

              return current.map(proj => {
                if (proj.id !== projectId) return proj

                if (mergeTargetId) {
                  return {
                    ...proj,
                    blocks: proj.blocks
                      .filter(b => b.id !== id)
                      .map(b => b.id === mergeTargetId ? {
                        ...b,
                        text: b.text + "\n\n" + text,
                        contentType: data.contentType,
                        category: data.category,
                        annotation: data.annotation,
                        confidence: data.confidence,
                        sources: data.sources,
                        influencedBy,
                        isUnrelated: data.isUnrelated,
                        isEnriching: false,
                        statusText: undefined,
                        isError: false,
                      } : b)
                  }
                }
                if (data.contentType === "task") {
                  const existingTaskIndex = proj.blocks.findIndex(b => b.contentType === "task" && b.id !== id)
                  if (existingTaskIndex !== -1) {
                    const existingTask = proj.blocks[existingTaskIndex]
                    const newSubTask = {
                      id: Math.random().toString(36).substring(2, 9),
                      text: text,
                      isDone: false,
                      timestamp: Date.now()
                    }
                    
                    return {
                      ...proj,
                      blocks: proj.blocks
                        .filter(b => b.id !== id)
                        .map(b => b.id === existingTask.id ? {
                          ...b,
                          subTasks: [...(b.subTasks || []), newSubTask],
                          isEnriching: false,
                          statusText: undefined
                        } : b)
                    }
                  } else {
                    return {
                      ...proj,
                      blocks: proj.blocks.map(b => b.id === id ? {
                        ...b,
                        contentType: "task",
                        category: "Tasks",
                        subTasks: [{
                          id: Math.random().toString(36).substring(2, 9),
                          text: text,
                          isDone: false,
                          timestamp: Date.now()
                        }],
                        isEnriching: false,
                        statusText: undefined,
                        isError: false
                      } : b)
                    }
                  }
                }

                return {
                  ...proj,
                  blocks: proj.blocks.map(b => b.id === id ? {
                    ...b,
                    contentType: data.contentType,
                    category: data.category,
                    annotation: data.annotation,
                    confidence: data.confidence,
                    sources: data.sources,
                    influencedBy,
                    isUnrelated: data.isUnrelated,
                    isEnriching: false,
                    statusText: undefined,
                    isError: false,
                  } : b)
                }
              })
            })

            setTimeout(() => generateGhostNote(projectId), 2500)
          } else {
            const isNoKey = res.status === 401
            setProjects((current: Project[]) => current.map(proj => proj.id === projectId ? {
              ...proj,
              blocks: proj.blocks.map(b => b.id === id ? { ...b, isEnriching: false, isError: true, statusText: isNoKey ? "no-api-key" : undefined } : b)
            } : proj))
          }
        } catch (e) {
          console.error(e)
          setProjects((current: Project[]) => current.map(proj => proj.id === projectId ? {
            ...proj,
            blocks: proj.blocks.map(b => b.id === id ? { ...b, isEnriching: false, isError: true } : b)
          } : proj))
        }
      }

      performEnrich()

      return prevProjects.map(p => p.id === projectId ? {
        ...p,
        blocks: p.blocks.map(b => b.id === id ? { ...b, isEnriching: true, isError: false } : b)
      } : p)
    })
  }, [generateGhostNote])

  const claimGhostNote = useCallback((id: string) => {
    const note = (activeProject?.ghostNotes || []).find(n => n.id === id)
    if (!note || note.isGenerating) return
    const newId = generateId()
    const { text, category } = note

    updateActiveProject(p => {
      const updatedProject = {
        ...p,
        blocks: [...p.blocks, {
          id: newId,
          text,
          timestamp: Date.now(),
          contentType: "thesis" as ContentType,
          category,
          isEnriching: true
        }],
        ghostNotes: (p.ghostNotes || []).filter(n => n.id !== id),
      }
      enrichBlock(p.id, newId, text, category, "thesis")
      return updatedProject
    })
  }, [activeProject, updateActiveProject, enrichBlock])

  const dismissGhostNote = useCallback((id: string) => {
    updateActiveProject(p => ({
      ...p,
      ghostNotes: (p.ghostNotes || []).filter(n => n.id !== id),
    }))
  }, [updateActiveProject])

  useEffect(() => {
    const handleKeys = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setIsCommandKOpen(prev => !prev)
      }
      if (e.key === "1" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); setViewMode("tiling") }
      if (e.key === "2" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); setViewMode("kanban") }
      if (e.key === "3" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); setViewMode("graph") }
      if (e.key === "z" && (e.metaKey || e.ctrlKey) && !e.shiftKey) {
        // Don't intercept while typing in an input/textarea
        const tag = (e.target as HTMLElement).tagName
        if (tag !== "INPUT" && tag !== "TEXTAREA") {
          e.preventDefault()
          undo()
        }
      }
      if (e.key === "Escape") {
        if (isCommandKOpen) {
          setIsCommandKOpen(false)
        } else if (isGhostPanelOpen) {
          setIsGhostPanelOpen(false)
        }
      }
    }
    window.addEventListener("keydown", handleKeys)
    return () => window.removeEventListener("keydown", handleKeys)
  }, [isCommandKOpen, isGhostPanelOpen, undo])

  const addBlock = useCallback(
    (text: string, forcedType?: ContentType) => {
      // Parse inline #type tag  e.g. "#claim The earth is 4.5 billion years old"
      let resolvedText = text
      let resolvedType = forcedType

      if (!resolvedType) {
        const tagMatch = text.match(/^#([a-z]+)\s+(.+)/i)
        if (tagMatch) {
          const tag = tagMatch[1].toLowerCase() as ContentType
          const ALL_TYPES: ContentType[] = [
            "entity", "claim", "question", "task", "idea", "reference",
            "quote", "definition", "opinion", "reflection", "narrative",
            "comparison", "thesis", "general"
          ]
          if (ALL_TYPES.includes(tag)) {
            resolvedType = tag
            resolvedText = tagMatch[2].trim()
          }
        }
      }

      const newId = generateId()
      const initialType = resolvedType ?? "general"

      pushHistory(activeProjectId, blocks)
      updateActiveProject(p => ({
        ...p,
        blocks: [...p.blocks, {
          id: newId,
          text: resolvedText,
          timestamp: Date.now(),
          contentType: initialType,
          isEnriching: true,
        }]
      }))

      setIsCommandKOpen(false)
      enrichBlock(activeProjectId, newId, resolvedText, undefined, resolvedType).catch(console.error)
    },
    [activeProjectId, blocks, pushHistory, updateActiveProject, enrichBlock]
  )

  const deleteBlock = useCallback((id: string) => {
    pushHistory(activeProjectId, blocks)
    updateActiveProject(p => ({
      ...p,
      blocks: p.blocks.filter(b => b.id !== id)
    }))
  }, [activeProjectId, blocks, pushHistory, updateActiveProject])

  const editBlock = useCallback((id: string, newText: string) => {
    // Snapshot before the edit so Cmd+Z restores the original text
    const currentProj = projectsRef.current.find(p => p.id === activeProjectId)
    if (currentProj) {
      const currentBlock = currentProj.blocks.find(b => b.id === id)
      if (currentBlock && currentBlock.text !== newText) {
        pushHistory(activeProjectId, currentProj.blocks)
      }
    }

    setProjects(prev => {
      const proj = prev.find(p => p.id === activeProjectId)
      if (!proj) return prev
      const block = proj.blocks.find(b => b.id === id)
      if (!block || block.text === newText) return prev

      if (!debounceTimers.current[activeProjectId]) {
        debounceTimers.current[activeProjectId] = {}
      }

      if (debounceTimers.current[activeProjectId][id]) {
        clearTimeout(debounceTimers.current[activeProjectId][id])
      }

      debounceTimers.current[activeProjectId][id] = setTimeout(() => {
        enrichBlock(activeProjectId, id, newText, block.category).catch(console.error)
        delete debounceTimers.current[activeProjectId][id]
      }, 800)

      return prev.map(p => p.id === activeProjectId ? {
        ...p,
        blocks: p.blocks.map(b => b.id === id ? { ...b, text: newText, isEnriching: true, isError: false } : b)
      } : p)
    })
  }, [activeProjectId, enrichBlock, pushHistory])

  const reEnrichBlock = useCallback((id: string, newCategory?: string) => {
    const block = blocks.find(b => b.id === id)
    if (!block) return
    
    updateActiveProject(p => ({
      ...p,
      blocks: p.blocks.map(b => b.id === id ? { ...b, category: newCategory, isEnriching: true } : b)
    }))

    enrichBlock(activeProjectId, id, block.text, newCategory || block.category, block.contentType).catch(console.error)
  }, [activeProjectId, blocks, updateActiveProject, enrichBlock])

  const editAnnotation = useCallback((id: string, newAnnotation: string) => {
    updateActiveProject(p => ({
      ...p,
      blocks: p.blocks.map(b => b.id === id ? { ...b, annotation: newAnnotation } : b)
    }))
  }, [updateActiveProject])

  const toggleCollapse = useCallback((id: string) => {
    updateActiveProject(p => {
      const next = new Set(p.collapsedIds)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return { ...p, collapsedIds: [...next] }
    })
  }, [updateActiveProject])

  const handleTogglePin = useCallback((id: string) => {
    setProjects((current) => current.map(p => p.id === activeProjectId ? {
      ...p,
      blocks: p.blocks.map(b => b.id === id ? { ...b, isPinned: !b.isPinned } : b)
    } : p))
  }, [activeProjectId])

  const handleToggleSubTask = useCallback((blockId: string, subTaskId: string) => {
    setProjects((current) => current.map(p => p.id === activeProjectId ? {
      ...p,
      blocks: p.blocks.map(b => b.id === blockId ? {
        ...b,
        subTasks: b.subTasks?.map(st => st.id === subTaskId ? { ...st, isDone: !st.isDone } : st)
      } : b)
    } : p))
  }, [activeProjectId])

  const handleDeleteSubTask = useCallback((blockId: string, subTaskId: string) => {
    setProjects((current) => current.map(p => p.id === activeProjectId ? {
      ...p,
      blocks: p.blocks.map(b => b.id === blockId ? {
        ...b,
        subTasks: b.subTasks?.filter(st => st.id !== subTaskId)
      } : b)
    } : p))
  }, [activeProjectId])

  const clearBlocks = useCallback(() => {
    pushHistory(activeProjectId, blocks)
    updateActiveProject(p => ({ ...p, blocks: [], collapsedIds: [] }))
  }, [activeProjectId, blocks, pushHistory, updateActiveProject])

  const createProject = useCallback(() => {
    const newProject: Project = {
      id: generateId(),
      name: "New Space",
      blocks: [],
      collapsedIds: [],
      ghostNotes: [],
    }
    setProjects(prev => [...prev, newProject])
    setActiveProjectId(newProject.id)
  }, [])

  const renameProject = useCallback((id: string, newName: string) => {
    setProjects(prev => prev.map(p => p.id === id ? { ...p, name: newName } : p))
  }, [])

  const deleteProject = useCallback((id: string) => {
    setProjects(prev => {
      if (prev.length <= 1) return prev
      const nextProjects = prev.filter(p => p.id !== id)
      if (activeProjectId === id) {
        setActiveProjectId(nextProjects[0].id)
      }
      return nextProjects
    })
  }, [activeProjectId])

  const handleCommand = useCallback((cmd: string, text?: string) => {
    setIsCommandKOpen(false)
    
    // Handle view switches
    if (cmd === "kanban") {
      setViewMode("kanban")
    } else if (cmd === "tiling") {
      setViewMode("tiling")
    } else if (cmd === "graph") {
      setViewMode("graph")
    } else if (cmd === "open-projects") {
      setIsGhostPanelOpen(false)
      setIsIndexOpen(false)
      setIsSidebarOpen(prev => !prev)
    } else if (cmd === "new-project") {
      setIsGhostPanelOpen(false)
      setIsIndexOpen(false)
      setIsSidebarOpen(true)
      createProject()
    } else if (cmd === "open-index") {
      setIsSidebarOpen(false)
      setIsGhostPanelOpen(false)
      setIsIndexOpen(prev => !prev)
    } else if (cmd === "open-synthesis") {
      setIsSidebarOpen(false)
      setIsIndexOpen(false)
      setIsGhostPanelOpen(prev => !prev)
    } else if (cmd === "clear") clearBlocks()
    else if (cmd === "help") window.open("https://github.com/albingroen/react-cmdk", "_blank")
    
    // .nodepad export / import
    else if (cmd === "export-nodepad") {
      setProjects(prev => {
        const proj = prev.find(p => p.id === activeProjectId)
        if (proj) downloadNodepadFile(proj)
        return prev
      })
    } else if (cmd === "import-nodepad") {
      importInputRef.current?.click()
    }

    // Export commands — read project from state snapshot via ref to avoid stale closure
    else if (cmd === "export-md") {
      setProjects(prev => {
        const proj = prev.find(p => p.id === activeProjectId)
        if (proj) {
          const md = exportToMarkdown(proj.name, proj.blocks)
          const slug = proj.name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "")
          downloadMarkdown(`${slug}.md`, md)
        }
        return prev
      })
    } else if (cmd === "copy-md") {
      setProjects(prev => {
        const proj = prev.find(p => p.id === activeProjectId)
        if (proj) {
          const md = exportToMarkdown(proj.name, proj.blocks)
          copyToClipboard(md)
        }
        return prev
      })
    }
    
    // Handle type overrides
    else if (cmd === "task" && text) addBlock(text, "task")
    else if (cmd === "thesis" && text) addBlock(text, "thesis")
    
    setIsCommandKOpen(false)
  }, [clearBlocks, addBlock, activeProjectId])

  return (
    <div className="flex h-dvh overflow-hidden bg-background">
      {/* Hidden file input for .nodepad import */}
      <input
        ref={importInputRef}
        type="file"
        accept=".nodepad,.json"
        className="hidden"
        onChange={handleImportFile}
      />

      <ProjectSidebar
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
        projects={projects}
        activeProjectId={activeProjectId}
        onSelectProject={setActiveProjectId}
        onCreateProject={createProject}
        onRenameProject={renameProject}
        onDeleteProject={deleteProject}
        onSettingsClick={() => setIsSettingsOpen(true)}
        onImportProject={() => importInputRef.current?.click()}
        aiSettings={settings}
        onUpdateAISettings={updateSettings}
        openToSettings={jumpToSettings}
        onSettingsOpened={() => setJumpToSettings(false)}
      />

      <div className="flex flex-1 flex-col overflow-hidden min-w-0">
        <StatusBar
          blockCount={blocks.length}
          blocks={blocks}
          isSidebarOpen={isSidebarOpen}
          isIndexOpen={isIndexOpen}
          isGhostPanelOpen={isGhostPanelOpen}
          ghostNoteCount={ghostNotes.filter(n => !n.isGenerating).length}
          activeProjectName={activeProject?.name || ""}
          onMenuClick={() => setIsSidebarOpen(!isSidebarOpen)}
          onIndexToggle={() => setIsIndexOpen(!isIndexOpen)}
          onGhostPanelToggle={() => setIsGhostPanelOpen(prev => !prev)}
          modelLabel={settings.apiKey ? currentModel.shortLabel : undefined}
        />
        <div className="flex flex-1 overflow-hidden relative">
          <main className="relative flex-1 overflow-hidden">
            {isLoaded ? (
              viewMode === "tiling" ? (
                <TilingArea
                  key={`tiling-${activeProjectId}`}
                  blocks={activeProject.blocks}
                  collapsedIds={new Set(activeProject.collapsedIds)}
                  onDelete={deleteBlock}
                  onEdit={editBlock}
                  onEditAnnotation={editAnnotation}
                  onReEnrich={reEnrichBlock}
                  onToggleCollapse={toggleCollapse}
                  onTogglePin={handleTogglePin}
                  onToggleSubTask={handleToggleSubTask}
                  onDeleteSubTask={handleDeleteSubTask}
                  highlightedBlockId={highlightedBlockId}
                  onHighlight={setHighlightedBlockId}
                  hasApiKey={!!settings.apiKey}
                  onOpenSidebar={() => { setIsSidebarOpen(true); setJumpToSettings(true) }}
                />
              ) : viewMode === "kanban" ? (
                <KanbanArea
                  key={`kanban-${activeProjectId}`}
                  blocks={activeProject.blocks}
                  onDelete={deleteBlock}
                  onEdit={editBlock}
                  onEditAnnotation={editAnnotation}
                  onReEnrich={reEnrichBlock}
                  onToggleCollapse={toggleCollapse}
                  onTogglePin={handleTogglePin}
                  onToggleSubTask={handleToggleSubTask}
                  onDeleteSubTask={handleDeleteSubTask}
                  collapsedIds={new Set(activeProject.collapsedIds)}
                  hasApiKey={!!settings.apiKey}
                  onOpenSidebar={() => { setIsSidebarOpen(true); setJumpToSettings(true) }}
                />
              ) : (
                <GraphArea
                  key={`graph-${activeProjectId}`}
                  blocks={activeProject.blocks}
                  ghostNote={activeProject.ghostNote}
                  onReEnrich={reEnrichBlock}
                  onTogglePin={handleTogglePin}
                  onEdit={editBlock}
                  onEditAnnotation={editAnnotation}
                  hasApiKey={!!settings.apiKey}
                  onOpenSidebar={() => { setIsSidebarOpen(true); setJumpToSettings(true) }}
                />
              )
            ) : (
              <div className="h-full w-full" />
            )}
          </main>

          <GhostPanel
            ghostNotes={ghostNotes}
            isOpen={isGhostPanelOpen}
            onClose={() => setIsGhostPanelOpen(false)}
            onClaim={claimGhostNote}
            onDismiss={dismissGhostNote}
          />
        </div>

        {/* Undo toast */}
        <AnimatePresence>
          {undoToast && (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 4 }}
              transition={{ duration: 0.15, ease: "easeOut" }}
              className="absolute bottom-[72px] left-1/2 -translate-x-1/2 z-[130] pointer-events-none"
            >
              <div className="px-3 py-1.5 rounded-sm bg-black/90 border border-white/15 backdrop-blur-md shadow-xl">
                <span className="font-mono text-[10px] text-white/70 tracking-tight whitespace-nowrap">{undoToast}</span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <VimInput
          onSubmit={addBlock}
          onCommand={handleCommand}
          isCommandKOpen={isCommandKOpen}
          setIsCommandKOpen={setIsCommandKOpen}
        />
      </div>

      <TileIndex 
        blocks={blocks} 
        onHighlight={setHighlightedBlockId} 
        highlightedId={highlightedBlockId} 
        onClose={() => setIsIndexOpen(false)}
        isOpen={isIndexOpen}
        viewMode={viewMode}
      />
    </div>
  )
}
