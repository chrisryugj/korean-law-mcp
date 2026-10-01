/** lsStmd 상하위법의 실제 부모·자식 관계. 시행규칙은 법률 또는 시행령 아래에 있다. */
interface HierarchyNode {
  기본정보?: { 법령명?: string, 법종구분?: string | { content?: string } }
  법률?: HierarchyNode | HierarchyNode[]
  시행령?: HierarchyNode | HierarchyNode[]
  시행규칙?: HierarchyNode | HierarchyNode[]
}

const kinds = ["법률", "시행령", "시행규칙"] as const
type Kind = typeof kinds[number]
const nodes = (value?: HierarchyNode | HierarchyNode[]): HierarchyNode[] =>
  value ? Array.isArray(value) ? value : [value] : []

export function collectLawHierarchy(hierarchy: HierarchyNode): Record<Kind, HierarchyNode[]> {
  const result: Record<Kind, HierarchyNode[]> = { 법률: [], 시행령: [], 시행규칙: [] }
  const walk = (parent: HierarchyNode) => {
    for (const kind of kinds) for (const node of nodes(parent[kind])) {
      result[kind].push(node)
      walk(node)
    }
  }
  walk(hierarchy)
  return result
}

export function renderLawHierarchy(hierarchy: HierarchyNode, fallbackName: string, fallbackType: string): string {
  const walk = (parent: HierarchyNode, depth: number): string => {
    let text = ""
    for (const kind of kinds) {
      const children = nodes(parent[kind])
      for (const node of children.slice(0, 10)) {
        const info = node.기본정보
        const type = typeof info?.법종구분 === "string" ? info.법종구분 : info?.법종구분?.content
        text += `${"   ".repeat(depth)}└─ ${info?.법령명 || kind} (${type || kind})\n`
        text += walk(node, depth + 1)
      }
      if (children.length > 10) text += `${"   ".repeat(depth)}└─ ... 외 ${children.length - 10}건\n`
    }
    return text
  }
  return walk(hierarchy, 0) || `└─ ${fallbackName} (${fallbackType})\n`
}
