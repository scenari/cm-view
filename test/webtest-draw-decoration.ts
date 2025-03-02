import {EditorView, Decoration, DecorationSet, WidgetType, Range} from "@codemirror/view"
import {tempView, requireFocus} from "@codemirror/buildhelper/lib/tempview"
import {EditorSelection, StateEffect, StateField} from "@codemirror/state"
import ist from "ist"

const filterDeco = StateEffect.define<(from: number, to: number, spec: any) => boolean>()
const addDeco = StateEffect.define<Range<Decoration>[]>()

function decos(startState: DecorationSet = Decoration.none) {
  let field = StateField.define<DecorationSet>({
    create() { return startState },
    update(value, tr) {
      value = value.map(tr.changes)
      for (let effect of tr.effects) {
        if (effect.is(addDeco)) value = value.update({add: effect.value})
        else if (effect.is(filterDeco)) value = value.update({filter: effect.value})
      }
      return value
    },
    provide: f => EditorView.decorations.from(f)
  })
  return [field]
}

function d(from: number, to: any, spec: any = null) {
  return Decoration.mark(typeof spec == "string" ? {attributes: {[spec]: "y"}} : spec).range(from, to)
}

function w(pos: number, widget: WidgetType, side: number = 0) {
  return Decoration.widget({widget, side}).range(pos)
}

function l(pos: number, attrs: any) {
  return Decoration.line(typeof attrs == "string" ? {attributes: {class: attrs}} : attrs).range(pos)
}

function decoEditor(doc: string, decorations: any = []) {
  return tempView(doc, decos(Decoration.set(decorations)))
}

describe("EditorView decoration", () => {
  it("renders tag names", () => {
    let cm = decoEditor("one\ntwo", d(2, 5, {tagName: "em"}))
    ist(cm.contentDOM.innerHTML.replace(/<\/?div.*?>/g, "|"),
        "|on<em>e</em>||<em>t</em>wo|")
  })

  it("renders attributes", () => {
    let cm = decoEditor("foo bar", [d(0, 3, {attributes: {title: "t"}}),
                                    d(4, 7, {attributes: {lang: "nl"}})])
    ist(cm.contentDOM.querySelectorAll("[title]").length, 1)
    ist((cm.contentDOM.querySelector("[title]") as any).title, "t")
    ist(cm.contentDOM.querySelectorAll("[lang]").length, 1)
  })

  it("updates for added decorations", () => {
    let cm = decoEditor("hello\ngoodbye")
    cm.dispatch({effects: addDeco.of([d(2, 8, {class: "c"})])})
    let spans = cm.contentDOM.querySelectorAll(".c")
    ist(spans.length, 2)
    ist(spans[0].textContent, "llo")
    ist(spans[0].previousSibling!.textContent, "he")
    ist(spans[1].textContent, "go")
    ist(spans[1].nextSibling!.textContent, "odbye")
  })

  it("updates for removed decorations", () => {
    let cm = decoEditor("one\ntwo\nthree", [d(1, 12, {class: "x"}),
                                            d(4, 7, {tagName: "strong"})])
    cm.dispatch({effects: filterDeco.of((from: number) => from == 4)})
    ist(cm.contentDOM.querySelectorAll(".x").length, 0)
    ist(cm.contentDOM.querySelectorAll("strong").length, 1)
  })

  it("doesn't update DOM that doesn't need to change", () => {
    let cm = decoEditor("one\ntwo", [d(0, 3, {tagName: "em"})])
    let secondLine = cm.contentDOM.lastChild!, secondLineText = secondLine.firstChild
    cm.dispatch({effects: filterDeco.of(() => false)})
    ist(cm.contentDOM.lastChild, secondLine)
    ist(secondLine.firstChild, secondLineText)
  })

  it("nests decoration elements", () => {
    let cm = tempView("abcdef", [decos(Decoration.set([d(0, 4, {class: "a"})])),
                                 decos(Decoration.set([d(2, 6, {class: "b"})]))])
    let a = cm.contentDOM.querySelectorAll(".a"), b = cm.contentDOM.querySelectorAll(".b")
    ist(a.length, 1)
    ist(b.length, 2)
    ist(a[0].textContent, "abcd")
    ist(b[0].textContent, "cd")
    ist(b[0].parentNode, a[0])
    ist(b[1].textContent, "ef")
  })

  it("drops entirely deleted decorations", () => {
    let cm = decoEditor("abc", [d(1, 2, {inclusiveStart: true, inclusiveEnd: true, tagName: "strong"})])
    cm.dispatch({changes: {from: 0, to: 3, insert: "a"}})
    ist(cm.contentDOM.querySelector("strong"), null)
  })

  it("doesn't merge separate decorations", () => {
    let cm = decoEditor("abcd", [d(0, 2, {class: "a"}), d(2, 4, {class: "a"})])
    ist(cm.contentDOM.querySelectorAll(".a").length, 2)
    cm.dispatch({changes: {from: 1, to: 3}})
    ist(cm.contentDOM.querySelectorAll(".a").length, 2)
  })

  it("merges joined decorations", () => {
    let cm = decoEditor("ab cd", [d(0, 2, {class: "a"}), d(3, 5, {class: "a"})])
    cm.dispatch({changes: {from: 2, to: 3, insert: "x"},
                 effects: [filterDeco.of(() => false), addDeco.of([d(0, 5, {class: "a"})])]})
    ist(cm.contentDOM.querySelectorAll(".a").length, 1)
  })

  it("keeps decorations together when deleting inside of them", () => {
    let cm = decoEditor("one\ntwo", [d(1, 6, {class: "a"})])
    ist(cm.contentDOM.querySelectorAll(".a").length, 2)
    cm.dispatch({changes: {from: 2, to: 5}})
    ist(cm.contentDOM.querySelectorAll(".a").length, 1)
  })

  it("does merge recreated decorations", () => {
    let cm = decoEditor("abcde", [d(1, 4, {class: "c"})])
    cm.dispatch({changes: {from: 2, to: 5, insert: "CDE"},
                 effects: [filterDeco.of(() => false),
                           addDeco.of([d(1, 4, {class: "c"})])]})
    let a = cm.contentDOM.querySelectorAll(".c")
    ist(a.length, 1)
    ist(a[0].textContent, "bCD")
  })

  it("breaks low-precedence ranges for high-precedence wrappers", () => {
    let cm = tempView("abc", [decos(Decoration.set([d(0, 2, {class: "a"})])),
                              decos(Decoration.set([d(1, 3, {class: "b"})]))])
    let a = cm.contentDOM.querySelectorAll(".a")
    let b = cm.contentDOM.querySelectorAll(".b")
    ist(a.length, 1)
    ist(b.length, 2)
    ist(b[0].parentNode, a[0])
  })

  it("properly updates the viewport gap when changes fall inside it", () => {
    let doc = "a\n".repeat(500)
    let cm = decoEditor(doc, [d(600, 601, "x")])
    cm.dom.style.height = "100px"
    cm.scrollDOM.style.overflow = "auto"
    cm.scrollDOM.scrollTop = 0
    cm.measure()
    cm.dispatch({
      changes: {from: 500, insert: "  "},
      selection: EditorSelection.single(0, doc.length + 2)
    })
  })

  class WordWidget extends WidgetType {
    constructor(readonly word: string) { super() }
    eq(other: WordWidget) { return this.word.toLowerCase() == other.word.toLowerCase() }
    toDOM() {
      let dom = document.createElement("strong")
      dom.textContent = this.word
      return dom
    }
  }

  describe("widget", () => {
    class OtherWidget extends WidgetType {
      toDOM() { return document.createElement("img") }
    }

    it("draws widgets", () => {
      let cm = decoEditor("hello", [w(4, new WordWidget("hi"))])
      let elt = cm.contentDOM.querySelector("strong")!
      ist(elt)
      ist(elt.textContent, "hi")
      ist(elt.previousSibling!.textContent, "hell")
      ist(elt.nextSibling!.textContent, "o")
      ist(elt.contentEditable, "false")
    })

    it("supports editing around widgets", () => {
      let cm = decoEditor("hello", [w(4, new WordWidget("hi"))])
      cm.dispatch({changes: {from: 3, to: 4}})
      cm.dispatch({changes: {from: 3, to: 4}})
      ist(cm.contentDOM.querySelector("strong"))
    })

    it("compares widgets with their eq method", () => {
      let cm = decoEditor("hello", [w(4, new WordWidget("hi"))])
      let elt = cm.contentDOM.querySelector("strong")
      cm.dispatch({
        effects: [filterDeco.of(() => false),
                  addDeco.of([w(4, new WordWidget("HI"))])]
      })
      ist(elt, cm.contentDOM.querySelector("strong"))
    })

    it("notices replaced replacement decorations", () => {
      let cm = decoEditor("abc", [Decoration.replace({widget: new WordWidget("X")}).range(1, 2)])
      cm.dispatch({effects: [filterDeco.of(() => false),
                             addDeco.of([Decoration.replace({widget: new WordWidget("Y")}).range(1, 2)])]})
      ist(cm.contentDOM.textContent, "aYc")
    })

    it("allows replacements to shadow inner replacements", () => {
      let cm = decoEditor("one\ntwo\nthree\nfour", [
        Decoration.replace({widget: new WordWidget("INNER")}).range(5, 12)
      ])
      cm.dispatch({effects: addDeco.of([Decoration.replace({widget: new WordWidget("OUTER")}).range(1, 17)])})
      ist(cm.contentDOM.textContent, "oOUTERr")
    })

    it("doesn't consider different widgets types equivalent", () => {
      let cm = decoEditor("hello", [w(4, new WordWidget("hi"))])
      let elt = cm.contentDOM.querySelector("strong")
      cm.dispatch({effects: [
        filterDeco.of(() => false),
        addDeco.of([w(4, new OtherWidget)])
      ]})
      ist(elt, cm.contentDOM.querySelector("strong"), "!=")
    })

    it("orders widgets by side", () => {
      let cm = decoEditor("hello", [w(4, new WordWidget("A"), -1),
                                    w(4, new WordWidget("B")),
                                    w(4, new WordWidget("C"), 10)])
      let widgets = cm.contentDOM.querySelectorAll("strong")
      ist(widgets.length, 3)
      ist(widgets[0].textContent, "A")
      ist(widgets[1].textContent, "B")
      ist(widgets[2].textContent, "C")
    })

    it("places the cursor based on side", () => {
      let cm = requireFocus(
        decoEditor("abc", [w(2, new WordWidget("A"), -1),
                           w(2, new WordWidget("B"), 1)]))
      cm.dispatch({selection: {anchor: 2}})
      let {focusNode, focusOffset} = document.getSelection()!
      let [before, after] = focusNode!.nodeType == 3 ?
        [focusOffset ? focusNode! : focusNode!.previousSibling!,
         focusOffset == focusNode!.nodeValue!.length ? focusNode!.nextSibling! : focusNode!] :
        [focusNode!.childNodes[focusOffset - 1], focusNode!.childNodes[focusOffset]]
      ist(before.textContent, "A")
      ist(after.textContent, "B")
    })

    it("preserves widgets alongside edits regardless of side", () => {
      let cm = decoEditor("abc", [w(1, new WordWidget("x"), -1), w(1, new WordWidget("y"), 1),
                                  w(2, new WordWidget("z"), -1), w(2, new WordWidget("q"), 1)])
      cm.dispatch({changes: {from: 1, to: 2, insert: "B"}})
      ist(cm.contentDOM.textContent, "axyBzqc")
    })

    it("can update widgets in an empty document", () => {
      let cm = decoEditor("", [w(0, new WordWidget("A"))])
      cm.dispatch({effects: addDeco.of([w(0, new WordWidget("B"))])})
      ist(cm.contentDOM.querySelectorAll("strong").length, 2)
    })

    it("doesn't duplicate widgets on line splitting", () => {
      let cm = decoEditor("a", [w(1, new WordWidget("W"), 1)])
      cm.dispatch({changes: {from: 1, insert: "\n"}})
      ist(cm.contentDOM.querySelectorAll("strong").length, 1)
    })

    it("can remove widgets at the end of a line", () => { // Issue #139
      let cm = decoEditor("one\ntwo", [w(3, new WordWidget("A"))])
      cm.dispatch({effects: [filterDeco.of(() => false), addDeco.of([w(5, new WordWidget("B"))])]})
      ist(cm.contentDOM.querySelectorAll("strong").length, 1)
    })

    it("can wrap widgets in marks", () => {
      let cm = tempView("abcd", [decos(Decoration.set([d(0, 4, {class: "a"})])),
                                 decos(Decoration.set([w(2, new WordWidget("hi"))])),
                                 decos(Decoration.set([d(1, 3, {class: "b"})]))])
      let a = cm.contentDOM.querySelectorAll(".a")
      let b = cm.contentDOM.querySelectorAll(".b")
      let wordElt = cm.contentDOM.querySelector("strong")
      ist(a.length, 1)
      ist(b.length, 2)
      ist(wordElt)
      ist(wordElt!.parentNode, a[0])
      ist(b[0].parentNode, a[0])
      ist(b[0].textContent, "b")
      ist(b[1].textContent, "c")
      cm.dispatch({effects: [filterDeco.of(from => from != 2)]})
      ist(cm.contentDOM.querySelectorAll(".b").length, 1)
    })

    it("wraps widgets even when the mark starts at the same offset", () => {
      let repl = Decoration.replace({widget: new WordWidget("X"),
                                     inclusive: false})
      let cm = tempView("abcd", [decos(Decoration.set([d(1, 3, {class: "a", inclusive: true})])),
                                 decos(Decoration.set([repl.range(1, 3)]))])
      let a = cm.contentDOM.querySelectorAll(".a")
      let w = cm.contentDOM.querySelectorAll("strong")
      ist(a.length, 1)
      ist(w.length, 1)
      ist(w[0].parentNode, a[0])
    })
  })

  describe("replaced", () => {
    function r(from: number, to: number, spec: any = {}) { return Decoration.replace(spec).range(from, to) }

    it("omits replaced content", () => {
      let cm = decoEditor("foobar", [r(1, 4)])
      ist(cm.contentDOM.textContent, "far")
    })

    it("can replace across lines", () => {
      let cm = decoEditor("foo\nbar\nbaz\nbug", [r(1, 14)])
      ist(cm.contentDOM.childNodes.length, 1)
      ist(cm.contentDOM.firstChild!.textContent, "fg")
    })

    it("draws replacement widgets", () => {
      let cm = decoEditor("foo\nbar\nbaz", [r(6, 9, {widget: new WordWidget("X")})])
      ist(cm.contentDOM.textContent, "foobaXaz")
    })

    it("can handle multiple overlapping replaced ranges", () => {
      let cm = decoEditor("foo\nbar\nbaz\nbug", [r(1, 6), r(6, 9), r(8, 14)])
      ist(cm.contentDOM.childNodes.length, 1)
      ist(cm.contentDOM.firstChild!.textContent, "fg")
    })

    it("allows splitting a replaced range", () => {
      let cm = decoEditor("1234567890", [r(1, 9)])
      cm.dispatch({
        changes: {from: 2, to: 8, insert: "abcdef"},
        effects: [filterDeco.of(_ => false), addDeco.of([r(1, 3), r(7, 9)])]
      })
      ist(cm.contentDOM.firstChild!.textContent, "1bcde0")
    })

    it("allows replacing a single replaced range with two adjacent ones", () => {
      let cm = decoEditor("1234567890", [r(1, 9)])
      cm.dispatch({
        changes: {from: 2, to: 8, insert: "cdefgh"},
        effects: [filterDeco.of(_ => false), addDeco.of([r(1, 5), r(5, 9)])]
      })
      ist(cm.contentDOM.firstChild!.textContent, "10")
      ist((cm.contentDOM.firstChild as HTMLElement).childNodes.length, 4)
    })

    it("can handle changes inside replaced content", () => {
      let cm = decoEditor("abcdefghij", [r(2, 8)])
      cm.dispatch({changes: {from: 4, to: 6, insert: "n"}})
      ist(cm.contentDOM.textContent, "abij")
    })

    it("preserves selection endpoints inside replaced ranges", () => {
      let cm = requireFocus(decoEditor("abcdefgh", [r(0, 4)]))
      cm.dispatch({selection: {anchor: 2, head: 6}})
      let sel = document.getSelection()!, range = document.createRange()
      range.setEnd(sel.focusNode!, sel.focusOffset + 1)
      range.setStart(sel.anchorNode!, sel.anchorOffset)
      sel.removeAllRanges()
      sel.addRange(range)
      cm.observer.flush()
      let {anchor, head} = cm.state.selection.main
      ist(head, 7)
      ist(anchor, 2)
    })
  })

  describe("line attributes", () => {
    function classes(cm: EditorView, ...lines: string[]) {
      for (let i = 0; i < lines.length; i++) {
        let className = (cm.contentDOM.childNodes[i] as HTMLElement).className.split(" ")
          .filter(c => c != "cm-line" && !/ͼ/.test(c)).sort().join(" ")
        ist(className, lines[i])
      }
    }

    it("adds line attributes", () => {
      let cm = decoEditor("abc\ndef\nghi", [l(0, "a"), l(0, "b"), l(1, "c"), l(8, "d")])
      classes(cm, "a b", "", "d")
    })

    it("updates when line attributes are added", () => {
      let cm = decoEditor("foo\nbar", [l(0, "a")])
      cm.dispatch({effects: addDeco.of([l(0, "b"), l(4, "c")])})
      classes(cm, "a b", "c")
    })

    it("updates when line attributes are removed", () => {
      let ds = [l(0, "a"), l(0, "b"), l(4, "c")]
      let cm = decoEditor("foo\nbar", ds)
      cm.dispatch({effects: filterDeco.of(
        (_f: number, _t: number, deco: Decoration) => !ds.slice(1).some(r => r.value == deco))})
      classes(cm, "a", "")
    })

    it("handles line joining properly", () => {
      let cm = decoEditor("x\ny\nz", [l(0, "a"), l(2, "b"), l(4, "c")])
      cm.dispatch({changes: {from: 1, to: 4}})
      classes(cm, "a")
    })

    it("handles line splitting properly", () => {
      let cm = decoEditor("abc", [l(0, "a")])
      cm.dispatch({changes: {from: 1, to: 2, insert: "\n"}})
      classes(cm, "a", "")
    })

    it("can handle insertion", () => {
      let cm = decoEditor("x\ny\nz", [l(2, "a"), l(4, "b")])
      cm.dispatch({changes: {from: 2, insert: "hi"}})
      classes(cm, "", "a", "b")
    })
  })

  class BlockWidget extends WidgetType {
    constructor(readonly name: string) { super() }
    eq(other: BlockWidget) { return this.name == other.name }
    toDOM() {
      let elt = document.createElement("hr")
      elt.setAttribute("data-name", this.name)
      return elt
    }
  }

  function bw(pos: number, side = -1, name = "n") {
    return Decoration.widget({widget: new BlockWidget(name), side, block: true}).range(pos)
  }

  function br(from: number, to: number, name = "r", inclusive = false) {
    return Decoration.replace({widget: new BlockWidget(name), inclusive, block: true}).range(from, to)
  }

  function widgets(cm: EditorView, ...groups: string[][]) {
    let found: string[][] = [[]]
    for (let n: Node | null = cm.contentDOM.firstChild; n; n = n.nextSibling) {
      if ((n as HTMLElement).nodeName == "HR") found[found.length - 1].push((n as HTMLElement).getAttribute("data-name")!)
      else found.push([])
    }
    ist(JSON.stringify(found), JSON.stringify(groups))
  }

  describe("block widgets", () => {
    it("draws block widgets in the right place", () => {
      let cm = decoEditor("foo\nbar", [bw(0, -1, "A"), bw(3, 1, "B"), bw(3, 2, "C"), bw(4, -2, "D"), bw(4, -1, "E"), bw(7, 1, "F")])
      widgets(cm, ["A"], ["B", "C", "D", "E"], ["F"])
    })

    it("adds widgets when they appear", () => {
      let cm = decoEditor("foo\nbar", [bw(7, 1, "Y")])
      cm.dispatch({effects: addDeco.of([bw(0, -1, "X"), bw(7, 2, "Z")])})
      widgets(cm, ["X"], [], ["Y", "Z"])
    })

    it("removes widgets when they vanish", () => {
      let cm = decoEditor("foo\nbar", [bw(0, -1, "A"), bw(3, 1, "B"), bw(4, -1, "C"), bw(7, 1, "D")])
      widgets(cm, ["A"], ["B", "C"], ["D"])
      cm.dispatch({effects: filterDeco.of((_f: number, _t: number, deco: any) => deco.spec.side < 0)})
      widgets(cm, ["A"], ["C"], [])
    })

    it("draws block ranges", () => {
      let cm = decoEditor("one\ntwo\nthr\nfou", [br(4, 11, "A")])
      widgets(cm, [], ["A"], [])
    })

    it("can add widgets at the end and start of the doc", () => {
      let cm = decoEditor("one\ntwo")
      cm.dispatch({effects: addDeco.of([bw(0, -1, "X"), bw(7, 1, "Y")])})
      widgets(cm, ["X"], [], ["Y"])
    })

    it("can add widgets around inner lines", () => {
      let cm = decoEditor("one\ntwo")
      cm.dispatch({effects: addDeco.of([bw(3, 1, "X"), bw(4, -1, "Y")])})
      widgets(cm, [], ["X", "Y"], [])
    })

    it("can replace an empty line with a range", () => {
      let cm = decoEditor("one\n\ntwo", [br(4, 4, "A")])
      widgets(cm, [], ["A"], [])
    })

    it("can put a block range in the middle of a line", () => {
      let cm = decoEditor("hello", [br(2, 3, "X")])
      widgets(cm, [], ["X"], [])
      cm.dispatch({changes: {from: 1, to: 2, insert: "u"}, effects: addDeco.of([br(2, 3, "X")])})
      widgets(cm, [], ["X"], [])
      cm.dispatch({changes: {from: 3, to: 4, insert: "i"}, effects: addDeco.of([br(2, 3, "X")])})
      widgets(cm, [], ["X"], [])
    })

    it("can draw a block range that partially overlaps with a collapsed range", () => {
      let cm = decoEditor("hello", [Decoration.replace({widget: new WordWidget("X")}).range(0, 3),
                                    br(1, 4, "Y")])
      widgets(cm, [], ["Y"], [])
      ist(cm.contentDOM.querySelector("strong"))
    })

    it("doesn't redraw unchanged widgets", () => {
      let cm = decoEditor("foo\nbar", [bw(0, -1, "A"), bw(7, 1, "B")])
      let ws = cm.contentDOM.querySelectorAll("hr")
      cm.dispatch({effects: [
        filterDeco.of((_f: number, _t: number, deco: any) => deco.spec.side < 0),
        addDeco.of([bw(7, 1, "B")])
      ]})
      widgets(cm, ["A"], [], ["B"])
      let newWs = cm.contentDOM.querySelectorAll("hr")
      ist(newWs[0], ws[0])
      ist(newWs[1], ws[1])
    })

    it("does redraw changed widgets", () => {
      let cm = decoEditor("foo\nbar", [bw(0, -1, "A"), bw(7, 1, "B")])
      cm.dispatch({effects: [
        filterDeco.of((_f: number, _t: number, deco: any) => deco.spec.side < 0),
        addDeco.of([bw(7, 1, "C")])
      ]})
      widgets(cm, ["A"], [], ["C"])
    })

    it("allows splitting a block widget", () => {
      let cm = decoEditor("1234567890", [br(1, 9, "X")])
      cm.dispatch({
        changes: {from: 2, to: 8, insert: "abcdef"},
        effects: [filterDeco.of(_ => false), addDeco.of([br(1, 3, "X"), br(7, 9, "X")])]
      })
      widgets(cm, [], ["X"], ["X"], [])
    })
  })
})
