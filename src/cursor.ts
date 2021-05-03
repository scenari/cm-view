import {EditorState, EditorSelection, SelectionRange, CharCategory} from "@codemirror/state"
import {findColumn, countColumn, findClusterBreak} from "@codemirror/text"
import {EditorView} from "./editorview"
import {BlockType} from "./decoration"
import {WidgetView} from "./inlineview"
import {LineView} from "./blockview"
import {clientRectsFor, textRange} from "./dom"
import {moveVisually, movedOver, Direction} from "./bidi"
import browser from "./browser"

declare global {
  interface Selection { modify(action: string, direction: string, granularity: string): void }
  interface Document { caretPositionFromPoint(x: number, y: number): {offsetNode: Node, offset: number} }
}

export function groupAt(state: EditorState, pos: number, bias: 1 | -1 = 1) {
  let categorize = state.charCategorizer(pos)
  let line = state.doc.lineAt(pos), linePos = pos - line.from
  if (line.length == 0) return EditorSelection.cursor(pos)
  if (linePos == 0) bias = 1
  else if (linePos == line.length) bias = -1
  let from = linePos, to = linePos
  if (bias < 0) from = findClusterBreak(line.text, linePos, false)
  else to = findClusterBreak(line.text, linePos)
  let cat = categorize(line.text.slice(from, to))
  while (from > 0) {
    let prev = findClusterBreak(line.text, from, false)
    if (categorize(line.text.slice(prev, from)) != cat) break
    from = prev
  }
  while (to < line.length) {
    let next = findClusterBreak(line.text, to)
    if (categorize(line.text.slice(to, next)) != cat) break
    to = next
  }
  return EditorSelection.range(from + line.from, to + line.from)
}

// Search the DOM for the {node, offset} position closest to the given
// coordinates. Very inefficient and crude, but can usually be avoided
// by calling caret(Position|Range)FromPoint instead.

// FIXME holding arrow-up/down at the end of the viewport is a rather
// common use case that will repeatedly trigger this code. Maybe
// introduce some element of binary search after all?

function getdx(x: number, rect: ClientRect): number {
  return rect.left > x ? rect.left - x : Math.max(0, x - rect.right)
}
function getdy(y: number, rect: ClientRect): number {
  return rect.top > y ? rect.top - y : Math.max(0, y - rect.bottom)
}
function yOverlap(a: ClientRect, b: ClientRect): boolean {
  return a.top < b.bottom - 1 && a.bottom > b.top + 1
}
function upTop(rect: ClientRect, top: number): ClientRect {
  return top < rect.top ? {top, left: rect.left, right: rect.right, bottom: rect.bottom} as ClientRect : rect
}
function upBot(rect: ClientRect, bottom: number): ClientRect {
  return bottom > rect.bottom ? {top: rect.top, left: rect.left, right: rect.right, bottom} as ClientRect : rect
}

function domPosAtCoords(parent: HTMLElement, x: number, y: number): {node: Node, offset: number} {
  let closest, closestRect!: ClientRect, closestX!: number, closestY!: number
  let above, below, aboveRect, belowRect
  for (let child: Node | null = parent.firstChild; child; child = child.nextSibling) {
    let rects = clientRectsFor(child)
    for (let i = 0; i < rects.length; i++) {
      let rect: ClientRect = rects[i]
      if (closestRect && yOverlap(closestRect, rect))
        rect = upTop(upBot(rect, closestRect.bottom), closestRect.top)
      let dx = getdx(x, rect), dy = getdy(y, rect)
      if (dx == 0 && dy == 0)
        return child.nodeType == 3 ? domPosInText(child as Text, x, y) : domPosAtCoords(child as HTMLElement, x, y)
      if (!closest || closestY > dy || closestY == dy && closestX > dx) {
        closest = child; closestRect = rect; closestX = dx; closestY = dy
      }
      if (dx == 0) {
        if (y > rect.bottom && (!aboveRect || aboveRect.bottom < rect.bottom)) { above = child; aboveRect = rect }
        else if (y < rect.top && (!belowRect || belowRect.top > rect.top)) { below = child; belowRect = rect }
      } else if (aboveRect && yOverlap(aboveRect, rect)) {
        aboveRect = upBot(aboveRect, rect.bottom)
      } else if (belowRect && yOverlap(belowRect, rect)) {
        belowRect = upTop(belowRect, rect.top)
      }
    }
  }
  if (aboveRect && aboveRect.bottom >= y) { closest = above; closestRect = aboveRect }
  else if (belowRect && belowRect.top <= y) { closest = below; closestRect = belowRect }

  if (!closest) return {node: parent, offset: 0}
  let clipX = Math.max(closestRect!.left, Math.min(closestRect!.right, x))
  if (closest.nodeType == 3) return domPosInText(closest as Text, clipX, y)
  if (!closestX && (closest as HTMLElement).contentEditable == "true")
    return domPosAtCoords(closest as HTMLElement, clipX, y)
  let offset = Array.prototype.indexOf.call(parent.childNodes, closest) +
    (x >= (closestRect!.left + closestRect!.right) / 2 ? 1 : 0)
  return {node: parent, offset}
}

function domPosInText(node: Text, x: number, y: number): {node: Node, offset: number} {
  let len = node.nodeValue!.length
  let closestOffset = -1, closestDY = 1e9, generalSide = 0
  for (let i = 0; i < len; i++) {
    let rects = textRange(node, i, i + 1).getClientRects()
    for (let j = 0; j < rects.length; j++) {
      let rect = rects[j]
      if (rect.top == rect.bottom) continue
      if (!generalSide) generalSide = x - rect.left
      let dy = (rect.top > y ? rect.top - y : y - rect.bottom) - 1
      if (rect.left - 1 <= x && rect.right + 1 >= x && dy < closestDY) {
        let right = x >= (rect.left + rect.right) / 2, after = right
        if (browser.chrome || browser.gecko) {
          // Check for RTL on browsers that support getting client
          // rects for empty ranges.
          let rectBefore = textRange(node, i).getBoundingClientRect()
          if (rectBefore.left == rect.right) after = !right
        }
        if (dy <= 0) return {node, offset: i + (after ? 1 : 0)}
        closestOffset = i + (after ? 1 : 0)
        closestDY = dy
      }
    }
  }
  return {node, offset: closestOffset > -1 ? closestOffset : generalSide > 0 ? node.nodeValue!.length : 0}
}

export function posAtCoords(view: EditorView, {x, y}: {x: number, y: number}, bias: -1 | 1 = -1): number | null {
  let content = view.contentDOM.getBoundingClientRect(), block
  let halfLine = view.defaultLineHeight / 2
  for (let bounced = false;;) {
    block = view.blockAtHeight(y, content.top)
    if (block.top > y || block.bottom < y) {
      bias = block.top > y ? -1 : 1
      y = Math.min(block.bottom - halfLine, Math.max(block.top + halfLine, y))
      if (bounced) return -1
      else bounced = true
    }
    if (block.type == BlockType.Text) break
    y = bias > 0 ? block.bottom + halfLine : block.top - halfLine
  }
  let lineStart = block.from
  // If this is outside of the rendered viewport, we can't determine a position
  if (lineStart < view.viewport.from)
    return view.viewport.from == 0 ? 0 : null
  if (lineStart > view.viewport.to)
    return view.viewport.to == view.state.doc.length ? view.state.doc.length : null
  // Clip x to the viewport sides
  x = Math.max(content.left + 1, Math.min(content.right - 1, x))
  let root = view.root, element = root.elementFromPoint(x, y)

  // There's visible editor content under the point, so we can try
  // using caret(Position|Range)FromPoint as a shortcut
  let node: Node | undefined, offset: number = -1
  if (element && view.contentDOM.contains(element) && !(view.docView.nearest(element) instanceof WidgetView)) {
    if (root.caretPositionFromPoint) {
      let pos = root.caretPositionFromPoint(x, y)
      if (pos) ({offsetNode: node, offset} = pos)
    } else if (root.caretRangeFromPoint) {
      let range = root.caretRangeFromPoint(x, y)
      if (range) {
        ;({startContainer: node, startOffset: offset} = range)
        if (browser.safari && isSuspiciousCaretResult(node, offset, x)) node = undefined
      }
    }
  }

  // No luck, do our own (potentially expensive) search
  if (!node || !view.docView.dom.contains(node)) {
    let line = LineView.find(view.docView, lineStart)!
    ;({node, offset} = domPosAtCoords(line.dom!, x, y))
  }
  return view.docView.posFromDOM(node, offset)
}

// In case of a high line height, Safari's caretRangeFromPoint treats
// the space between lines as belonging to the last character of the
// line before. This is used to detect such a result so that it can be
// ignored (issue #401).
function isSuspiciousCaretResult(node: Node, offset: number, x: number) {
  let len
  if (node.nodeType != 3 || offset != (len = node.nodeValue!.length)) return false
  for (let next = node.nextSibling; next; next = node.nextSibling)
    if (next.nodeType != 1 || (next as Element).localName !== "br") return false
  return textRange(node as Text, len - 1, len).getBoundingClientRect().left > x
}

export function moveToLineBoundary(view: EditorView, start: SelectionRange, forward: boolean, includeWrap: boolean) {
  let line = view.state.doc.lineAt(start.head)
  let coords = !includeWrap || !view.lineWrapping ? null
    : view.coordsAtPos(start.assoc < 0 && start.head > line.from ? start.head - 1 : start.head)
  if (coords) {
    let editorRect = view.dom.getBoundingClientRect()
    let pos = view.posAtCoords({x: forward == (view.textDirection == Direction.LTR) ? editorRect.right - 1 : editorRect.left + 1,
                                y: (coords.top + coords.bottom) / 2})
    if (pos != null) return EditorSelection.cursor(pos, forward ? -1 : 1)
  }
  let lineView = LineView.find(view.docView, start.head)
  let end = lineView ? (forward ? lineView.posAtEnd : lineView.posAtStart) : (forward ? line.to : line.from)
  return EditorSelection.cursor(end, forward ? -1 : 1)
}

export function moveByChar(view: EditorView, start: SelectionRange, forward: boolean,
                           by?: (initial: string) => (next: string) => boolean) {
  let line = view.state.doc.lineAt(start.head), spans = view.bidiSpans(line)
  for (let cur = start, check: null | ((next: string) => boolean) = null;;) {
    let next = moveVisually(line, spans, view.textDirection, cur, forward), char = movedOver
    if (!next) {
      if (line.number == (forward ? view.state.doc.lines : 1)) return cur
      char = "\n"
      line = view.state.doc.line(line.number + (forward ? 1 : -1))
      spans = view.bidiSpans(line)
      next = EditorSelection.cursor(forward ? line.from : line.to)
    }
    if (!check) {
      if (!by) return next
      check = by(char)
    } else if (!check(char)) {
      return cur
    }
    cur = next
  }
}

export function byGroup(view: EditorView, pos: number, start: string) {
  let categorize = view.state.charCategorizer(pos)
  let cat = categorize(start)
  return (next: string) => {
    let nextCat = categorize(next)
    if (cat == CharCategory.Space) cat = nextCat
    return cat == nextCat
  }
}

export function moveVertically(view: EditorView, start: SelectionRange, forward: boolean, distance?: number) {
  let startPos = start.head, dir: -1 | 1 = forward ? 1 : -1
  if (startPos == (forward ? view.state.doc.length : 0)) return EditorSelection.cursor(startPos)
  let startCoords = view.coordsAtPos(startPos)
  if (startCoords) {
    let rect = view.dom.getBoundingClientRect()
    let goal = start.goalColumn ?? startCoords.left - rect.left
    let resolvedGoal = rect.left + goal
    let dist = distance ?? (view.defaultLineHeight >> 1)
    for (let startY = dir < 0 ? startCoords.top : startCoords.bottom, extra = 0; extra < 50; extra += 10) {
      let pos = posAtCoords(view, {x: resolvedGoal, y: startY + (dist + extra) * dir}, dir)
      if (pos == null) break
      if (pos != startPos) return EditorSelection.cursor(pos, undefined, undefined, goal)
    }
  }

  // Outside of the drawn viewport, use a crude column-based approach
  let {doc} = view.state, line = doc.lineAt(startPos), tabSize = view.state.tabSize
  let goal = start.goalColumn, goalCol = 0
  if (goal == null) {
    for (const iter = doc.iterRange(line.from, startPos); !iter.next().done;)
      goalCol = countColumn(iter.value, goalCol, tabSize)
    goal = goalCol * view.defaultCharacterWidth
  } else {
    goalCol = Math.round(goal / view.defaultCharacterWidth)
  }
  if (dir < 0 && line.from == 0) return EditorSelection.cursor(0)
  else if (dir > 0 && line.to == doc.length) return EditorSelection.cursor(line.to)
  let otherLine = doc.line(line.number + dir)
  let result = otherLine.from
  let seen = 0
  for (const iter = doc.iterRange(otherLine.from, otherLine.to); seen >= goalCol && !iter.next().done;) {
    const {offset, leftOver} = findColumn(iter.value, seen, goalCol, tabSize)
    seen = goalCol - leftOver
    result += offset
  }
  return EditorSelection.cursor(result, undefined, undefined, goal)
}
