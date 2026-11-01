import { useLayoutEffect, useRef } from 'react'
import { useLocation, useNavigationType } from 'react-router-dom'

export interface SavedScrollPosition {
  left: number
  top: number
}

export type RouteScrollPlan =
  | { kind: 'anchor'; id: string }
  | { kind: 'restore'; position: SavedScrollPosition }
  | { kind: 'top' }

export function getRouteScrollPlan(
  navigationType: string,
  hash: string,
  key: string,
  positions: ReadonlyMap<string, SavedScrollPosition>,
): RouteScrollPlan {
  if (hash.length > 1) {
    let id = hash.slice(1)
    try { id = decodeURIComponent(id) } catch { /* preserve the literal anchor */ }
    return { kind: 'anchor', id }
  }
  if (navigationType === 'POP') {
    const position = positions.get(key)
    if (position) return { kind: 'restore', position }
  }
  return { kind: 'top' }
}

export default function RouteScrollManager() {
  const location = useLocation()
  const navigationType = useNavigationType()
  const positions = useRef(new Map<string, SavedScrollPosition>())

  useLayoutEffect(() => {
    const previousMode = window.history.scrollRestoration
    window.history.scrollRestoration = 'manual'
    return () => { window.history.scrollRestoration = previousMode }
  }, [])

  useLayoutEffect(() => {
    const plan = getRouteScrollPlan(navigationType, location.hash, location.key, positions.current)
    if (plan.kind === 'anchor') {
      const anchor = document.getElementById(plan.id)
      if (anchor) {
        anchor.scrollIntoView()
        return
      }
      window.scrollTo(0, 0)
      return
    }
    if (plan.kind === 'restore') {
      window.scrollTo(plan.position.left, plan.position.top)
      return
    }
    window.scrollTo(0, 0)
  }, [location.hash, location.key, navigationType])

  useLayoutEffect(() => () => {
    positions.current.set(location.key, { left: window.scrollX, top: window.scrollY })
  }, [location.key])

  return null
}
