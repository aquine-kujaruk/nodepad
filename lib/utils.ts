import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import type { TextBlock } from '@/components/tile-card'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
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
