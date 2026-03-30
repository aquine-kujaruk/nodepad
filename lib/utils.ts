import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { useState, useEffect } from 'react'
import type { TextBlock } from '@/components/tile-card'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Returns the platform modifier key symbol: '⌘' on macOS/iOS, 'Ctrl' elsewhere.
 * Starts as '⌘' on the server (SSR) and corrects on the client after mount.
 */
export function useModKey(): string {
  const [mod, setMod] = useState('⌘')
  useEffect(() => {
    const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform)
    if (!isMac) setMod('Ctrl')
  }, [])
  return mod
}

/**
 * Returns the set of block IDs that are "connected" to the hovered block,
 * based on shared category or influencedBy relationships.
 * Used by tiling-area and kanban-area for the connection-hover dimming effect.
 */
export function getRelatedIds(hoveredId: string, blocks: TextBlock[]): Set<string> {
  const hovered = blocks.find(b => b.id === hoveredId)
  if (!hovered) return new Set()

  const related = new Set<string>([hoveredId])
  blocks.forEach(b => {
    if (b.id === hoveredId) return
    const hoveredPointsToB = hovered.influencedBy?.includes(b.id) ?? false
    const bPointsToHovered = b.influencedBy?.includes(hoveredId) ?? false
    if (hoveredPointsToB || bPointsToHovered) related.add(b.id)
  })
  return related
}
